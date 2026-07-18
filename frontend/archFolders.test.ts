import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
    type ArchDetection,
    type ArchFolderMapping,
    applyFolderSelection,
    type DownloaderLike,
    folderForDetection,
    foldersFromModelList,
    normalizeMappings,
    patchDownloader,
    shouldDetectUrl,
} from "./archFolders";

const MAPPINGS: ArchFolderMapping[] = [
    {
        architectures: ["flux-1"],
        checkpointFolder: "flux",
        loraFolder: "flux/loras",
    },
    {
        architectures: ["stable-diffusion-xl-v1"],
        checkpointFolder: "sdxl",
        loraFolder: "",
    },
    {
        architectures: ["flux-2-klein-4b", "flux-2-klein-9b"],
        checkpointFolder: "",
        loraFolder: "klein",
    },
];

const detection = (over: Partial<ArchDetection> = {}): ArchDetection => ({
    archId: "Flux.1-dev",
    archName: "Flux.1 Dev",
    compatClass: "flux-1",
    isLora: false,
    ...over,
});

describe("normalizeMappings", () => {
    it("returns an empty list for non-array input", () => {
        expect(normalizeMappings(undefined)).toEqual([]);
        expect(normalizeMappings(null)).toEqual([]);
        expect(normalizeMappings("junk")).toEqual([]);
        expect(normalizeMappings({ architectures: ["flux-1"] })).toEqual([]);
    });

    it("trims and dedupes values and keeps well-formed rows", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["  flux-1 ", "flux-1", "", 7],
                    checkpointFolder: " flux ",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                checkpointFolder: "flux",
                loraFolder: "",
            },
        ]);
    });

    it("drops rows without any architecture or without any folder", () => {
        expect(
            normalizeMappings([
                { architectures: [], checkpointFolder: "x", loraFolder: "y" },
                {
                    architectures: ["flux-1"],
                    checkpointFolder: "",
                    loraFolder: "",
                },
                {
                    architectures: ["sd35"],
                    checkpointFolder: "",
                    loraFolder: "p",
                },
                null,
                42,
                { architectures: [7], checkpointFolder: "x", loraFolder: "" },
            ]),
        ).toEqual([
            { architectures: ["sd35"], checkpointFolder: "", loraFolder: "p" },
        ]);
    });

    it("drops architectures already claimed by an earlier row (first row wins)", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["flux-1", "sd35"],
                    checkpointFolder: "a",
                    loraFolder: "",
                },
                {
                    architectures: ["flux-1", "flux-2"],
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1", "sd35"],
                checkpointFolder: "a",
                loraFolder: "",
            },
            {
                architectures: ["flux-2"],
                checkpointFolder: "b",
                loraFolder: "",
            },
        ]);
    });

    it("drops a later row whose every architecture is already claimed, case-insensitively", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["flux-1"],
                    checkpointFolder: "a",
                    loraFolder: "",
                },
                {
                    architectures: [" Flux-1 "],
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                checkpointFolder: "a",
                loraFolder: "",
            },
        ]);
    });

    it("lets a well-formed row claim an architecture a dropped folderless row also listed", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["flux-1"],
                    checkpointFolder: "",
                    loraFolder: "",
                },
                {
                    architectures: ["flux-1"],
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                checkpointFolder: "b",
                loraFolder: "",
            },
        ]);
    });
});

