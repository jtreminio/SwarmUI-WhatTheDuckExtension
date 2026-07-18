/**
 * Model Auto-Folders: maps SwarmUI compat-class IDs (e.g. "flux-1") to
 * download folders. When a model URL lands in the Model Downloader, the
 * backend (`WhatTheDuckDetectModelArch`) fetches just the remote file's
 * metadata header, identifies the architecture, and the mapped folder and
 * Model Type are auto-selected in the downloader.
 */

export interface ArchFolderMapping {
    /** SwarmUI compat-class IDs, all mapping to the same folders. */
    architectures: string[];
    checkpointFolder: string;
    loraFolder: string;
}

/** Result of the backend's remote header probe. */
export interface ArchDetection {
    archId: string;
    archName: string;
    compatClass: string | null;
    isLora: boolean;
}

interface ArchDetectResponse {
    success: boolean;
    archId?: string;
    archName?: string;
    compatClass?: string | null;
    isLora?: boolean;
    reason?: string;
}

// --- Pure helpers (no I/O; directly unit-testable) ---------------------------

/**
 * Sanitize an untrusted mappings payload into well-formed rows (at least one
 * architecture and one folder each). Architectures are exclusive across rows:
 * one already claimed by an earlier kept row is dropped from later ones,
 * case-insensitively, matching `folderForDetection`. Never throws.
 */
export const normalizeMappings = (raw: unknown): ArchFolderMapping[] => {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result: ArchFolderMapping[] = [];
    const claimedKeys = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const rec = entry as Record<string, unknown>;
        const architectures: string[] = [];
        for (const value of Array.isArray(rec.architectures)
            ? rec.architectures
            : []) {
            if (typeof value !== "string") {
                continue;
            }
            const arch = value.trim();
            const key = arch.toLowerCase();
            if (
                arch &&
                !claimedKeys.has(key) &&
                !architectures.some((a) => a.toLowerCase() === key)
            ) {
                architectures.push(arch);
            }
        }
        const checkpointFolder =
            typeof rec.checkpointFolder === "string"
                ? rec.checkpointFolder.trim()
                : "";
        const loraFolder =
            typeof rec.loraFolder === "string" ? rec.loraFolder.trim() : "";
        if (architectures.length === 0 || (!checkpointFolder && !loraFolder)) {
            continue;
        }
        for (const arch of architectures) {
            claimedKeys.add(arch.toLowerCase());
        }
        result.push({ architectures, checkpointFolder, loraFolder });
    }
    return result;
};

/** The folder and downloader Model Type a detection result maps to. */
export interface FolderMatch {
    folder: string;
    modelType: "Stable-Diffusion" | "LoRA";
}

/**
 * Resolve the mapped folder for a detection: a row matches on compat class or
 * exact class ID (case-insensitive), `isLora` picks which of its two folders
 * applies, and the first matching row with a non-empty folder wins.
 */
export const folderForDetection = (
    mappings: ArchFolderMapping[],
    detection: ArchDetection,
): FolderMatch | null => {
    const keys = [detection.compatClass, detection.archId]
        .filter((key): key is string => !!key)
        .map((key) => key.trim().toLowerCase());
    if (keys.length === 0) {
        return null;
    }
    for (const mapping of mappings) {
        const matches = mapping.architectures.some((arch) =>
            keys.includes(arch.trim().toLowerCase()),
        );
        if (!matches) {
            continue;
        }
        const folder = detection.isLora
            ? mapping.loraFolder
            : mapping.checkpointFolder;
        if (folder) {
            return {
                folder,
                modelType: detection.isLora ? "LoRA" : "Stable-Diffusion",
            };
        }
    }
    return null;
};

/**
 * Whether a URL should trigger a header probe: a direct http(s) link to a
 * model file. Civitai hosts are excluded — their download URLs only exist
 * after metadata resolution, which the `getCivitaiMetadata` hook owns.
 */
export const shouldDetectUrl = (raw: string): boolean => {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
        host === "civitai.com" ||
        host === "civitai.red" ||
        host.endsWith(".civitai.com") ||
        host.endsWith(".civitai.red")
    ) {
        return false;
    }
    const path = parsed.pathname.toLowerCase();
    return (
        path.endsWith(".safetensors") ||
        path.endsWith(".sft") ||
        path.endsWith(".gguf")
    );
};

/**
 * Expand a model-name list (entries like "anima/some_model") into every
 * folder path it implies, matching the core `buildFolderSelector` expansion.
 */
