/** Hash overrides belong to WhatTheDuck, never to the model's native metadata. */
interface EditableModel {
    name: string;
}
interface EditBrowser {
    subType: string;
}
declare global {
    var editModel: (model: EditableModel | null, browser: EditBrowser) => void;
    var save_edit_model: () => void;
}

interface OverrideResponse {
    success?: boolean;
    hash?: string;
    error?: string;
}

const FIELD_ID = "wtd_model_override_hash";
let started = false;

/** Install on the native modal so its existing Save and Cancel keep their meaning. */
export function initModelHashOverride(): void {
    const modal = document.getElementById("edit_model_modal");
    const technical = document.getElementById("edit_model_technical_data");
    if (
        started ||
        !modal ||
        !technical ||
        typeof editModel !== "function" ||
        typeof save_edit_model !== "function"
    ) {
        return;
    }
    started = true;
    const row = document.createElement("div");
    row.innerHTML = `<label for="${FIELD_ID}">Override hash:</label>
        <input id="${FIELD_ID}" type="text" class="modal_text_extra" autocomplete="off" spellcheck="false" maxlength="66" placeholder="Use native hash" />
        <div class="small">Used in newly generated image/video metadata. Stored separately by WhatTheDuck. Leave blank to use the native hash.</div>
        <div role="status"></div>`;
    technical.parentElement?.insertAdjacentElement("afterend", row);
    const field = row.querySelector("input") as HTMLInputElement;
    const status = row.querySelector('[role="status"]') as HTMLElement;
    const originalEdit = editModel;
    const originalSave = save_edit_model;
    type Editing = {
        model: string;
        subtype: string;
        loaded: boolean;
        saving: boolean;
        hash: string;
        nativeValues: string | null;
    };
    let current: Editing | null = null;
    const nativeValues = (): string =>
        JSON.stringify(
            Array.from(
                modal.querySelectorAll<
                    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
                >("input, select, textarea"),
            )
                .filter((input) => input.id !== FIELD_ID)
                .map((input) => [
                    input.id,
                    input.value,
                    input instanceof HTMLInputElement ? input.checked : false,
                ]),
        );
    // Core may finish preparing its preview asynchronously before showing the modal.
    const events = $("#edit_model_modal") as ReturnType<typeof $> & {
        on(event: string, callback: () => void): void;
    };
    events.on("shown.bs.modal", () => {
        if (current) current.nativeValues = nativeValues();
    });
    events.on("hidden.bs.modal", () => {
        current = null;
    });
    globalThis.editModel = (model, browser) => {
        if (!model) {
            originalEdit(model, browser);
            return;
        }
        const editing: Editing = {
            model: model.name,
            subtype: browser.subType,
            loaded: false,
            saving: false,
            hash: "",
            nativeValues: null,
        };
        current = editing;
        field.value = "";
        field.disabled = true;
        status.textContent = "Loading override…";
        originalEdit(model, browser);
        genericRequest<OverrideResponse>(
            "WhatTheDuckGetModelHashOverride",
            { model: editing.model, subtype: editing.subtype },
            (data) => {
                if (current !== editing) return;
                if (!data.success || data.error) {
                    status.textContent =
                        data.error || "Could not load override.";
                    return;
                }
                field.value = data.hash ?? "";
                editing.hash = field.value;
                editing.loaded = true;
                field.disabled = false;
                status.textContent = "";
            },
            0,
            (message) => {
                if (current === editing) status.textContent = message;
            },
        );
    };
    globalThis.save_edit_model = () => {
        const editing = current;
        if (!editing) {
            originalSave();
            return;
        }
        if (!editing.loaded) {
            showError(
                "Wait for the override to load. If loading failed, reopen Edit Metadata to retry.",
            );
            return;
        }
        if (editing.saving) return;
        const hash = field.value.trim();
        if (hash && !/^(?:0x)?[a-f0-9]{1,64}$/i.test(hash)) {
            showError(
                "Override hash must contain 1–64 hexadecimal characters, optionally prefixed with 0x.",
            );
            return;
        }
        const finish = () => {
            if (current !== editing) return;
            // An override-only edit must not trigger Swarm's model/sidecar rewrite.
            if (editing.nativeValues === nativeValues()) {
                $("#edit_model_modal").modal("hide");
            } else {
                originalSave();
            }
        };
        if (hash === editing.hash) {
            finish();
            return;
        }
        editing.saving = true;
        field.disabled = true;
        status.textContent = "Saving override…";
        const failed = (message: string) => {
            if (current !== editing) return;
            editing.saving = false;
            field.disabled = false;
            status.textContent = message;
            showError(message);
        };
        genericRequest<OverrideResponse>(
            "WhatTheDuckSaveModelHashOverride",
            { model: editing.model, subtype: editing.subtype, hash },
            (data) => {
                if (!data.success || data.error) {
                    failed(data.error || "Could not save override.");
                    return;
                }
                editing.hash = hash;
                editing.saving = false;
                finish();
            },
            0,
            failed,
        );
    };
}

export const modelHashOverride = { init: initModelHashOverride };