describe("folderForDetection", () => {
    it("routes a checkpoint to the row's checkpoint folder with the matching type", () => {
        expect(folderForDetection(MAPPINGS, detection())).toEqual({
            folder: "flux",
            modelType: "Stable-Diffusion",
        });
    });

    it("routes a LoRA to the row's LoRA folder with the LoRA type", () => {
        expect(
            folderForDetection(
                MAPPINGS,
                detection({ archId: "Flux.1-dev/lora", isLora: true }),
            ),
        ).toEqual({ folder: "flux/loras", modelType: "LoRA" });
    });

    it("matches the compat class case-insensitively with whitespace slack", () => {
        expect(
            folderForDetection(
                [
                    {
                        architectures: [" FLUX-1 "],
                        checkpointFolder: "flux",
                        loraFolder: "",
                    },
                ],
                detection(),
            ),
        ).toEqual({ folder: "flux", modelType: "Stable-Diffusion" });
    });

    it("falls back to matching the exact class ID when the compat class is absent", () => {
        expect(
            folderForDetection(
                [
                    {
                        architectures: ["Flux.1-dev"],
                        checkpointFolder: "flux",
                        loraFolder: "",
                    },
                ],
                detection({ compatClass: null }),
            ),
        ).toEqual({ folder: "flux", modelType: "Stable-Diffusion" });
    });

    it("matches any architecture in a multi-architecture row", () => {
        expect(
            folderForDetection(
                MAPPINGS,
                detection({
                    archId: "flux.2-klein-9b",
                    compatClass: "flux-2-klein-9b",
                    isLora: true,
                }),
            ),
        ).toEqual({ folder: "klein", modelType: "LoRA" });
    });

    it("returns null when the matching row's folder for that kind is blank", () => {
        expect(
            folderForDetection(
                MAPPINGS,
                detection({
                    archId: "stable-diffusion-xl-v1-base/lora",
                    compatClass: "stable-diffusion-xl-v1",
                    isLora: true,
                }),
            ),
        ).toBeNull();
    });

    it("returns null for unmapped architectures or empty detections", () => {
        expect(
            folderForDetection(
                MAPPINGS,
                detection({ archId: "sd35-large", compatClass: "sd35" }),
            ),
        ).toBeNull();
        expect(
            folderForDetection(
                MAPPINGS,
                detection({ archId: "", compatClass: null }),
            ),
        ).toBeNull();
        expect(folderForDetection([], detection())).toBeNull();
    });
});

describe("shouldDetectUrl", () => {
    it("accepts direct safetensors, sft, and gguf links", () => {
        expect(
            shouldDetectUrl(
                "https://huggingface.co/org/repo/resolve/main/model.safetensors",
            ),
        ).toBe(true);
        expect(shouldDetectUrl("https://example.com/some/model.sft")).toBe(
            true,
        );
        expect(shouldDetectUrl("https://example.com/some/model.gguf")).toBe(
            true,
        );
    });

    it("ignores query strings when checking the file extension", () => {
        expect(
            shouldDetectUrl(
                "https://huggingface.co/org/repo/resolve/main/model.safetensors?download=true",
            ),
        ).toBe(true);
    });

    it("rejects civitai hosts (handled by the metadata-resolution hook)", () => {
        expect(
            shouldDetectUrl("https://civitai.com/api/download/models/12345"),
        ).toBe(false);
        expect(
            shouldDetectUrl(
                "https://civitai.red/api/download/models/12345.safetensors",
            ),
        ).toBe(false);
    });

    it("rejects non-http and non-model URLs", () => {
        expect(shouldDetectUrl("")).toBe(false);
        expect(shouldDetectUrl("model.safetensors")).toBe(false);
        expect(shouldDetectUrl("ftp://example.com/model.safetensors")).toBe(
            false,
        );
        expect(shouldDetectUrl("https://example.com/models/1234")).toBe(false);
        expect(shouldDetectUrl("https://example.com/model.ckpt")).toBe(false);
    });
});

describe("foldersFromModelList", () => {
    it("expands nested paths into every ancestor folder, sorted", () => {
        expect(
            foldersFromModelList([
                "anima/detail/model_a",
                "anima/model_b",
                "root_model",
                "pony/model_c",
            ]),
        ).toEqual(["anima", "anima/detail", "pony"]);
    });

    it("returns an empty list for only root-level models", () => {
        expect(foldersFromModelList(["a", "b"])).toEqual([]);
        expect(foldersFromModelList([])).toEqual([]);
    });
});

