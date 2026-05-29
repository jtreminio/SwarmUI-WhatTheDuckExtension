/**
 * Compare Shortcuts Module
 *
 * While SwarmUI's image comparison modal is open, maps number keys 1-7 to its
 * toolbar buttons so view modes can be switched without the mouse:
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

const isModalOpen = (): boolean =>
    typeof imageCompareHelper !== "undefined" && imageCompareHelper.isOpen();

const handleKeydown = (event: KeyboardEvent): void => {
    if (event.repeat) {
        return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
    }
    if (isEditableElement(event.target)) {
        return;
    }
    if (!isModalOpen()) {
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
