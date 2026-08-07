/**
 * Comfy Workflow Save Module
 *
 * Adds a "Save To Server" button to the Comfy Workflow tab's button panel,
 * immediately after the core "Import From Generate Tab" button
 * (`comfyImportWorkflow()`).
 *
 * Clicking it does everything the import button does — build the current
 * generate tab parameters with `getGenInput()`, ask the backend for the ComfyUI
 * workflow they produce via `ComfyGetGeneratedWorkflow`, and load that workflow
 * into the embedded Comfy editor — and additionally posts both the request
 * payload and the generated workflow to `WhatTheDuckSaveComfyWorkflow`, which
 * writes them as a pair of JSON files under the SwarmUI data directory on the
 * server (with embedded base64 blobs cropped out server-side). One click, so the
 * core import button doesn't have to be clicked too.
 *
 * The absolute path of both saved files is copied to the clipboard on success.
 */

const BUTTON_ID = "wtd_comfy_save_workflow_button";
const BUTTON_LABEL = "Import & Save To Server";
const BUTTON_TITLE =
    "Import the generate tab's workflow into the editor, and save it plus the " +
    "payload it was built from as JSON files on the machine running SwarmUI.";

let started = false;

interface GeneratedWorkflowResponse {
    workflow?: string;
    error?: string;
}

interface SaveWorkflowResponse {
    success?: boolean;
    folder?: string;
    payloadFile?: string;
    workflowFile?: string;
    payloadPath?: string;
    workflowPath?: string;
    error?: string;
}

/** The line copied to the clipboard after a successful save. */
export const buildClipboardLine = (res: SaveWorkflowResponse): string =>
    `Payload: ${res.payloadPath ?? ""}, Generated Workflow: ${res.workflowPath ?? ""}`;

/**
 * Status text in the comfy button panel's notice slot when available (the tab we
 * live in owns it), falling back to the generic popover elsewhere.
 */
const notice = (message: string): void => {
    if (typeof comfyNoticeMessage === "function") {
        comfyNoticeMessage(message);
        return;
    }
    if (typeof doNoticePopover === "function") {
        doNoticePopover(message, "notice-pop-green");
    }
};

/** The bits of the Comfy iframe's window that the core import button uses. */
interface ComfyFrameWindow {
    app?: { loadApiJson(json: unknown): void };
    LiteGraph?: { cloneObject(obj: unknown): unknown };
}

/**
 * Load a generated workflow into the embedded Comfy editor, exactly as core's
 * `comfyImportWorkflow()` does. Returns false when the editor isn't reachable
 * (tab never opened, iframe still loading), so the save can carry on regardless.
 */
export const loadWorkflowIntoEditor = (workflow: string): boolean => {
    if (typeof comfyFrame !== "function") {
        return false;
    }
    const win = comfyFrame()?.contentWindow as unknown as
        | ComfyFrameWindow
        | null
        | undefined;
    const app = win?.app;
    const liteGraph = win?.LiteGraph;
    if (!app?.loadApiJson || !liteGraph?.cloneObject) {
        return false;
    }
    app.loadApiJson(liteGraph.cloneObject(JSON.parse(workflow)));
    return true;
};

// --- Controller (I/O against SwarmUI globals) -------------------------------

export const onSaveClick = (): void => {
    if (typeof getGenInput !== "function") {
        showError("Generate tab parameters are not available.");
        return;
    }
    const payload = getGenInput();
    notice("Importing and saving workflow...");
    genericRequest<GeneratedWorkflowResponse>(
        "ComfyGetGeneratedWorkflow",
        payload,
        (data) => {
            if (!data?.workflow) {
                showError(data?.error || "No workflow found.");
                return;
            }
            // Update the graph first, then save; a graph-load failure must not
            // cost the user the dump they clicked for.
            try {
                loadWorkflowIntoEditor(data.workflow);
            } catch (err) {
                showError(`Failed to load workflow into the editor: ${err}`);
            }
            genericRequest<SaveWorkflowResponse>(
                "WhatTheDuckSaveComfyWorkflow",
                {
                    payload: JSON.stringify(payload),
                    workflow: data.workflow,
                },
                (res) => {
                    if (!res?.success) {
                        showError(res?.error || "Failed to save workflow.");
                        return;
                    }
                    if (typeof copyText === "function") {
                        copyText(buildClipboardLine(res));
                    }
                    notice(
                        `Saved to ${res.folder} (paths copied to clipboard)`,
                    );
                },
            );
        },
    );
};

// --- Button injection (DOM-only; testable) ----------------------------------

/**
 * Insert the save button directly after the core "Import From Generate Tab"
 * button. Idempotent, and a no-op (returning false) while the comfy button
 * panel is not in the DOM yet.
 */
export function injectSaveButton(rootDoc: Document): boolean {
    if (rootDoc.getElementById(BUTTON_ID)) {
        return true;
    }
    const importBtn = rootDoc.querySelector(
        '#comfy_workflow_buttons button[onclick*="comfyImportWorkflow"]',
    );
    if (!importBtn) {
        return false;
    }
    const btn = rootDoc.createElement("button");
    btn.type = "button";
    btn.id = BUTTON_ID;
    btn.className = "basic-button comfy-small-button comfy-left-button";
    btn.title = BUTTON_TITLE;
    btn.textContent = BUTTON_LABEL;
    btn.addEventListener("click", onSaveClick);
    importBtn.insertAdjacentElement("afterend", btn);
    return true;
}

const init = (): void => {
    if (started) {
        return;
    }
    started = true;
    if (injectSaveButton(document)) {
        return;
    }
    // The comfy tab markup is normally in the page at load; if it isn't (tab
    // injected later / backend feature not yet reported), wait for it once.
    const observer = new MutationObserver(() => {
        if (injectSaveButton(document)) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
};

export const comfyWorkflowSave = {
    init,
};
