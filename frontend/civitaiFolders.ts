/**
 * Civitai Auto-Folders Module
 *
 * Lets the user map a civitai "base model" architecture string (e.g. "Anima",
 * "Pony", "Illustrious") to a destination folder for checkpoints and/or LoRAs.
 * When the Model Downloader utility resolves a civitai URL, the mapped folder
 * is auto-selected in the `model_downloader_folder` dropdown (the option is
 * injected first if no model exists in that folder yet).
 *
 * The hook wraps `modelDownloader.getCivitaiMetadata`. That method is also
 * used by the model browser's "load metadata" flow and the bulk metadata
 * utility, so the wrapper only reacts when the resolution came from the
 * download page itself: the download flow is the only caller that passes a
 * `delayedCallback`, and its callback assigns the resolved download URL to the
 * URL input — which also conveniently filters out stale (superseded) requests.
 */

import baseModelData from "../data/civitai-base-models.json";

export interface CivitaiFolderMapping {
    /** One row can match several civitai base-model labels (e.g. every
     * "Flux.2 Klein" flavor), all mapping to the same folders. */
    architectures: string[];
    checkpointFolder: string;
    loraFolder: string;
}

/**
 * Every base-model (architecture) name civitai's API can return, synced into
 * data/civitai-base-models.json by `npm run fetch:basemodels`. Saved values
 * missing from the list still render and match - the pickers inject them.
 */
export const KNOWN_ARCHITECTURES: string[] = baseModelData.baseModels;

// --- Pure helpers (no I/O; directly unit-testable) ---------------------------

/**
 * Sanitize an untrusted mappings payload into well-formed rows (at least one
 * architecture and one folder each). Accepts the legacy single-string
 * `architecture` key from pre-multi-select settings files. Never throws.
 */
export const normalizeMappings = (raw: unknown): CivitaiFolderMapping[] => {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result: CivitaiFolderMapping[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const rec = entry as Record<string, unknown>;
        const architectures: string[] = [];
        const addArchitecture = (value: unknown): void => {
            if (typeof value !== "string") {
                return;
            }
            const arch = value.trim();
            if (arch && !architectures.includes(arch)) {
                architectures.push(arch);
            }
        };
        if (Array.isArray(rec.architectures)) {
            for (const value of rec.architectures) {
                addArchitecture(value);
            }
        }
        addArchitecture(rec.architecture);
        const checkpointFolder =
            typeof rec.checkpointFolder === "string"
                ? rec.checkpointFolder.trim()
                : "";
        const loraFolder =
            typeof rec.loraFolder === "string" ? rec.loraFolder.trim() : "";
        if (architectures.length === 0 || (!checkpointFolder && !loraFolder)) {
            continue;
        }
        result.push({ architectures, checkpointFolder, loraFolder });
    }
    return result;
};

/**
 * Resolve the mapped folder for a resolved civitai model, or null when the
 * model type is not folder-mapped (only checkpoints and LoRAs are) or no
 * mapping matches. Architecture matching is case-insensitive on the civitai
 * `baseModel` string; first matching row wins.
 */
export const folderForModel = (
    mappings: CivitaiFolderMapping[],
    modelType: string | null | undefined,
    baseModel: string | null | undefined,
): string | null => {
    if (!baseModel) {
        return null;
    }
    const wanted = baseModel.trim().toLowerCase();
    for (const mapping of mappings) {
        const matches = mapping.architectures.some(
            (arch) => arch.trim().toLowerCase() === wanted,
        );
        if (!matches) {
            continue;
        }
        const folder =
            modelType === "Stable-Diffusion"
                ? mapping.checkpointFolder
                : modelType === "LoRA"
                  ? mapping.loraFolder
                  : "";
        if (folder) {
            return folder;
        }
    }
    return null;
};

/**
 * Expand a model-name list (entries like "anima/some_model") into the sorted
 * list of every folder path it implies — the same expansion the core
 * `buildFolderSelector` performs. Root-level models contribute nothing.
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
 * first when the folder does not exist yet (the core selector only lists
 * folders that already contain at least one model).
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
    folders: HTMLSelectElement;
    getCivitaiMetadata(
        id: string | null,
        versId: string | null,
        callback: CivitaiMetadataCallback,
        identifier?: string,
        validateSafe?: boolean,
        delayedCallback?: CivitaiDelayedCallback | null,
    ): void;
}

/**
 * Wrap `downloader.getCivitaiMetadata` so that download-page resolutions
 * auto-select the mapped folder. Exported for tests; production code calls it
 * once via `init()` with the real global `modelDownloader`.
 */
export const patchDownloader = (
    downloader: DownloaderLike,
    getMappings: () => CivitaiFolderMapping[],
): void => {
    const original = downloader.getCivitaiMetadata.bind(downloader);
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
            const [rawData, rawVersion, , modelType, downloadUrl] = args;
            try {
                if (
                    !rawData ||
                    !delayedCallback ||
                    !downloadUrl ||
                    downloader.url.value !== downloadUrl
                ) {
                    return;
                }
                const folder = folderForModel(
                    getMappings(),
                    modelType,
                    rawVersion?.baseModel,
                );
                if (folder) {
                    applyFolderSelection(downloader.folders, folder);
                }
            } catch {
                // Never let the auto-folder feature break the core download flow.
            }
        };
        original(
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

let mappings: CivitaiFolderMapping[] = [];
let started = false;

/** Called by the settings module whenever mappings are loaded or saved. */
export const setCivitaiFolderMappings = (
    next: CivitaiFolderMapping[],
): void => {
    mappings = next;
};

export const getCivitaiFolderMappings = (): CivitaiFolderMapping[] => mappings;

const init = (): void => {
    if (started) {
        return;
    }
    started = true;
    // Guard so jsdom (and any core downloader rework) degrade gracefully.
    if (
        typeof modelDownloader === "undefined" ||
        typeof modelDownloader?.getCivitaiMetadata !== "function"
    ) {
        return;
    }
    patchDownloader(modelDownloader, () => mappings);
};

export const civitaiFolders = {
    init,
};
