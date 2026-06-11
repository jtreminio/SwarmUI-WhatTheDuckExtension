import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

/**
 * promptEdit exercises SwarmUI globals (genericRequest, currentImageHelper,
 * interpretMetadata, setCurrentImage, doNoticePopover, showError, $) and latches
 * an internal `started` flag in init(). Each test re-imports the module fresh
 * via jest.resetModules() + dynamic import so the observer/latch state never
 * leaks between tests (the documented pattern for the attached-flag modules).
 */

type PromptEditModule = typeof import("./promptEdit");

const MODAL_ID = "wtd_prompt_edit_modal";
const TEXTAREA_ID = "wtd_prompt_edit_textarea";
const EDIT_BTN_CLASS = "wtd-prompt-edit-button";

// `currentImageHelper`/`currentMetadataVal` are declared as `const`/`let` (not
// `function`) in globals.d.ts, so TypeScript does not treat them as members of
// the `globalThis` type. Route stubs through this index-signature view to set
// them the same way batchCompare.test.ts sets function globals directly.
const g = globalThis as unknown as Record<string, unknown>;

// interpretMetadata stub mirroring real behavior: echoes its arg when it looks
// like JSON (starts with "{"), else returns null (unrecognized).
const stubInterpretMetadata = (raw: unknown): string | null => {
    if (typeof raw === "string" && raw.trimStart().startsWith("{")) {
        return raw;
    }
    return null;
};

// getImageFullSrc stub mirroring core: strips protocol+host, a leading slash, an
// "Output/" prefix, and a "View/<user>/" prefix. Returns null for null/undefined.
const stubGetImageFullSrc = (src: string | null | undefined): string | null => {
    if (src == null) {
        return null;
    }
    let full = src;
    if (full.startsWith("http://") || full.startsWith("https://")) {
        full = full.substring(full.indexOf("/", full.indexOf("/") + 2));
    }
    if (full.startsWith("/")) {
        full = full.substring(1);
    }
    if (full.startsWith("Output/")) {
        full = full.substring("Output/".length);
    }
    if (full.startsWith("View/")) {
        full = full.substring("View/".length);
        const slash = full.indexOf("/");
        if (slash !== -1) {
            full = full.substring(slash + 1);
        }
    }
    return full;
};

/** Build a `.param_view_block` entry with a name + a `.prompt-copy-button`. */
const makeEntry = (name: string): HTMLElement => {
    const block = document.createElement("span");
    block.className = "param_view_block";
    const nameEl = document.createElement("span");
    nameEl.className = "param_view_name";
    nameEl.textContent = name;
    const copyBtn = document.createElement("button");
    copyBtn.className = "basic-button prompt-copy-button";
    block.appendChild(nameEl);
    block.appendChild(copyBtn);
    return block;
};

/** Build a `.current-image-data` container with positive + negative entries. */
const makeDataContainer = (): {
    container: HTMLElement;
    positiveCopy: HTMLButtonElement;
    negativeCopy: HTMLButtonElement;
} => {
    const container = document.createElement("div");
    container.className = "current-image-data";
    const positive = makeEntry("Prompt");
    const negative = makeEntry("Negative Prompt");
    container.appendChild(positive);
    container.appendChild(negative);
    document.body.appendChild(container);
    return {
        container,
        positiveCopy: positive.querySelector(
            ".prompt-copy-button",
        ) as HTMLButtonElement,
        negativeCopy: negative.querySelector(
            ".prompt-copy-button",
        ) as HTMLButtonElement,
    };
};

const metaWithPrompt = (prompt: string): string =>
    JSON.stringify({ sui_image_params: { prompt } });

const makeImg = (src: string, metadata: string): HTMLImageElement => {
    const img = document.createElement("img");
    img.dataset.src = src;
    img.dataset.metadata = metadata;
    return img;
};

const getTextarea = (): HTMLTextAreaElement =>
    document.getElementById(TEXTAREA_ID) as HTMLTextAreaElement;

