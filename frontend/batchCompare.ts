/**
 * Batch Compare Module
 *
 * Lets you compare media directly from the batch image container (#current_image_batch),
 * the History tab (#imagehistorybrowser-content), or the Image Search tab
 * (#quarryimagesearch-content), mirroring SwarmUI's built-in History Browser "Compare"
 * feature which is otherwise the only place comparison can be launched from.
 *
 * Usage:
 * - Hover (or keyboard-navigate to) an image/video in any of those containers and press
 *   `C` to mark it.
 * - Press `C` on a second item to open the comparison (uses SwarmUI's imageCompareHelper).
 *   The two items may live in different containers (e.g. a batch tile vs a history tile).
 * - Press `C` on the already-marked item, or `Escape`, to clear the selection.
 *
 * This is gated behind the same "Keyboard Navigation" toggle as the other shortcuts, since
 * it is itself a single-key shortcut.
 */
import { isEditableElement, suppressEvent } from "./dom";
import { toggleHoveredModelSelection } from "./modelMultiSelect";

const MARKED_CLASS = "wtd-compare-marked";
const BATCH_ID = "current_image_batch";
const HISTORY_ID = "imagehistorybrowser-content";
const SEARCH_ID = "quarryimagesearch-content";
const CONTAINER_IDS = [BATCH_ID, HISTORY_ID, SEARCH_ID];

/** The compare-source container (batch or history) an `.image-block` lives in, if any. */
const closestContainer = (block: HTMLElement | null): HTMLElement | null => {
    for (const id of CONTAINER_IDS) {
        const container = block?.closest(`#${id}`) as HTMLElement | null;
        if (container) {
            return container;
        }
    }
    return null;
};

let attached = false;
let hovered: HTMLElement | null = null;
let hoveredElement: Element | null = null;
let markedBlock: HTMLElement | null = null;

/** A block is comparable if it is a real, finished image/video tile (not a placeholder/failed/empty tile). */
export const isComparable = (block: HTMLElement | null): boolean => {
    if (!block || !document.body.contains(block)) {
        return false;
    }
    if (!block.dataset?.src) {
        return false;
    }
    if (
        block.classList.contains("image-block-placeholder") ||
        block.classList.contains("image-block-failed")
    ) {
        return false;
    }
    const mediaType = getMediaType(block.dataset.src);
    return mediaType === "image" || mediaType === "video";
};

/** The block to act on: the hovered batch/history tile if any, else a current-image tile. */
const getTargetBlock = (): HTMLElement | null => {
    if (isComparable(hovered)) {
        return hovered;
    }
    for (const id of CONTAINER_IDS) {
        const container = document.getElementById(id);
        const current = container?.querySelector(
            ".image-block.image-block-current",
        ) as HTMLElement | null;
        if (isComparable(current)) {
            return current;
        }
    }
    return null;
};

const blockToItem = (block: HTMLElement): CompareItem => ({
    src: block.dataset.src,
    mediaType: getMediaType(block.dataset.src),
});

const clearMark = (): void => {
    if (markedBlock) {
        markedBlock.classList.remove(MARKED_CLASS);
    }
    markedBlock = null;
};

const markBlock = (block: HTMLElement): void => {
    clearMark();
    markedBlock = block;
    block.classList.add(MARKED_CLASS);
};

const launchCompare = (marked: HTMLElement, target: HTMLElement): void => {
    const items = [blockToItem(marked), blockToItem(target)];
    const valid = imageCompareHelper.evaluateSelection(items);
    if (valid.state !== "ready") {
        if (typeof showError === "function") {
            showError(valid.reason || "Cannot compare current selection.");
        }
        clearMark();
        return;
    }
    clearMark();
    if (imageCompareHelper.isShowingPair(items[0], items[1])) {
        return;
    }
    imageCompareHelper.reset();
    imageCompareHelper.showComparison(items[0], items[1]);
};

const handleCompareKey = (): boolean => {
    // Modals own their own interactions; don't act on a tile behind them.
    if (
        document.querySelector("dialog[open], .modal.show") ||
        (typeof imageCompareHelper !== "undefined" &&
            imageCompareHelper.isOpen())
    ) {
        return false;
    }
    if (toggleHoveredModelSelection(hoveredElement)) {
        return true;
    }
    if (typeof imageCompareHelper === "undefined") {
        return false;
    }
    const target = getTargetBlock();
    if (!target) {
        return false;
    }
    // Drop a stale mark (e.g. the marked tile was deleted) before deciding what to do.
    if (markedBlock && !document.body.contains(markedBlock)) {
        clearMark();
    }
    if (!markedBlock) {
        markBlock(target);
        return true;
    }
    if (markedBlock === target) {
        clearMark();
        return true;
    }
    launchCompare(markedBlock, target);
    return true;
};

const handleKeydown = (event: KeyboardEvent): void => {
    if (event.repeat) {
        return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }
    const key = event.key;
    if (key === "Escape") {
        // Let Escape close a modal or dropdown first, preserving the selection
        // behind it. Otherwise use the host toggles for every active browser.
        if (
            document.querySelector(
                "dialog[open], .modal.show, .sui-popover-visible",
            ) ||
            (typeof imageCompareHelper !== "undefined" &&
                imageCompareHelper.isOpen())
        ) {
            return;
        }
        clearMark();
        for (const toggle of document.querySelectorAll<HTMLButtonElement>(
            "button.browser-multiselect-toggle-active",
        )) {
            toggle.click();
        }
        return;
    }
    if (isEditableElement(event.target)) {
        return;
    }
    if (key !== "c" && key !== "C") {
        return;
    }
    if (handleCompareKey()) {
        suppressEvent(event);
    }
};

const handleMouseover = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    hoveredElement = target;
    const block = target?.closest?.(".image-block") as HTMLElement | null;
    hovered = closestContainer(block) ? block : null;
};

export const initBatchCompare = (): void => {
    if (attached) {
        return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("mouseover", handleMouseover, true);
    document.addEventListener(
        "mouseout",
        (event) => {
            hoveredElement =
                event.relatedTarget instanceof Element
                    ? event.relatedTarget
                    : null;
        },
        true,
    );
    attached = true;
};
