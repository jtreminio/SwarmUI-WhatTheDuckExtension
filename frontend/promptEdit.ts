/**
 * Prompt Edit Module
 *
 * Adds an "Edit prompt" button next to the existing positive-prompt "Click to
 * copy" button inside the `.current-image-data` container. Clicking it opens a
 * modal pre-filled with the current image's positive prompt; Save calls the
 * backend `WhatTheDuckEditPrompt` endpoint, which rewrites the prompt inside the
 * already-generated image file's metadata (preserving the file's format and the
 * user's format settings), then re-renders the current-image data display from
 * the returned metadata.
 *
 * The edit button is an always-available UI affordance (not gated behind the
 * Keyboard Navigation toggle).
 */

const MODAL_ID = "wtd_prompt_edit_modal";
const TEXTAREA_ID = "wtd_prompt_edit_textarea";
const SAVE_ID = "wtd_prompt_edit_save";
const EDIT_BTN_CLASS = "wtd-prompt-edit-button";
// Attribute set to "true" on injected edit buttons; the idempotency marker that
// prevents the MutationObserver from injecting a second button on re-render.
const EDIT_BTN_MARK = "data-wtd-edit-button";

let started = false;

// --- jQuery / bootstrap modal helpers ---------------------------------------
// Guard every `$` use so jsdom tests (which mock `$`) and any environment where
// jQuery is missing degrade gracefully instead of throwing.

const getTextarea = (): HTMLTextAreaElement | null =>
    document.getElementById(TEXTAREA_ID) as HTMLTextAreaElement | null;

const showModal = (): void => {
    if (typeof $ === "function") {
        $(`#${MODAL_ID}`).modal("show");
    }
    // Best-effort focus so the user can immediately edit.
    getTextarea()?.focus();
};

const hideModal = (): void => {
    if (typeof $ === "function") {
        $(`#${MODAL_ID}`).modal("hide");
    }
};

// --- Textarea read/write (thin wrappers, handy for tests) -------------------

const setTextarea = (value: string): void => {
    const textarea = getTextarea();
    if (textarea) {
        textarea.value = value;
    }
};

const getTextareaValue = (): string => getTextarea()?.value ?? "";

// --- Pure helper (no I/O; directly unit-testable) ---------------------------

/**
 * Extract the positive prompt (`sui_image_params.prompt`) from a raw metadata
 * string. `raw` may be SwarmUI's embedded metadata (run through
 * `interpretMetadata`) or already-interpreted JSON (as stored in
 * `dataset.metadata`). Returns "" for empty/malformed/unrecognized input and
 * never throws.
 */
export function readPositivePrompt(raw: string | null | undefined): string {
    if (!raw) {
        return "";
    }
    let jsonStr: string | null = null;
    try {
        jsonStr = interpretMetadata(raw);
    } catch {
        jsonStr = null;
    }
    if (!jsonStr) {
        // raw may already be plain JSON (dataset.metadata is interpreted JSON).
        jsonStr = raw;
    }
    try {
        const obj = JSON.parse(jsonStr);
        const p = obj?.sui_image_params ? obj.sui_image_params.prompt : "";
        if (typeof p === "string") {
            return p;
        }
        return p == null ? "" : String(p);
    } catch {
        return "";
    }
}

// --- Button injection (DOM-only; testable) ----------------------------------

/**
 * Inject an "Edit prompt" button immediately after the POSITIVE prompt's
 * "Click to copy" button inside every `.current-image-data` container.
 *
 * The positive entry is the one whose `.param_view_name` text is exactly
 * "Prompt" (an exact match — "Negative Prompt" must NOT match). Fully
 * idempotent: a marker attribute prevents duplicate injection when the data
 * container is re-rendered.
 */
export function injectEditButtons(rootDoc: Document): void {
    const containers = rootDoc.querySelectorAll(".current-image-data");
    for (const container of Array.from(containers)) {
        const copyButtons = container.querySelectorAll(".prompt-copy-button");
        for (const copyBtn of Array.from(copyButtons)) {
            const block = copyBtn.closest(".param_view_block");
            if (!block) {
                continue;
            }
            const nameEl = block.querySelector(".param_view_name");
            if (nameEl?.textContent?.trim() !== "Prompt") {
                continue;
            }
            // Idempotency: skip if this copy button already has our edit button
            // as its next sibling, or if the block already contains one.
            const next = copyBtn.nextElementSibling;
            if (next?.hasAttribute(EDIT_BTN_MARK)) {
                continue;
            }
            if (block.querySelector(`[${EDIT_BTN_MARK}]`)) {
                continue;
            }
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `basic-button ${EDIT_BTN_CLASS}`;
            btn.title = "Edit prompt";
            btn.setAttribute(EDIT_BTN_MARK, "true");
            btn.innerHTML = "&#x270E;"; // pencil
            btn.addEventListener("click", onEditClick);
            copyBtn.insertAdjacentElement("afterend", btn);
        }
    }
}

