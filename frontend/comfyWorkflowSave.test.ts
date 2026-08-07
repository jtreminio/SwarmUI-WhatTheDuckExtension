import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

/**
 * comfyWorkflowSave exercises SwarmUI globals (getGenInput, genericRequest,
 * comfyNoticeMessage, doNoticePopover, showError) and latches an internal
 * `started` flag in init(). Each test re-imports the module fresh via
 * jest.resetModules() + dynamic import so the latch/observer state never leaks
 * between tests (the documented pattern for the attached-flag modules).
 */

type ComfyWorkflowSaveModule = typeof import("./comfyWorkflowSave");

const BUTTON_ID = "wtd_comfy_save_workflow_button";

const g = globalThis as unknown as Record<string, unknown>;

type RequestCall = [string, Record<string, unknown>, (data: unknown) => void];

/**
 * Stand-in for the Comfy editor iframe: `comfyFrame().contentWindow` exposes the
 * `app.loadApiJson` / `LiteGraph.cloneObject` pair the core import button uses.
 * `loaded` records what the graph was handed.
 */
const stubComfyFrame = (): { loaded: unknown[] } => {
    const loaded: unknown[] = [];
    const contentWindow = {
        app: {
            loadApiJson: (json: unknown) => {
                loaded.push(json);
            },
        },
        LiteGraph: { cloneObject: (obj: unknown) => obj },
    };
    g.comfyFrame = () => ({ contentWindow });
    return { loaded };
};

/** DOM fixture mirroring the core Comfy Workflow tab's button panel. */
const buildPanel = (): void => {
    document.body.innerHTML = `
        <div id="comfy_workflow_buttons">
            <div class="comfy-second-button-row">
                <button class="basic-button comfy-small-button comfy-left-button translate" onclick="comfyImportWorkflow()">Import From Generate Tab</button>
                <div id="comfy_multigpu"></div>
            </div>
        </div>`;
};

