import { describe, expect, it, jest } from "@jest/globals";
import {
    applyFolderSelection,
    type CivitaiFolderMapping,
    type DownloaderLike,
    folderForModel,
    foldersFromModelList,
    normalizeMappings,
    patchDownloader,
} from "./civitaiFolders";

const MAPPINGS: CivitaiFolderMapping[] = [
    {
        architectures: ["Anima"],
        checkpointFolder: "anima",
        loraFolder: "anima",
    },
    { architectures: ["Pony"], checkpointFolder: "pony/ckpt", loraFolder: "" },
    {
        architectures: ["SDXL 1.0", "NoobAI"],
        checkpointFolder: "",
        loraFolder: "sdxl",
    },
];

describe("normalizeMappings", () => {
    it("returns an empty list for non-array input", () => {
        expect(normalizeMappings(undefined)).toEqual([]);
        expect(normalizeMappings(null)).toEqual([]);
        expect(normalizeMappings("junk")).toEqual([]);
        expect(normalizeMappings({ architectures: ["Anima"] })).toEqual([]);
    });

    it("trims and dedupes values and keeps well-formed rows", () => {
        expect(
            normalizeMappings([
                {
                    architectures: ["  Anima ", "Anima", "", 7],
                    checkpointFolder: " anima ",
                    loraFolder: "",
                },
            ]),
        ).toEqual([
            {
                architectures: ["Anima"],
                checkpointFolder: "anima",
                loraFolder: "",
            },
        ]);
    });

    it("migrates legacy single-architecture rows to the array shape", () => {
        expect(
            normalizeMappings([
                { architecture: "Anima", checkpointFolder: "anima" },
            ]),
        ).toEqual([
            {
                architectures: ["Anima"],
                checkpointFolder: "anima",
                loraFolder: "",
            },
        ]);
    });

    it("drops rows without any architecture or without any folder", () => {
        expect(
            normalizeMappings([
                { architectures: [], checkpointFolder: "x", loraFolder: "y" },
                {
                    architectures: ["Anima"],
                    checkpointFolder: "",
                    loraFolder: "",
                },
                {
                    architectures: ["Pony"],
                    checkpointFolder: "",
                    loraFolder: "p",
                },
                null,
                42,
                { architectures: [7], checkpointFolder: "x", loraFolder: "" },
            ]),
        ).toEqual([
            { architectures: ["Pony"], checkpointFolder: "", loraFolder: "p" },
        ]);
    });
});

