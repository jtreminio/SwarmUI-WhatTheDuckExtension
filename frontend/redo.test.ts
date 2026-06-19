import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

/**
 * redo exercises SwarmUI globals (interpretMetadata, currentImageHelper,
 * currentMetadataVal, mainGenHandler, registerMediaButton, showError) and
 * latches an internal `registered` flag in init(). Each test re-imports the
 * module fresh via jest.resetModules() + dynamic import so the latch never leaks
 * between tests (the documented pattern for the attached-flag modules).
 */

type RedoModule = typeof import("./redo");

// `currentImageHelper`/`currentMetadataVal`/`mainGenHandler` are declared as
// `const`/`let` (not `function`) in globals.d.ts, so TypeScript does not treat
// them as members of the `globalThis` type. Route stubs through this
// index-signature view (the same trick promptEdit.test.ts uses).
const g = globalThis as unknown as Record<string, unknown>;

// interpretMetadata stub mirroring real behavior: echoes its arg when it looks
// like JSON (starts with "{"), else returns null (unrecognized).
const stubInterpretMetadata = (raw: unknown): string | null => {
    if (typeof raw === "string" && raw.trimStart().startsWith("{")) {
        return raw;
    }
    return null;
};

const makeImg = (metadata: string | undefined): HTMLImageElement => {
    const img = document.createElement("img");
    if (metadata !== undefined) {
        img.dataset.metadata = metadata;
    }
    return img;
};

