import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Response = { success?: boolean; hash?: string; error?: string };
interface Request {
    endpoint: string;
    data: Record<string, unknown>;
    complete: (response: Response) => void;
    fail?: (message: string) => void;
}

let requests: Request[];
let events: Record<string, () => void>;
let nativeSave: ReturnType<typeof jest.fn>;
let hide: ReturnType<typeof jest.fn>;
const field = () =>
    document.getElementById("wtd_model_override_hash") as HTMLInputElement;
const open = (name = "folder/model.gguf", subtype = "Stable-Diffusion") => {
    globalThis.editModel({ name }, { subType: subtype });
    events["shown.bs.modal"]();
};
const load = (hash = "") => requests.at(-1)?.complete({ success: true, hash });

beforeEach(async () => {
    jest.resetModules();
    requests = [];
    events = {};
    nativeSave = jest.fn();
    hide = jest.fn();
    document.body.innerHTML = `<div id="edit_model_modal">
        <div><span id="edit_model_technical_data"></span></div>
        <input id="edit_model_author" value="Original" />
    </div>`;
    globalThis.editModel = jest.fn();
    globalThis.save_edit_model = nativeSave;
    globalThis.showError = jest.fn();
    globalThis.$ = (() => ({
        modal: hide,
        on: (event: string, callback: () => void) => {
            events[event] = callback;
        },
    })) as typeof $;
    globalThis.genericRequest = ((endpoint, data, complete, _depth, fail) => {
        requests.push({
            endpoint,
            data,
            complete: complete as (response: Response) => void,
            fail,
        });
    }) as typeof genericRequest;
    const { initModelHashOverride } = await import("./modelHashOverride");
    initModelHashOverride();
});

describe("model hash override modal", () => {
    it("loads exact model identity and saves only the override without native resave", () => {
        open("sub/model.gguf", "LoRA");
        expect(requests[0].data).toEqual({
            model: "sub/model.gguf",
            subtype: "LoRA",
        });
        expect(field().disabled).toBe(true);
        load("0x1234");
        expect(field().value).toBe("0x1234");
        field().value = " ABCDEF ";
        globalThis.save_edit_model();
        expect(requests[1].endpoint).toBe("WhatTheDuckSaveModelHashOverride");
        expect(requests[1].data).toEqual({
            model: "sub/model.gguf",
            subtype: "LoRA",
            hash: "ABCDEF",
        });
        expect(hide).not.toHaveBeenCalled();
        requests[1].complete({ success: true });
        expect(hide).toHaveBeenCalledWith("hide");
        expect(nativeSave).not.toHaveBeenCalled();
    });

    it("saves native edits only after override persistence succeeds", () => {
        open();
        load();
        (
            document.getElementById("edit_model_author") as HTMLInputElement
        ).value = "Changed";
        field().value = "abc";
        globalThis.save_edit_model();
        expect(nativeSave).not.toHaveBeenCalled();
        requests[1].complete({ success: true });
        expect(nativeSave).toHaveBeenCalledTimes(1);
    });

    it("clears overrides and does not resave unchanged values", () => {
        open();
        load("abc");
        field().value = "";
        globalThis.save_edit_model();
        expect(requests[1].data.hash).toBe("");
        requests[1].complete({ success: true });
        open();
        load();
        globalThis.save_edit_model();
        expect(requests).toHaveLength(3);
    });

    it("rejects malformed hashes and blocks save while loading", () => {
        open();
        globalThis.save_edit_model();
        expect(requests).toHaveLength(1);
        load();
        field().value = "not-a-hash";
        globalThis.save_edit_model();
        expect(requests).toHaveLength(1);
        expect(globalThis.showError).toHaveBeenCalledTimes(2);
        expect(nativeSave).not.toHaveBeenCalled();
    });

    it("keeps modal editable after save errors and ignores duplicate saves", () => {
        open();
        load();
        field().value = "abc";
        globalThis.save_edit_model();
        globalThis.save_edit_model();
        expect(requests).toHaveLength(2);
        requests[1].fail?.("Disk full");
        expect(field().disabled).toBe(false);
        expect(hide).not.toHaveBeenCalled();
        expect(nativeSave).not.toHaveBeenCalled();
        globalThis.save_edit_model();
        requests[2].complete({ error: "Permission denied" });
        expect(field().disabled).toBe(false);
    });

    it("does not replace another model's field or save native metadata after switching models", () => {
        open("first.gguf");
        open("second.gguf");
        requests[0].complete({ success: true, hash: "111" });
        expect(field().value).toBe("");
        load("222");
        field().value = "333";
        globalThis.save_edit_model();
        open("third.gguf");
        requests[2].complete({ success: true });
        expect(nativeSave).not.toHaveBeenCalled();
        expect(hide).not.toHaveBeenCalled();
        expect(field().value).toBe("");
    });

    it("cancel discards edits and stale load callbacks", () => {
        open();
        events["hidden.bs.modal"]();
        load("abc");
        expect(field().value).toBe("");
        expect(requests).toHaveLength(1);
        expect(nativeSave).not.toHaveBeenCalled();
    });

    it("blocks accidental clearing after load failure", () => {
        open();
        requests[0].complete({ error: "Could not read overrides" });
        globalThis.save_edit_model();
        expect(requests).toHaveLength(1);
        expect(nativeSave).not.toHaveBeenCalled();
    });
});