// --- Controllers (I/O against SwarmUI globals) ------------------------------

function onEditClick(): void {
    const el = currentImageHelper.getCurrentImage();
    const raw = el?.dataset?.metadata || currentMetadataVal;
    setTextarea(readPositivePrompt(raw));
    showModal();
}

function onSave(): void {
    const el = currentImageHelper.getCurrentImage();
    // Normalize to the path the backend expects: strip the display prefix
    // (Output/, View/<user>/, host, leading slash) exactly like the core
    // star/delete buttons do via getImageFullSrc. Sending the raw dataset.src
    // (e.g. "Output/raw/...") would resolve to "Output/Output/raw/..." and fail.
    const path = el?.dataset ? getImageFullSrc(el.dataset.src) : null;
    // Raw value, intentionally NOT trimmed — empty prompts are valid.
    const newVal = getTextareaValue();
    if (!path) {
        showError("No current image to save to.");
        hideModal();
        return;
    }
    genericRequest<{ success?: boolean; metadata?: string; error?: string }>(
        "WhatTheDuckEditPrompt",
        { path, prompt: newVal },
        (data) => {
            if (!data?.success) {
                // Keep modal open; do NOT mutate any state.
                showError(data?.error || "Failed to save prompt.");
                return;
            }
            const newMetadata = data.metadata ?? "";
            // Re-read: the current image may have changed while in flight. Compare
            // on the cleaned path so the display prefix can't cause a false mismatch.
            const cur = currentImageHelper.getCurrentImage();
            const curSrc = cur?.dataset.src;
            if (cur && curSrc != null && getImageFullSrc(curSrc) === path) {
                cur.dataset.metadata = newMetadata;
                // Assign through globalThis: a bare assignment to the
                // (externally-declared) `currentMetadataVal` binding throws
                // under ES-module strict mode; this updates the real global.
                globalThis.currentMetadataVal = newMetadata;
                // Re-render `.current-image-data` from the new metadata without a
                // disk re-fetch (canReparse=false). setCurrentImage needs the DISPLAY
                // src (dataset.src), not the cleaned backend path. The MutationObserver
                // then re-injects exactly one edit button (idempotent).
                if (typeof setCurrentImage === "function") {
                    setCurrentImage(
                        curSrc,
                        newMetadata,
                        "",
                        false,
                        false,
                        false,
                    );
                }
            }
            doNoticePopover("Prompt updated", "notice-pop-green");
            hideModal();
        },
    );
}

// --- Modal construction + init ----------------------------------------------

function buildModal(): void {
    if (document.getElementById(MODAL_ID)) {
        return;
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = MODAL_ID;
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.innerHTML = `
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header"><h5 class="modal-title">Edit Prompt</h5></div>
                <div class="modal-body">
                    <textarea id="${TEXTAREA_ID}" class="wtd-prompt-edit-textarea auto-text-block" rows="8"></textarea>
                </div>
                <div class="modal-footer">
                    <button type="button" id="${SAVE_ID}" class="btn btn-primary basic-button">Save</button>
                    <button type="button" class="btn btn-secondary basic-button" data-bs-dismiss="modal">Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    document.getElementById(SAVE_ID)?.addEventListener("click", onSave);
    // Cancel: data-bs-dismiss handles bootstrap at runtime; the explicit handler
    // keeps it working under jsdom / a bootstrap-agnostic environment.
    modal
        .querySelector('[data-bs-dismiss="modal"]')
        ?.addEventListener("click", () => hideModal());
}

const init = (): void => {
    if (started) {
        return;
    }
    started = true;
    buildModal();
    // The `.current-image-data` block is re-rendered whenever the current image
    // (or its metadata) changes; re-inject on every mutation.
    const observer = new MutationObserver(() => injectEditButtons(document));
    observer.observe(document.body, { childList: true, subtree: true });
    // The data may already be present at init time.
    injectEditButtons(document);
};

export const promptEdit = {
    init,
};
