declare function registerNewTool(id: string, name: string): HTMLElement;

/**
 * Callback signature of SwarmUI's `ModelDownloaderUtil.getCivitaiMetadata`.
 * `rawData`/`rawVersion` are raw civitai API objects; on failure every
 * argument except `errMsg` is null.
 */
type CivitaiMetadataCallback = (
    rawData: { name?: string } | null,
    rawVersion: { baseModel?: string; name?: string } | null,
    metadata: Record<string, string> | null,
    modelType: string | null,
    downloadUrl: string | null,
    img: string | null,
    imgs: string[] | null,
    errMsg: string | null,
) => void;

type CivitaiDelayedCallback = (img: string | null, imgs: string[]) => void;

/** SwarmUI's global Model Downloader utility instance (utiltab.js). */
declare var modelDownloader:
    | {
          url: HTMLInputElement;
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
    | undefined;

/** SwarmUI's global model listing: model type (e.g. "Stable-Diffusion",
 * "LoRA") to model names, where names may contain folder paths. */
declare var coreModelMap: Record<string, string[]> | undefined;

declare function genericRequest<T = unknown>(
    endpoint: string,
    data: Record<string, unknown>,
    callback: (data: T) => void,
): void;

declare function getMediaType(src: string): string;

declare function showError(message: string): void;

interface CompareItem {
    src: string;
    mediaType: string;
}

interface CompareSelectionResult {
    state: string;
    reason?: string;
}

declare const imageCompareHelper: {
    evaluateSelection(items: CompareItem[]): CompareSelectionResult;
    isShowingPair(a: CompareItem, b: CompareItem): boolean;
    isOpen(): boolean;
    reset(): void;
    showComparison(a: CompareItem, b: CompareItem): void;
};

declare const mainGenHandler: {
    doInterrupt(): void;
    doGenerate(
        inputOverrides?: Record<string, unknown>,
        inputPreOverrides?: Record<string, unknown>,
        postCollectRun?: (actualInput: Record<string, unknown>) => void,
    ): void;
};

declare function registerMediaButton(
    name: string,
    action: (src: string) => void,
    title?: string,
    mediaTypes?: string[] | null,
    isDefault?: boolean,
    showInHistory?: boolean,
): void;

declare var currentMetadataVal: string | null;
declare var currentImgSrc: string | null;

declare function getImageFullSrc(src: string | null | undefined): string | null;

declare const currentImageHelper: {
    getCurrentImage(): HTMLImageElement | null;
};

declare function interpretMetadata(
    metadata: string | Uint8Array | number[] | null,
): string | null;

declare function setCurrentImage(
    src: string,
    metadata?: string,
    batchId?: string,
    previewGrow?: boolean,
    smoothAdd?: boolean,
    canReparse?: boolean,
    isPlaceholder?: boolean,
): void;

declare function doNoticePopover(message: string, className: string): void;

declare function copyText(text: string): void;

declare function $(selector: string): {
    modal(action: "show" | "hide" | "toggle"): unknown;
};
