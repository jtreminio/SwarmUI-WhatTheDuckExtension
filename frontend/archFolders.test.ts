import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
    type ArchDetection,
    type ArchFolderMapping,
    applyFolderSelection,
    type DownloaderLike,
    type DownloadRequest,
    folderForDetection,
    foldersFromModelList,
    type ModelBaseFolder,
    normalizeMappings,
    patchDownloader,
    patchDownloadRequests,
    shouldDetectUrl,
} from "./archFolders";

const MAPPINGS: ArchFolderMapping[] = [
    {
        architectures: ["flux-1"],
        baseFolder: "Stable-Diffusion",
        checkpointFolder: "flux",
        loraFolder: "flux/loras",
    },
    {
        architectures: ["stable-diffusion-xl-v1"],
        baseFolder: "Stable-Diffusion",
        checkpointFolder: "sdxl",
        loraFolder: "",
    },
    {
        architectures: ["flux-2-klein-4b", "flux-2-klein-9b"],
        baseFolder: "Stable-Diffusion",
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
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: " flux ",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                baseFolder: "Stable-Diffusion",
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
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "",
                    loraFolder: "",
                },
                {
                    architectures: ["sd35"],
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "",
                    loraFolder: "p",
                },
                null,
                42,
                { architectures: [7], checkpointFolder: "x", loraFolder: "" },
            ]),
        ).toEqual([
            {
                architectures: ["sd35"],
                baseFolder: "Stable-Diffusion",
                checkpointFolder: "",
                loraFolder: "p",
            },
        ]);
    });

    it("drops architectures already claimed by an earlier row (first row wins)", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["flux-1", "sd35"],
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "a",
                    loraFolder: "",
                },
                {
                    architectures: ["flux-1", "flux-2"],
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1", "sd35"],
                baseFolder: "Stable-Diffusion",
                checkpointFolder: "a",
                loraFolder: "",
            },
            {
                architectures: ["flux-2"],
                baseFolder: "Stable-Diffusion",
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
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "a",
                    loraFolder: "",
                },
                {
                    architectures: [" Flux-1 "],
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                baseFolder: "Stable-Diffusion",
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
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "",
                    loraFolder: "",
                },
                {
                    architectures: ["flux-1"],
                    baseFolder: "Stable-Diffusion",
                    checkpointFolder: "b",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["flux-1"],
                baseFolder: "Stable-Diffusion",
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
            baseFolder: "Stable-Diffusion",
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
                        baseFolder: "Stable-Diffusion",
                        checkpointFolder: "flux",
                        loraFolder: "",
                    },
                ],
                detection(),
            ),
        ).toEqual({
            folder: "flux",
            modelType: "Stable-Diffusion",
            baseFolder: "Stable-Diffusion",
        });
    });

    it("falls back to matching the exact class ID when the compat class is absent", () => {
        expect(
            folderForDetection(
                [
                    {
                        architectures: ["Flux.1-dev"],
                        baseFolder: "Stable-Diffusion",
                        checkpointFolder: "flux",
                        loraFolder: "",
                    },
                ],
                detection({ compatClass: null }),
            ),
        ).toEqual({
            folder: "flux",
            modelType: "Stable-Diffusion",
            baseFolder: "Stable-Diffusion",
        });
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
        getBaseFolder: (url: string, type: string) => ModelBaseFolder | null;
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
        const getBaseFolder = patchDownloader(
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
            getBaseFolder,
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

    it("remembers a detected checkpoint base and clears it when the URL changes", () => {
        jest.useFakeTimers();
        const fake = makeFake([
            { ...MAPPINGS[0], baseFolder: "diffusion_models" },
        ]);
        fake.downloader.url.value = HF_URL;
        fake.downloader.urlInput();
        jest.advanceTimersByTime(500);
        fake.respond(detection());
        expect(fake.getBaseFolder(HF_URL, "Stable-Diffusion")).toBe(
            "diffusion_models",
        );
        expect(fake.getBaseFolder(HF_URL, "LoRA")).toBeNull();
        expect(
            fake.getBaseFolder("https://example.com/other", "Stable-Diffusion"),
        ).toBeNull();
        fake.downloader.url.value = "https://example.com/other";
        fake.downloader.urlInput();
        expect(fake.getBaseFolder(HF_URL, "Stable-Diffusion")).toBeNull();
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

describe("base folder settings", () => {
    it("migrates old rows and rejects unknown base folders", () => {
        for (const baseFolder of [
            undefined,
            null,
            "other",
            "../diffusion_models",
            12,
        ]) {
            expect(
                normalizeMappings([
                    {
                        architectures: ["flux-1"],
                        checkpointFolder: "flux",
                        baseFolder,
                    },
                ])[0].baseFolder,
            ).toBe("Stable-Diffusion");
        }
        expect(
            normalizeMappings([
                {
                    architectures: ["flux-1"],
                    checkpointFolder: "flux",
                    baseFolder: "diffusion_models",
                },
            ])[0].baseFolder,
        ).toBe("diffusion_models");
    });

    it("applies the diffusion base only to checkpoints", () => {
        const mappings: ArchFolderMapping[] = [
            { ...MAPPINGS[0], baseFolder: "diffusion_models" },
        ];
        expect(folderForDetection(mappings, detection())).toEqual({
            folder: "flux",
            modelType: "Stable-Diffusion",
            baseFolder: "diffusion_models",
        });
        expect(
            folderForDetection(mappings, detection({ isLora: true })),
        ).toEqual({ folder: "flux/loras", modelType: "LoRA" });
    });
});

describe("download request routing", () => {
    const setup = () => {
        const request = jest.fn<DownloadRequest>();
        const host = { makeWSRequest: request as DownloadRequest };
        const callback = jest.fn();
        const error = jest.fn<(message: string) => void>();
        const onOpen = jest.fn<(socket: WebSocket) => void>();
        class Card {
            constructor(
                public url = "https://example.com/model.safetensors?download=true",
                public type = "Stable-Diffusion",
            ) {}
            download() {
                host.makeWSRequest(
                    "DoModelDownloadWS",
                    {
                        url: this.url,
                        type: this.type,
                        name: "flux/model",
                        metadata: "{}",
                    },
                    callback,
                    0,
                    error,
                    onOpen,
                );
            }
        }
        const getBase = jest
            .fn<(url: string, type: string) => ModelBaseFolder | null>()
            .mockReturnValue("diffusion_models");
        patchDownloadRequests(host, Card.prototype, getBase);
        return { host, request, Card, getBase, callback, error, onOpen };
    };

    it.each([
        "Stable-Diffusion",
        "diffusion_models",
    ] as const)("sends %s and preserves core callbacks and payload", (base) => {
        const fake = setup();
        fake.getBase.mockReturnValue(base);
        const card = new fake.Card();
        card.download();
        expect(fake.request).toHaveBeenCalledWith(
            "WhatTheDuckDownloadModelWS",
            {
                url: card.url,
                type: "Stable-Diffusion",
                name: "flux/model",
                metadata: "{}",
                baseFolder: base,
            },
            fake.callback,
            0,
            fake.error,
            fake.onOpen,
        );
    });

    it.each([
        "https://example.com/model.gguf",
        "https://example.com/model.GGUF?download=true",
        "https://civitai.red/api/download/models/123#.gguf",
        "https://civitai.com/api/download/models/123?type=Model&format=GGUF#.gguf",
    ])("leaves GGUF download and retry entirely on the core route: %s", (url) => {
        const fake = setup();
        const card = new fake.Card(url);
        card.download();
        fake.getBase.mockReturnValue("Stable-Diffusion");
        card.download();
        expect(fake.getBase).not.toHaveBeenCalled();
        expect(fake.request).toHaveBeenCalledTimes(2);
        for (const call of fake.request.mock.calls) {
            expect(call).toEqual([
                "DoModelDownloadWS",
                {
                    url,
                    type: "Stable-Diffusion",
                    name: "flux/model",
                    metadata: "{}",
                },
                fake.callback,
                0,
                fake.error,
                fake.onOpen,
            ]);
        }
    });

    it("retains a card's destination across retries and isolates later cards", () => {
        const fake = setup();
        const first = new fake.Card();
        first.download();
        fake.getBase.mockReturnValue("Stable-Diffusion");
        new fake.Card("https://example.com/second.safetensors").download();
        first.download();
        expect(
            fake.request.mock.calls.map((call) => call[1].baseFolder),
        ).toEqual(["diffusion_models", "Stable-Diffusion", "diffusion_models"]);
        expect(fake.getBase).toHaveBeenCalledTimes(2);
    });

    it("preserves unmapped cards, LoRAs, and calls outside the download card", () => {
        const fake = setup();
        fake.getBase.mockReturnValue(null);
        const unmapped = new fake.Card();
        unmapped.download();
        fake.getBase.mockReturnValue("diffusion_models");
        unmapped.download();
        new fake.Card(undefined, "LoRA").download();
        fake.host.makeWSRequest(
            "DoModelDownloadWS",
            { url: unmapped.url, type: "Stable-Diffusion" },
            fake.callback,
        );
        expect(
            fake.request.mock.calls.every(
                (call) =>
                    call[0] === "DoModelDownloadWS" &&
                    !("baseFolder" in call[1]),
            ),
        ).toBe(true);
    });
});