describe("promptEdit", () => {
    let promptEditModule: PromptEditModule;

    beforeEach(async () => {
        jest.resetModules();
        globalThis.interpretMetadata = stubInterpretMetadata as never;
        globalThis.getImageFullSrc = stubGetImageFullSrc as never;
        promptEditModule = await import("./promptEdit");
    });

    afterEach(() => {
        for (const key of [
            "interpretMetadata",
            "genericRequest",
            "currentImageHelper",
            "setCurrentImage",
            "doNoticePopover",
            "showError",
            "currentMetadataVal",
            "getImageFullSrc",
            "$",
        ]) {
            delete g[key];
        }
    });

    describe("injectEditButtons", () => {
        it("injects exactly one edit button, after the POSITIVE copy button only", () => {
            const { positiveCopy, negativeCopy } = makeDataContainer();

            promptEditModule.injectEditButtons(document);

            const editButtons = document.querySelectorAll(`.${EDIT_BTN_CLASS}`);
            expect(editButtons.length).toBe(1);
            // The single edit button is the positive copy button's next sibling.
            expect(positiveCopy.nextElementSibling).toBe(editButtons[0]);
            // The negative copy button has no edit button after it.
            expect(negativeCopy.nextElementSibling).toBeNull();
        });

        it("is idempotent across repeated calls", () => {
            makeDataContainer();

            promptEditModule.injectEditButtons(document);
            promptEditModule.injectEditButtons(document);

            expect(document.querySelectorAll(`.${EDIT_BTN_CLASS}`).length).toBe(
                1,
            );
        });
    });

    describe("readPositivePrompt", () => {
        it("returns the positive prompt for valid SwarmUI JSON", () => {
            expect(
                promptEditModule.readPositivePrompt(
                    metaWithPrompt("a cat in a hat"),
                ),
            ).toBe("a cat in a hat");
        });

        it("returns '' for null", () => {
            expect(promptEditModule.readPositivePrompt(null)).toBe("");
        });

        it("returns '' for empty string", () => {
            expect(promptEditModule.readPositivePrompt("")).toBe("");
        });

        it("returns '' for malformed JSON", () => {
            expect(promptEditModule.readPositivePrompt("{not json")).toBe("");
        });

        it("returns '' for JSON lacking sui_image_params", () => {
            expect(
                promptEditModule.readPositivePrompt(JSON.stringify({ foo: 1 })),
            ).toBe("");
        });
    });

    describe("edit click", () => {
        it("prefills the textarea with the current prompt and shows the modal", () => {
            const modalCalls: string[] = [];
            const modalSelectors: string[] = [];
            const $mock = jest.fn((selector: string) => {
                modalSelectors.push(selector);
                return {
                    modal: (action: string) => {
                        modalCalls.push(action);
                    },
                };
            });
            globalThis.$ = $mock as never;
            const imgEl = makeImg("p.png", metaWithPrompt("hello prompt"));
            g.currentImageHelper = {
                getCurrentImage: () => imgEl,
            } as never;
            makeDataContainer();

            promptEditModule.promptEdit.init();
            promptEditModule.injectEditButtons(document);

            const editBtn = document.querySelector(
                `.${EDIT_BTN_CLASS}`,
            ) as HTMLButtonElement;
            editBtn.click();

            expect(getTextarea().value).toBe("hello prompt");
            expect(modalSelectors).toContain(`#${MODAL_ID}`);
            expect(modalCalls).toContain("show");
        });
    });

    describe("save", () => {
        const setupModalShown = (): { modalActions: string[] } => {
            const modalActions: string[] = [];
            globalThis.$ = jest.fn(() => ({
                modal: (action: string) => {
                    modalActions.push(action);
                },
            })) as never;
            return { modalActions };
        };

        const triggerSave = (): void => {
            (
                document.getElementById(
                    "wtd_prompt_edit_save",
                ) as HTMLButtonElement
            ).click();
        };

        it("sends the request and updates state on success", () => {
            const { modalActions } = setupModalShown();
            const genericRequest = jest.fn(
                (_ep: string, _body: unknown, cb: (d: unknown) => void) => {
                    cb({ success: true, metadata: "<<NEW>>" });
                },
            );
            globalThis.genericRequest = genericRequest as never;
            const setCurrentImage = jest.fn();
            globalThis.setCurrentImage = setCurrentImage as never;
            const doNoticePopover = jest.fn();
            globalThis.doNoticePopover = doNoticePopover as never;
            globalThis.showError = jest.fn() as never;
            g.currentMetadataVal = "old";

            const imgEl = makeImg("p.png", metaWithPrompt("old prompt"));
            g.currentImageHelper = {
                getCurrentImage: () => imgEl,
            } as never;

            promptEditModule.promptEdit.init();
            getTextarea().value = "edited prompt";
            triggerSave();

            expect(genericRequest).toHaveBeenCalledTimes(1);
            const [endpoint, body] = genericRequest.mock.calls[0];
            expect(endpoint).toBe("WhatTheDuckEditPrompt");
            expect(body).toEqual({ path: "p.png", prompt: "edited prompt" });

            expect(imgEl.dataset.metadata).toBe("<<NEW>>");
            expect(g.currentMetadataVal).toBe("<<NEW>>");
            expect(setCurrentImage).toHaveBeenCalledWith(
                "p.png",
                "<<NEW>>",
                "",
                false,
                false,
                false,
            );
            expect(doNoticePopover).toHaveBeenCalledWith(
                "Prompt updated",
                "notice-pop-green",
            );
            expect(modalActions).toContain("hide");
        });

        it("sends an empty prompt unchanged (no trim/validation gate)", () => {
            setupModalShown();
            const genericRequest = jest.fn(
                (_ep: string, _body: unknown, cb: (d: unknown) => void) => {
                    cb({ success: true, metadata: "<<NEW>>" });
                },
            );
            globalThis.genericRequest = genericRequest as never;
            globalThis.setCurrentImage = jest.fn() as never;
            globalThis.doNoticePopover = jest.fn() as never;
            globalThis.showError = jest.fn() as never;
            const imgEl = makeImg("p.png", metaWithPrompt("old"));
            g.currentImageHelper = {
                getCurrentImage: () => imgEl,
            } as never;

            promptEditModule.promptEdit.init();
            getTextarea().value = "   "; // whitespace-only, must be preserved
            triggerSave();

            const [, body] = genericRequest.mock.calls[0];
            expect(body).toEqual({ path: "p.png", prompt: "   " });
        });

        it("shows an error and mutates nothing on failure", () => {
            const { modalActions } = setupModalShown();
            const genericRequest = jest.fn(
                (_ep: string, _body: unknown, cb: (d: unknown) => void) => {
                    cb({ success: false, error: "nope" });
                },
            );
            globalThis.genericRequest = genericRequest as never;
            const setCurrentImage = jest.fn();
            globalThis.setCurrentImage = setCurrentImage as never;
            globalThis.doNoticePopover = jest.fn() as never;
            const showError = jest.fn();
            globalThis.showError = showError as never;

            const imgEl = makeImg("p.png", metaWithPrompt("keep me"));
            g.currentImageHelper = {
                getCurrentImage: () => imgEl,
            } as never;

            promptEditModule.promptEdit.init();
            getTextarea().value = "edited";
            triggerSave();

            expect(showError).toHaveBeenCalledWith("nope");
            // dataset.metadata unchanged.
            expect(imgEl.dataset.metadata).toBe(metaWithPrompt("keep me"));
            expect(setCurrentImage).not.toHaveBeenCalled();
            // Modal NOT hidden (no "hide" action issued).
            expect(modalActions).not.toContain("hide");
        });

        it("uses the freshly-read path at save time (staleness guard)", () => {
            setupModalShown();
            const genericRequest = jest.fn(
                (_ep: string, _body: unknown, _cb: (d: unknown) => void) => {
                    // Do not invoke cb — we only assert the outgoing path.
                },
            );
            globalThis.genericRequest = genericRequest as never;
            globalThis.setCurrentImage = jest.fn() as never;
            globalThis.doNoticePopover = jest.fn() as never;
            globalThis.showError = jest.fn() as never;

            const imgA = makeImg("a.png", metaWithPrompt("A"));
            const imgB = makeImg("b.png", metaWithPrompt("B"));
            let current = imgA;
            g.currentImageHelper = {
                getCurrentImage: () => current,
            } as never;

            promptEditModule.promptEdit.init();
            // Edit while current image is A.
            promptEditModule.injectEditButtons(document);
            // Swap to B before saving.
            current = imgB;
            getTextarea().value = "edited";
            triggerSave();

            const [, body] = genericRequest.mock.calls[0] as [
                string,
                { path: string },
                unknown,
            ];
            expect(body.path).toBe("b.png");
        });

        it("strips the display prefix from the path before sending", () => {
            setupModalShown();
            const genericRequest = jest.fn(
                (_ep: string, _body: unknown, _cb: (d: unknown) => void) => {
                    // Do not invoke cb — we only assert the outgoing path.
                },
            );
            globalThis.genericRequest = genericRequest as never;
            globalThis.setCurrentImage = jest.fn() as never;
            globalThis.doNoticePopover = jest.fn() as never;
            globalThis.showError = jest.fn() as never;
            const imgEl = makeImg(
                "Output/raw/2026-05-31/an-image.webp",
                metaWithPrompt("x"),
            );
            g.currentImageHelper = {
                getCurrentImage: () => imgEl,
            } as never;

            promptEditModule.promptEdit.init();
            getTextarea().value = "edited";
            triggerSave();

            const [, body] = genericRequest.mock.calls[0] as [
                string,
                { path: string },
                unknown,
            ];
            expect(body.path).toBe("raw/2026-05-31/an-image.webp");
        });
    });
});