describe("folderForModel", () => {
    it("routes checkpoints to the checkpoint folder", () => {
        expect(folderForModel(MAPPINGS, "Stable-Diffusion", "Anima")).toBe(
            "anima",
        );
    });

    it("routes LoRAs to the LoRA folder", () => {
        expect(folderForModel(MAPPINGS, "LoRA", "Anima")).toBe("anima");
    });

    it("matches the architecture case-insensitively with whitespace slack", () => {
        expect(folderForModel(MAPPINGS, "LoRA", "  aNiMa ")).toBe("anima");
        expect(folderForModel(MAPPINGS, "Stable-Diffusion", "sdxl 1.0")).toBe(
            null,
        );
        expect(folderForModel(MAPPINGS, "LoRA", "sdxl 1.0")).toBe("sdxl");
    });

    it("matches any architecture in a multi-architecture row", () => {
        const klein: CivitaiFolderMapping[] = [
            {
                architectures: [
                    "Flux.2 Klein 4B",
                    "Flux.2 Klein 4B-base",
                    "Flux.2 Klein 9B",
                    "Flux.2 Klein 9B-base",
                ],
                checkpointFolder: "klein",
                loraFolder: "klein/loras",
            },
        ];
        expect(
            folderForModel(klein, "Stable-Diffusion", "Flux.2 Klein 4B"),
        ).toBe("klein");
        expect(folderForModel(klein, "LoRA", "Flux.2 Klein 9B-base")).toBe(
            "klein/loras",
        );
        expect(folderForModel(klein, "LoRA", "Flux.2 D")).toBeNull();
    });

    it("returns null when the mapped folder for that type is blank", () => {
        expect(folderForModel(MAPPINGS, "LoRA", "Pony")).toBeNull();
    });

    it("returns null for unmapped architectures and model types", () => {
        expect(folderForModel(MAPPINGS, "Stable-Diffusion", "Flux.1 D")).toBe(
            null,
        );
        expect(folderForModel(MAPPINGS, "Embedding", "Anima")).toBeNull();
        expect(folderForModel(MAPPINGS, null, "Anima")).toBeNull();
        expect(folderForModel(MAPPINGS, "LoRA", null)).toBeNull();
        expect(folderForModel(MAPPINGS, "LoRA", undefined)).toBeNull();
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
    interface FakeCallbackArgs {
        rawData: { name?: string } | null;
        rawVersion: { baseModel?: string } | null;
        modelType: string | null;
        downloadUrl: string | null;
    }

    /**
     * Build a fake downloader whose getCivitaiMetadata synchronously invokes
     * the callback with the given resolution result — mirroring the shape of
     * the real ModelDownloaderUtil closely enough for the wrapper.
     */
    const makeDownloader = (
        result: FakeCallbackArgs,
    ): { downloader: DownloaderLike; folders: HTMLSelectElement } => {
        const folders = document.createElement("select");
        folders.innerHTML = "<option>(None)</option>";
        const downloader: DownloaderLike = {
            url: { value: "" },
            folders,
            getCivitaiMetadata: (_id, _versId, callback) => {
                callback(
                    result.rawData,
                    result.rawVersion,
                    result.rawData ? {} : null,
                    result.modelType,
                    result.downloadUrl,
                    null,
                    [],
                    result.rawData ? null : "err",
                );
            },
        };
        return { downloader, folders };
    };

    const RESOLVED: FakeCallbackArgs = {
        rawData: { name: "Posing Dynamics" },
        rawVersion: { baseModel: "Anima" },
        modelType: "LoRA",
        downloadUrl: "https://civitai.com/api/download/models/3026653",
    };

    // The urlInput() callback assigns the resolved URL into the URL input;
    // that assignment is what marks the resolution as the download-page flow.
    const urlInputStyleCallback =
        (downloader: DownloaderLike): CivitaiMetadataCallback =>
        (rawData, _rawVersion, _metadata, _modelType, downloadUrl) => {
            if (rawData && downloadUrl) {
                downloader.url.value = downloadUrl;
            }
        };

    it("auto-selects the mapped folder for the download-page flow", () => {
        const { downloader, folders } = makeDownloader(RESOLVED);
        patchDownloader(downloader, () => MAPPINGS);
        downloader.getCivitaiMetadata(
            "1185671",
            "3026653",
            urlInputStyleCallback(downloader),
            "",
            true,
            () => {},
        );
        expect(folders.value).toBe("anima");
    });

    it("does nothing when no delayedCallback is passed (non-download flows)", () => {
        const { downloader, folders } = makeDownloader(RESOLVED);
        patchDownloader(downloader, () => MAPPINGS);
        downloader.getCivitaiMetadata(
            "1185671",
            "3026653",
            urlInputStyleCallback(downloader),
        );
        expect(folders.value).toBe("(None)");
    });

    it("does nothing when the callback did not commit the URL (stale request)", () => {
        const { downloader, folders } = makeDownloader(RESOLVED);
        patchDownloader(downloader, () => MAPPINGS);
        const staleCallback: CivitaiMetadataCallback = () => {
            // Simulates urlInput's requestId guard: a superseded request
            // returns early without touching the URL input.
        };
        downloader.url.value = "https://example.com/other";
        downloader.getCivitaiMetadata(
            "1185671",
            "3026653",
            staleCallback,
            "",
            true,
            () => {},
        );
        expect(folders.value).toBe("(None)");
    });

    it("leaves the folder alone when no mapping matches", () => {
        const { downloader, folders } = makeDownloader({
            ...RESOLVED,
            rawVersion: { baseModel: "Flux.1 D" },
        });
        patchDownloader(downloader, () => MAPPINGS);
        downloader.getCivitaiMetadata(
            "1",
            "2",
            urlInputStyleCallback(downloader),
            "",
            true,
            () => {},
        );
        expect(folders.value).toBe("(None)");
    });

    it("still invokes the original callback on resolution failure", () => {
        const { downloader, folders } = makeDownloader({
            rawData: null,
            rawVersion: null,
            modelType: null,
            downloadUrl: null,
        });
        patchDownloader(downloader, () => MAPPINGS);
        const callback = jest.fn();
        downloader.getCivitaiMetadata("1", "2", callback, "", true, () => {});
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeNull();
        expect(folders.value).toBe("(None)");
    });

    it("passes all callback arguments through unchanged", () => {
        const { downloader } = makeDownloader(RESOLVED);
        patchDownloader(downloader, () => MAPPINGS);
        const callback = jest.fn();
        downloader.getCivitaiMetadata("1", "2", callback, "", true, () => {});
        expect(callback).toHaveBeenCalledWith(
            RESOLVED.rawData,
            RESOLVED.rawVersion,
            {},
            RESOLVED.modelType,
            RESOLVED.downloadUrl,
            null,
            [],
            null,
        );
    });

    it("never lets a folder-selection error break the core callback", () => {
        const { downloader } = makeDownloader(RESOLVED);
        // A folders object that throws on any access.
        Object.defineProperty(downloader, "folders", {
            get: () => {
                throw new Error("boom");
            },
        });
        patchDownloader(downloader, () => MAPPINGS);
        const callback = jest.fn().mockImplementation((...args: unknown[]) => {
            const downloadUrl = args[4] as string | null;
            if (downloadUrl) {
                downloader.url.value = downloadUrl;
            }
        });
        expect(() =>
            downloader.getCivitaiMetadata(
                "1",
                "2",
                callback as CivitaiMetadataCallback,
                "",
                true,
                () => {},
            ),
        ).not.toThrow();
        expect(callback).toHaveBeenCalledTimes(1);
    });
});
