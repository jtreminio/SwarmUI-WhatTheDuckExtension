declare function registerNewTool(id: string, name: string): HTMLElement;

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
};
