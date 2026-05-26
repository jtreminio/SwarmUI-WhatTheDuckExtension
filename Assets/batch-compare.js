/**
 * Batch Compare Module
 *
 * Lets you compare media directly from the batch image container (#current_image_batch),
 * mirroring SwarmUI's built-in History Browser "Compare" feature which is otherwise the
 * only place comparison can be launched from.
 *
 * Usage:
 * - Hover (or keyboard-navigate to) an image/video in the batch and press `C` to mark it.
 * - Press `C` on a second item to open the comparison (uses SwarmUI's imageCompareHelper).
 * - Press `C` on the already-marked item, or `Escape`, to clear the selection.
 *
 * This is gated behind the same "Keyboard Navigation" toggle as the other shortcuts, since
 * it is itself a single-key shortcut.
 */
const WhatTheDuckBatchCompare = (() => {
    const STATE_KEY = "__whatTheDuckBatchCompare";

    if (window[STATE_KEY]?.attached) {
        return;
    }

    const state = (window[STATE_KEY] = {
        attached: false,
        hovered: null,
        markedBlock: null,
        keyHandler: null,
        hoverHandler: null,
    });

    const MARKED_CLASS = "wtd-compare-marked";
    const BATCH_ID = "current_image_batch";

    const isEditableElement = (element) => {
        if (!element) return false;
        const tag = element.tagName;
        return (
            element.isContentEditable
            || tag === "INPUT"
            || tag === "TEXTAREA"
            || tag === "SELECT"
        );
    };

    const suppressEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        }
    };

    /** A block is comparable if it is a real, finished image/video tile (not a placeholder/failed/empty tile). */
    const isComparable = (block) => {
        if (!block || !document.body.contains(block)) {
            return false;
        }
        if (!block.dataset || !block.dataset.src) {
            return false;
        }
        if (block.classList.contains("image-block-placeholder") || block.classList.contains("image-block-failed")) {
            return false;
        }
        const mediaType = getMediaType(block.dataset.src);
        return mediaType === "image" || mediaType === "video";
    };

    /** The block to act on: the hovered batch tile if any, else the current-image tile in the batch. */
    const getTargetBlock = () => {
        if (isComparable(state.hovered)) {
            return state.hovered;
        }
        const batch = document.getElementById(BATCH_ID);
        if (batch) {
            const current = batch.querySelector(".image-block.image-block-current");
            if (isComparable(current)) {
                return current;
            }
        }
        return null;
    };

    const blockToItem = (block) => ({
        src: block.dataset.src,
        mediaType: getMediaType(block.dataset.src),
    });

    const clearMark = () => {
        if (state.markedBlock) {
            state.markedBlock.classList.remove(MARKED_CLASS);
        }
        state.markedBlock = null;
    };

    const markBlock = (block) => {
        clearMark();
        state.markedBlock = block;
        block.classList.add(MARKED_CLASS);
    };

    const launchCompare = (markedBlock, targetBlock) => {
        const items = [blockToItem(markedBlock), blockToItem(targetBlock)];
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

    const handleCompareKey = () => {
        // The compare modal owns its own interactions while open; don't hijack C there.
        if (typeof imageCompareHelper === "undefined" || imageCompareHelper.isOpen()) {
            return false;
        }
        const target = getTargetBlock();
        if (!target) {
            return false;
        }
        // Drop a stale mark (e.g. the marked tile was deleted) before deciding what to do.
        if (state.markedBlock && !document.body.contains(state.markedBlock)) {
            clearMark();
        }
        if (!state.markedBlock) {
            markBlock(target);
            return true;
        }
        if (state.markedBlock === target) {
            clearMark();
            return true;
        }
        launchCompare(state.markedBlock, target);
        return true;
    };

    state.keyHandler = (event) => {
        if (event.repeat) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (isEditableElement(event.target)) return;

        const key = event.key;
        if (key === "Escape") {
            if (state.markedBlock) {
                clearMark();
            }
            return;
        }
        if (key !== "c" && key !== "C") {
            return;
        }
        if (handleCompareKey()) {
            suppressEvent(event);
        }
    };

    state.hoverHandler = (event) => {
        const block = event.target?.closest?.(".image-block");
        state.hovered = (block && block.closest(`#${BATCH_ID}`)) ? block : null;
    };

    const attachListeners = () => {
        if (state.attached) return;
        document.addEventListener("keydown", state.keyHandler, true);
        document.addEventListener("mouseover", state.hoverHandler, true);
        state.attached = true;
    };

    attachListeners();
});