export const foldersFromModelList = (models: string[]): string[] => {
    const folders = new Set<string>();
    for (const model of models) {
        const parts = model.split("/");
        for (let i = 1; i < parts.length; i++) {
            folders.add(parts.slice(0, i).join("/"));
        }
    }
    return Array.from(folders).sort();
};

// --- DOM helpers -------------------------------------------------------------

/**
 * Select `folder` in the downloader's folder dropdown, injecting the option
 * first if missing (the core selector only lists folders that already
 * contain a model).
 */
export const applyFolderSelection = (
    select: HTMLSelectElement,
    folder: string,
): void => {
    const exists = Array.from(select.options).some(
        (opt) => opt.value === folder,
    );
    if (!exists) {
        const option = document.createElement("option");
        option.textContent = folder;
        select.appendChild(option);
    }
    select.value = folder;
};

// --- Downloader hook ---------------------------------------------------------

export interface DownloaderLike {
    url: { value: string };
    type: { value: string };
    folders: HTMLSelectElement;
    urlInput(): void;
    getCivitaiMetadata(
        id: string | null,
        versId: string | null,
        callback: CivitaiMetadataCallback,
        identifier?: string,
        validateSafe?: boolean,
        delayedCallback?: CivitaiDelayedCallback | null,
    ): void;
}

export type DetectRequester = (
    url: string,
    callback: (detection: ArchDetection | null) => void,
) => void;

/** Install both detection hooks (`urlInput` and `getCivitaiMetadata`) on the downloader. */
export const patchDownloader = (
    downloader: DownloaderLike,
    getMappings: () => ArchFolderMapping[],
    detect: DetectRequester,
    debounceMs = 500,
): void => {
    // Monotonic sequence: only the latest URL's detection may touch the UI.
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runDetect = (url: string): void => {
        const mySeq = ++seq;
        detect(url, (detection) => {
            if (mySeq !== seq || !detection) {
                return;
            }
            const match = folderForDetection(getMappings(), detection);
            if (!match || downloader.url.value !== url) {
                return;
            }
            downloader.type.value = match.modelType;
            applyFolderSelection(downloader.folders, match.folder);
        });
    };

    const originalUrlInput = downloader.urlInput.bind(downloader);
    downloader.urlInput = () => {
        originalUrlInput();
        seq++;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        // Read AFTER the core handler: it may rewrite the input value.
        const url = downloader.url.value.trim();
        if (!shouldDetectUrl(url)) {
            return;
        }
        timer = setTimeout(() => {
            timer = null;
            runDetect(url);
        }, debounceMs);
    };

    const originalGetMetadata = downloader.getCivitaiMetadata.bind(downloader);
    downloader.getCivitaiMetadata = (
        id,
        versId,
        callback,
        identifier,
        validateSafe,
        delayedCallback,
    ) => {
        const wrapped: CivitaiMetadataCallback = (...args) => {
            callback(...args);
            const [rawData, , , , downloadUrl] = args;
            try {
                // Only the download page's flow passes a delayedCallback, and
                // its callback (just invoked above) commits the resolved
                // download URL to the URL input.
                if (
                    !rawData ||
                    !delayedCallback ||
                    !downloadUrl ||
                    downloader.url.value !== downloadUrl
                ) {
                    return;
                }
                runDetect(downloadUrl);
            } catch {
                // Never break the core download flow.
            }
        };
        originalGetMetadata(
            id,
            versId,
            wrapped,
            identifier,
            validateSafe,
            delayedCallback,
        );
    };
};

// --- Mutable module state ----------------------------------------------------

let mappings: ArchFolderMapping[] = [];
let started = false;

/** Called by the settings module whenever mappings are loaded or saved. */
export const setArchFolderMappings = (next: ArchFolderMapping[]): void => {
    mappings = next;
};

export const getArchFolderMappings = (): ArchFolderMapping[] => mappings;

const requestDetection: DetectRequester = (url, callback) => {
    genericRequest<ArchDetectResponse>(
        "WhatTheDuckDetectModelArch",
        { url },
        (data) => {
            callback(
                data?.success
                    ? {
                          archId: data.archId ?? "",
                          archName: data.archName ?? "",
                          compatClass: data.compatClass ?? null,
                          isLora: !!data.isLora,
                      }
                    : null,
            );
        },
    );
};

const init = (): void => {
    if (started) {
        return;
    }
    started = true;
    if (
        typeof modelDownloader === "undefined" ||
        typeof modelDownloader?.urlInput !== "function" ||
        typeof modelDownloader?.getCivitaiMetadata !== "function"
    ) {
        return;
    }
    patchDownloader(modelDownloader, () => mappings, requestDetection);
};

export const archFolders = {
    init,
};