describe("redo", () => {
    let redoModule: RedoModule;

    beforeEach(async () => {
        jest.resetModules();
        globalThis.interpretMetadata = stubInterpretMetadata as never;
        redoModule = await import("./redo");
    });

    afterEach(() => {
        for (const key of [
            "interpretMetadata",
            "currentImageHelper",
            "currentMetadataVal",
            "mainGenHandler",
            "registerMediaButton",
            "showError",
        ]) {
            delete g[key];
        }
    });

    describe("parseSwarmMetadata", () => {
        it("parses valid SwarmUI JSON", () => {
            const raw = JSON.stringify({
                sui_image_params: { prompt: "a cat", seed: 5 },
            });
            expect(redoModule.parseSwarmMetadata(raw)).toEqual({
                sui_image_params: { prompt: "a cat", seed: 5 },
            });
        });

        it("returns null for null/empty input", () => {
            expect(redoModule.parseSwarmMetadata(null)).toBeNull();
            expect(redoModule.parseSwarmMetadata(undefined)).toBeNull();
            expect(redoModule.parseSwarmMetadata("")).toBeNull();
        });

        it("returns null for malformed JSON", () => {
            expect(redoModule.parseSwarmMetadata("{not json")).toBeNull();
        });

        it("returns null for JSON lacking sui_image_params", () => {
            expect(
                redoModule.parseSwarmMetadata(JSON.stringify({ foo: 1 })),
            ).toBeNull();
        });
    });

    describe("buildRedoInput", () => {
        it("reuses every param but forces seed=-1 and a single image", () => {
            const input = redoModule.buildRedoInput({
                sui_image_params: {
                    prompt: "a cat",
                    negativeprompt: "blurry",
                    model: "sdxl",
                    cfgscale: 7,
                    steps: 30,
                    seed: 12345,
                    images: 4,
                    batchsize: 2,
                },
            });
            expect(input).toEqual({
                prompt: "a cat",
                negativeprompt: "blurry",
                model: "sdxl",
                cfgscale: 7,
                steps: 30,
                seed: -1,
                images: 1,
                batchsize: 1,
            });
        });

        it("uses the FINAL prompt verbatim (no original swap)", () => {
            const input = redoModule.buildRedoInput({
                sui_image_params: { prompt: "resolved final text" },
                sui_extra_data: { original_prompt: "<wildcard:animals>" },
            });
            expect(input.prompt).toBe("resolved final text");
        });

        it("drops swarm_version (a non-parameter metadata stamp)", () => {
            const input = redoModule.buildRedoInput({
                sui_image_params: { prompt: "x", swarm_version: "0.9.9" },
            });
            expect("swarm_version" in input).toBe(false);
        });

        it("carries original_prompt/original_negativeprompt into extra_metadata", () => {
            const input = redoModule.buildRedoInput({
                sui_image_params: {
                    prompt: "final",
                    negativeprompt: "negfinal",
                },
                sui_extra_data: {
                    original_prompt: "<wildcard:a>",
                    original_negativeprompt: "<wildcard:b>",
                    generation_time: "1.23 seconds",
                },
            });
            expect(input.extra_metadata).toEqual({
                original_prompt: "<wildcard:a>",
                original_negativeprompt: "<wildcard:b>",
            });
        });

        it("omits extra_metadata when there is no original prompt to preserve", () => {
            const input = redoModule.buildRedoInput({
                sui_image_params: { prompt: "final" },
                sui_extra_data: { generation_time: "1.23 seconds" },
            });
            expect("extra_metadata" in input).toBe(false);
        });
    });

    describe("init", () => {
        it("registers a 'Redo' button in the More dropdown", () => {
            const registerMediaButton = jest.fn();
            globalThis.registerMediaButton = registerMediaButton as never;

            redoModule.redo.init();

            expect(registerMediaButton).toHaveBeenCalledTimes(1);
            const [name, action, , mediaTypes, isDefault, showInHistory] =
                registerMediaButton.mock.calls[0];
            expect(name).toBe("Redo");
            expect(typeof action).toBe("function");
            expect(mediaTypes).toEqual(["image", "video"]);
            // Not promoted to the always-visible row.
            expect(isDefault).toBe(false);
            // Must be true or the button never renders (even on the current image).
            expect(showInHistory).toBe(true);
        });

        it("is idempotent across repeated calls", () => {
            const registerMediaButton = jest.fn();
            globalThis.registerMediaButton = registerMediaButton as never;

            redoModule.redo.init();
            redoModule.redo.init();

            expect(registerMediaButton).toHaveBeenCalledTimes(1);
        });

        it("no-ops when registerMediaButton is unavailable", () => {
            expect(() => redoModule.redo.init()).not.toThrow();
        });
    });

    describe("redo click", () => {
        // Wires up the module and returns the action handed to registerMediaButton.
        const initAndGetAction = (): ((src: string) => void) => {
            let action: ((src: string) => void) | null = null;
            const registerMediaButton = jest.fn(
                (_name: string, act: (src: string) => void) => {
                    action = act;
                },
            );
            globalThis.registerMediaButton = registerMediaButton as never;
            redoModule.redo.init();
            if (!action) {
                throw new Error("action was not registered");
            }
            return action;
        };

        it("regenerates from the current image's metadata, swapping in the redo payload", () => {
            const meta = JSON.stringify({
                sui_image_params: {
                    prompt: "a cat",
                    model: "sdxl",
                    seed: 999,
                },
                sui_extra_data: { original_prompt: "<wildcard:animals>" },
            });
            g.currentImageHelper = {
                getCurrentImage: () => makeImg(meta),
            } as never;

            let captured: ((input: Record<string, unknown>) => void) | null =
                null;
            const doGenerate = jest.fn(
                (
                    _overrides: unknown,
                    _preoverrides: unknown,
                    postCollectRun: (i: Record<string, unknown>) => void,
                ) => {
                    captured = postCollectRun;
                },
            );
            g.mainGenHandler = { doGenerate } as never;
            globalThis.showError = jest.fn() as never;

            initAndGetAction()("some-src.png");

            expect(doGenerate).toHaveBeenCalledTimes(1);
            expect(captured).not.toBeNull();

            // Simulate doGenerate's collected, UI-derived request object; the
            // postCollectRun must replace its contents entirely.
            const actualInput: Record<string, unknown> = {
                prompt: "WHATEVER IS TYPED IN THE UI",
                loras: ["leaked-ui-lora"],
                presets: ["leaked"],
                extra_metadata: { foo: "bar" },
            };
            (captured as unknown as (i: Record<string, unknown>) => void)(
                actualInput,
            );

            expect(actualInput).toEqual({
                prompt: "a cat",
                model: "sdxl",
                seed: -1,
                images: 1,
                batchsize: 1,
                extra_metadata: { original_prompt: "<wildcard:animals>" },
            });
            // The leaked UI-only keys are gone.
            expect("loras" in actualInput).toBe(false);
            expect("presets" in actualInput).toBe(false);
        });

        it("falls back to currentMetadataVal when no current image element", () => {
            g.currentImageHelper = {
                getCurrentImage: (): HTMLImageElement | null => null,
            } as never;
            g.currentMetadataVal = JSON.stringify({
                sui_image_params: { prompt: "fallback", seed: 1 },
            });
            const doGenerate = jest.fn();
            g.mainGenHandler = { doGenerate } as never;
            globalThis.showError = jest.fn() as never;

            initAndGetAction()("src.png");

            expect(doGenerate).toHaveBeenCalledTimes(1);
        });

        it("shows an error and does not generate when no metadata is available", () => {
            g.currentImageHelper = {
                getCurrentImage: (): HTMLImageElement | null => null,
            } as never;
            g.currentMetadataVal = null;
            const doGenerate = jest.fn();
            g.mainGenHandler = { doGenerate } as never;
            const showError = jest.fn();
            globalThis.showError = showError as never;

            initAndGetAction()("src.png");

            expect(doGenerate).not.toHaveBeenCalled();
            expect(showError).toHaveBeenCalledWith(
                "No image parameters available to redo.",
            );
        });
    });
});