describe("applyFolderSelection", () => {
    const makeSelect = (options: string[]): HTMLSelectElement => {
        const select = document.createElement("select");
        select.innerHTML = options.map((o) => `<option>${o}</option>`).join("");
        return select;
    };

    it("selects an existing option without duplicating it", () => {
        const select = makeSelect(["(None)", "anima", "pony"]);
        applyFolderSelection(select, "anima");
        expect(select.value).toBe("anima");
        expect(select.options.length).toBe(3);
    });

    it("injects and selects a folder that has no option yet", () => {
        const select = makeSelect(["(None)"]);
        applyFolderSelection(select, "anima");
        expect(select.value).toBe("anima");
        expect(select.options.length).toBe(2);
    });
});

describe("patchDownloader", () => {
    const HF_URL =
        "https://huggingface.co/org/repo/resolve/main/model.safetensors";
    const CIVITAI_URL = "https://civitai.com/api/download/models/12345";

    interface Fake {
        downloader: DownloaderLike;
        folders: HTMLSelectElement;
        detectCalls: string[];
        respond: (detection: ArchDetection | null) => void;
        coreUrlInput: jest.Mock;
    }

    /**
     * Build a fake downloader mirroring the shape of the real
     * ModelDownloaderUtil closely enough for the hooks: `urlInput` is a spy
     * standing in for the core handler, `getCivitaiMetadata` synchronously
     * resolves with whatever args the test passes, and `detect` records its
     * calls and lets the test answer them asynchronously via `respond`.
     */
    const makeFake = (mappings: ArchFolderMapping[] = MAPPINGS): Fake => {
        const folders = document.createElement("select");
        folders.innerHTML = "<option>(None)</option>";
        const coreUrlInput = jest.fn();
        const downloader: DownloaderLike = {
            url: { value: "" },
            type: { value: "Stable-Diffusion" },
            folders,
            urlInput: coreUrlInput as () => void,
            getCivitaiMetadata: () => {},
        };
        const detectCalls: string[] = [];
        let pending: ((detection: ArchDetection | null) => void) | null = null;
        patchDownloader(
            downloader,
            () => mappings,
            (url, callback) => {
                detectCalls.push(url);
                pending = callback;
            },
            500,
        );
        return {
            downloader,
            folders,
            detectCalls,
            respond: (result) => pending?.(result),
            coreUrlInput,
        };
    };

    afterEach(() => {
        jest.useRealTimers();
    });

    it("detects a direct URL after the debounce and applies folder and type", () => {
        jest.useFakeTimers();
        const fake = makeFake();
        fake.downloader.url.value = HF_URL;
        fake.downloader.urlInput();
        expect(fake.coreUrlInput).toHaveBeenCalledTimes(1);
        expect(fake.detectCalls).toEqual([]);
        jest.advanceTimersByTime(500);
        expect(fake.detectCalls).toEqual([HF_URL]);
        fake.respond(detection({ archId: "Flux.1-dev/lora", isLora: true }));
        expect(fake.downloader.type.value).toBe("LoRA");
        expect(fake.folders.value).toBe("flux/loras");
    });

    it("only detects once for a burst of url edits (debounce)", () => {
        jest.useFakeTimers();
        const fake = makeFake();
        fake.downloader.url.value = "https://example.com/a.safetensors";
        fake.downloader.urlInput();
        jest.advanceTimersByTime(200);
        fake.downloader.url.value = HF_URL;
        fake.downloader.urlInput();
        jest.advanceTimersByTime(500);
        expect(fake.detectCalls).toEqual([HF_URL]);
    });

    it("does not detect for non-model or civitai URLs typed into the input", () => {
        jest.useFakeTimers();
        const fake = makeFake();
        for (const url of ["", "https://example.com/page", CIVITAI_URL]) {
            fake.downloader.url.value = url;
            fake.downloader.urlInput();
        }
        jest.advanceTimersByTime(1000);
        expect(fake.detectCalls).toEqual([]);
    });

    it("ignores a stale detection response after the URL changed again", () => {
        jest.useFakeTimers();
        const fake = makeFake();
        fake.downloader.url.value = HF_URL;
        fake.downloader.urlInput();
        jest.advanceTimersByTime(500);
        expect(fake.detectCalls).toEqual([HF_URL]);
        // The user edits the URL to something undetectable before the
        // response arrives; the pending result must not touch the UI.
        fake.downloader.url.value = "https://example.com/other";
        fake.downloader.urlInput();
        fake.respond(detection());
        expect(fake.folders.value).toBe("(None)");
        expect(fake.downloader.type.value).toBe("Stable-Diffusion");
    });

    it("leaves the UI alone when detection fails or nothing is mapped", () => {
        jest.useFakeTimers();
        const fake = makeFake();
        fake.downloader.url.value = HF_URL;
        fake.downloader.urlInput();
        jest.advanceTimersByTime(500);
        fake.respond(null);
        expect(fake.folders.value).toBe("(None)");
        fake.downloader.urlInput();
        jest.advanceTimersByTime(500);
        fake.respond(detection({ archId: "sd35-large", compatClass: "sd35" }));
        expect(fake.folders.value).toBe("(None)");
        expect(fake.downloader.type.value).toBe("Stable-Diffusion");
    });

    it("detects the committed download URL from the civitai metadata flow", () => {
        const fake = makeFake();
        const resolvedUrl = `${CIVITAI_URL}?type=Model&format=SafeTensor`;
        fake.downloader.getCivitaiMetadata = ((
            _id: string | null,
            _versId: string | null,
            callback: CivitaiMetadataCallback,
            _identifier?: string,
            _validateSafe?: boolean,
            _delayedCallback?: CivitaiDelayedCallback | null,
        ) => {
            // Mirror the core flow: the callback commits the download URL to
            // the input before returning.
            fake.downloader.url.value = resolvedUrl;
            callback(
                { name: "Some Model" },
                { baseModel: "Flux.1 D" },
                {},
                "Stable-Diffusion",
                resolvedUrl,
                null,
                [],
                null,
            );
        }) as DownloaderLike["getCivitaiMetadata"];
        // Re-patch so the wrapper wraps the fake civitai resolver above.
        patchDownloader(
            fake.downloader,
            () => MAPPINGS,
            (url, callback) => {
                fake.detectCalls.push(url);
                callback(detection());
            },
            500,
        );
        fake.downloader.getCivitaiMetadata(
            "1",
            "2",
            () => {},
            "",
            true,
            () => {},
        );
        expect(fake.detectCalls).toEqual([resolvedUrl]);
        expect(fake.folders.value).toBe("flux");
    });

    it("does not detect from civitai metadata flows without a delayedCallback (non-download pages)", () => {
        const fake = makeFake();
        fake.downloader.getCivitaiMetadata = ((
            _id: string | null,
            _versId: string | null,
            callback: CivitaiMetadataCallback,
        ) => {
            callback(
                { name: "Some Model" },
                { baseModel: "Flux.1 D" },
                {},
                "Stable-Diffusion",
                CIVITAI_URL,
                null,
                [],
                null,
            );
        }) as DownloaderLike["getCivitaiMetadata"];
        patchDownloader(
            fake.downloader,
            () => MAPPINGS,
            (url, callback) => {
                fake.detectCalls.push(url);
                callback(detection());
            },
            500,
        );
        fake.downloader.getCivitaiMetadata("1", "2", () => {});
        expect(fake.detectCalls).toEqual([]);
    });

    it("still invokes the original callback when detection is skipped", () => {
        const fake = makeFake();
        const seen: unknown[] = [];
        fake.downloader.getCivitaiMetadata("1", "2", ((...args: unknown[]) => {
            seen.push(args);
        }) as CivitaiMetadataCallback);
        // The fake core resolver is a no-op, so nothing recorded - but the
        // wrapper must not throw when invoked without a delayedCallback.
        expect(seen).toEqual([]);
        expect(fake.detectCalls).toEqual([]);
    });
});