describe("comfyWorkflowSave", () => {
    let mod: ComfyWorkflowSaveModule;
    let requests: RequestCall[];

    beforeEach(async () => {
        jest.resetModules();
        requests = [];
        g.genericRequest = (
            endpoint: string,
            data: Record<string, unknown>,
            callback: (data: unknown) => void,
        ) => {
            requests.push([endpoint, data, callback]);
        };
        g.getGenInput = () => ({ prompt: "a duck", model: "sdxl" });
        g.showError = jest.fn();
        g.comfyNoticeMessage = jest.fn();
        g.copyText = jest.fn();
        mod = await import("./comfyWorkflowSave");
    });

    afterEach(() => {
        for (const key of [
            "genericRequest",
            "getGenInput",
            "showError",
            "comfyNoticeMessage",
            "doNoticePopover",
            "comfyFrame",
            "copyText",
        ]) {
            delete g[key];
        }
    });

    describe("injectSaveButton", () => {
        it("inserts the button right after the import button", () => {
            buildPanel();
            expect(mod.injectSaveButton(document)).toBe(true);
            const importBtn = document.querySelector(
                'button[onclick*="comfyImportWorkflow"]',
            );
            const btn = document.getElementById(BUTTON_ID);
            expect(btn).not.toBeNull();
            expect(importBtn?.nextElementSibling).toBe(btn);
            expect(btn?.className).toContain("comfy-small-button");
        });

        it("is idempotent", () => {
            buildPanel();
            mod.injectSaveButton(document);
            mod.injectSaveButton(document);
            expect(document.querySelectorAll(`#${BUTTON_ID}`)).toHaveLength(1);
        });

        it("does nothing when the comfy panel is absent", () => {
            document.body.innerHTML = "<div></div>";
            expect(mod.injectSaveButton(document)).toBe(false);
            expect(document.getElementById(BUTTON_ID)).toBeNull();
        });
    });

    describe("onSaveClick", () => {
        it("requests the generated workflow for the current gen input", () => {
            mod.onSaveClick();
            expect(requests).toHaveLength(1);
            const [endpoint, data] = requests[0];
            expect(endpoint).toBe("ComfyGetGeneratedWorkflow");
            expect(data).toEqual({ prompt: "a duck", model: "sdxl" });
        });

        it("posts the payload and workflow to the save endpoint", () => {
            mod.onSaveClick();
            requests[0][2]({ workflow: '{"1":{"class_type":"KSampler"}}' });
            expect(requests).toHaveLength(2);
            const [endpoint, data] = requests[1];
            expect(endpoint).toBe("WhatTheDuckSaveComfyWorkflow");
            expect(data).toEqual({
                payload: JSON.stringify({ prompt: "a duck", model: "sdxl" }),
                workflow: '{"1":{"class_type":"KSampler"}}',
            });
        });

        it("reports the saved location and copies both paths on success", () => {
            mod.onSaveClick();
            requests[0][2]({ workflow: "{}" });
            requests[1][2]({
                success: true,
                folder: "/data/WhatTheDuck/ComfyWorkflows",
                payloadPath:
                    "/data/WhatTheDuck/ComfyWorkflows/2026-08-07_10-00-00_payload.json",
                workflowPath:
                    "/data/WhatTheDuck/ComfyWorkflows/2026-08-07_10-00-00_workflow.json",
            });
            expect(g.comfyNoticeMessage).toHaveBeenLastCalledWith(
                "Saved to /data/WhatTheDuck/ComfyWorkflows (paths copied to clipboard)",
            );
            expect(g.copyText).toHaveBeenCalledWith(
                "Payload: /data/WhatTheDuck/ComfyWorkflows/2026-08-07_10-00-00_payload.json, " +
                    "Generated Workflow: /data/WhatTheDuck/ComfyWorkflows/2026-08-07_10-00-00_workflow.json",
            );
            expect(g.showError).not.toHaveBeenCalled();
        });

        it("copies nothing when the save failed", () => {
            mod.onSaveClick();
            requests[0][2]({ workflow: "{}" });
            requests[1][2]({ success: false, error: "Disk full." });
            expect(g.copyText).not.toHaveBeenCalled();
        });

        it("loads the workflow into the comfy editor as well as saving it", () => {
            const frame = stubComfyFrame();
            mod.onSaveClick();
            requests[0][2]({ workflow: '{"1":{"class_type":"KSampler"}}' });
            expect(frame.loaded).toEqual([{ "1": { class_type: "KSampler" } }]);
            expect(requests[1][0]).toBe("WhatTheDuckSaveComfyWorkflow");
        });

        it("still saves when the comfy editor is not reachable", () => {
            mod.onSaveClick();
            requests[0][2]({ workflow: "{}" });
            expect(requests[1][0]).toBe("WhatTheDuckSaveComfyWorkflow");
        });

        it("still saves when loading into the editor throws", () => {
            g.comfyFrame = () => ({
                contentWindow: {
                    app: {
                        loadApiJson: () => {
                            throw new Error("graph blew up");
                        },
                    },
                    LiteGraph: { cloneObject: (obj: unknown) => obj },
                },
            });
            mod.onSaveClick();
            requests[0][2]({ workflow: "{}" });
            expect(g.showError).toHaveBeenCalledWith(
                expect.stringContaining("graph blew up") as unknown as string,
            );
            expect(requests[1][0]).toBe("WhatTheDuckSaveComfyWorkflow");
        });

        it("surfaces a missing workflow and never calls the save endpoint", () => {
            mod.onSaveClick();
            requests[0][2]({ error: "No ComfyUI backend available." });
            expect(requests).toHaveLength(1);
            expect(g.showError).toHaveBeenCalledWith(
                "No ComfyUI backend available.",
            );
        });

        it("surfaces a save failure", () => {
            mod.onSaveClick();
            requests[0][2]({ workflow: "{}" });
            requests[1][2]({ success: false, error: "Disk full." });
            expect(g.showError).toHaveBeenCalledWith("Disk full.");
        });

        it("errors out when the generate tab is unavailable", () => {
            delete g.getGenInput;
            mod.onSaveClick();
            expect(requests).toHaveLength(0);
            expect(g.showError).toHaveBeenCalledWith(
                "Generate tab parameters are not available.",
            );
        });
    });

    describe("buildClipboardLine", () => {
        it("formats both absolute paths", () => {
            expect(
                mod.buildClipboardLine({
                    payloadPath: "/srv/a_payload.json",
                    workflowPath: "/srv/a_workflow.json",
                }),
            ).toBe(
                "Payload: /srv/a_payload.json, Generated Workflow: /srv/a_workflow.json",
            );
        });
    });

    describe("loadWorkflowIntoEditor", () => {
        it("hands a cloned parse of the workflow to loadApiJson", () => {
            const frame = stubComfyFrame();
            expect(mod.loadWorkflowIntoEditor('{"a":1}')).toBe(true);
            expect(frame.loaded).toEqual([{ a: 1 }]);
        });

        it("returns false when the editor iframe is missing", () => {
            expect(mod.loadWorkflowIntoEditor("{}")).toBe(false);
            g.comfyFrame = (): null => null;
            expect(mod.loadWorkflowIntoEditor("{}")).toBe(false);
            g.comfyFrame = () => ({ contentWindow: {} });
            expect(mod.loadWorkflowIntoEditor("{}")).toBe(false);
        });
    });

    describe("init", () => {
        it("injects immediately when the panel is already present", () => {
            buildPanel();
            mod.comfyWorkflowSave.init();
            expect(document.getElementById(BUTTON_ID)).not.toBeNull();
        });

        it("clicking the injected button starts the save flow", () => {
            buildPanel();
            mod.comfyWorkflowSave.init();
            document.getElementById(BUTTON_ID)?.click();
            expect(requests[0][0]).toBe("ComfyGetGeneratedWorkflow");
        });

        it("injects once the panel appears later", async () => {
            mod.comfyWorkflowSave.init();
            expect(document.getElementById(BUTTON_ID)).toBeNull();
            buildPanel();
            // MutationObserver callbacks are queued as microtasks.
            await Promise.resolve();
            expect(document.getElementById(BUTTON_ID)).not.toBeNull();
        });
    });
});
