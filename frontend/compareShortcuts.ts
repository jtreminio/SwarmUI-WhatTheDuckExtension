/**
 * Compare Shortcuts Module
 *
 * While SwarmUI's image comparison modal is open, A/D and Left/Right move
 * both media items, and number keys 1-7 activate its toolbar buttons:
 * - 1: Side by Side
 * - 2: Horizontal Slide
 * - 3: Vertical Slide
 * - 4: Transparency Overlay
 * - 5: Single View
 * - 6: Switch Image
 * - 7: Toggle Metadata
 *
 * Gated behind the same "Keyboard Navigation" toggle as the other single-key shortcuts.
 */
import { getNextCompareItem, isCompareModalOpen } from "./batchCompare";
import { isEditableElement, suppressEvent } from "./dom";

const MODAL_ID = "image_compare_modal";

// Key -> selector for the matching toolbar button, in modal order. Each shifted
// symbol (!@#$%^&) is the Shift+digit on a US layout, so it maps to the same button.
export const KEY_TO_SELECTOR: Record<string, string> = {
    "1": '[data-compare-mode="side"]',
    "!": '[data-compare-mode="side"]',
    "2": '[data-compare-mode="slide_horizontal"]',
    "@": '[data-compare-mode="slide_horizontal"]',
    "3": '[data-compare-mode="slide_vertical"]',
    "#": '[data-compare-mode="slide_vertical"]',
    "4": '[data-compare-mode="transparency"]',
    $: '[data-compare-mode="transparency"]',
    "5": '[data-compare-mode="single"]',
    "%": '[data-compare-mode="single"]',
    "6": "#image_compare_swap_button",
    "^": "#image_compare_swap_button",
    "7": "#image_compare_metadata_toggle_button",
    "&": "#image_compare_metadata_toggle_button",
};

let attached = false;

const movePair = (step: -1 | 1): void => {
    const { left, right } = imageCompareHelper;
    if (!left || !right) {
        return;
    }
    const nextLeft = getNextCompareItem(left, step);
    const nextRight = getNextCompareItem(right, step);
    if (nextLeft && nextRight) {
        imageCompareHelper.showComparison(nextLeft, nextRight);
    }
};

const handleKeydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }
    if (!isCompareModalOpen()) {
        return;
    }

    const key = event.key.toLowerCase();
    const isNavigationLetter = key === "a" || key === "d";
    const target = event.target;
    // A/D can navigate even after the user adjusts a comparison slider.
    // Its arrow keys still adjust the focused control.
    const isSliderShortcut =
        isNavigationLetter &&
        target instanceof HTMLInputElement &&
        target.type === "range" &&
        target.closest(`#${MODAL_ID}`);
    if (isEditableElement(target) && !isSliderShortcut) {
        return;
    }

    const isArrow = key === "arrowleft" || key === "arrowright";
    if (isArrow || isNavigationLetter) {
        suppressEvent(event);
        if (!event.repeat || isArrow) {
            movePair(key === "a" || key === "arrowleft" ? -1 : 1);
        }
        return;
    }
    if (event.repeat) {
        return;
    }

    const selector = KEY_TO_SELECTOR[event.key];
    if (!selector) {
        return;
    }

    const modal = document.getElementById(MODAL_ID);
    const button = modal?.querySelector(selector) as HTMLElement | null;
    if (!button) {
        return;
    }

    suppressEvent(event);
    button.click();
};

export const initCompareShortcuts = (): void => {
    if (attached) {
        return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    attached = true;
};
