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
const WhatTheDuckCompareShortcuts = (() => {
    const STATE_KEY = "__whatTheDuckCompareShortcuts";

    if (window[STATE_KEY]?.attached) {
        return;
    }

    const state = (window[STATE_KEY] = {
        attached: false,
        keyHandler: null,
    });

    const MODAL_ID = "image_compare_modal";

    // Key -> selector for the matching toolbar button, in modal order. Each shifted
    // symbol (!@#$%^&) is the Shift+digit on a US layout, so it maps to the same button.
    const KEY_TO_SELECTOR = {
        "1": '[data-compare-mode="side"]',
        "!": '[data-compare-mode="side"]',
        "2": '[data-compare-mode="slide_horizontal"]',
        "@": '[data-compare-mode="slide_horizontal"]',
        "3": '[data-compare-mode="slide_vertical"]',
        "#": '[data-compare-mode="slide_vertical"]',
        "4": '[data-compare-mode="transparency"]',
        "$": '[data-compare-mode="transparency"]',
        "5": '[data-compare-mode="single"]',
        "%": '[data-compare-mode="single"]',
        "6": "#image_compare_swap_button",
        "^": "#image_compare_swap_button",
        "7": "#image_compare_metadata_toggle_button",
        "&": "#image_compare_metadata_toggle_button",
    };

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

    const isModalOpen = () =>
        typeof imageCompareHelper !== "undefined" && imageCompareHelper.isOpen();

    state.keyHandler = (event) => {
        if (event.repeat) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (isEditableElement(event.target)) return;
        if (!isModalOpen()) return;

        const selector = KEY_TO_SELECTOR[event.key];
        if (!selector) return;

        const modal = document.getElementById(MODAL_ID);
        const button = modal?.querySelector(selector);
        if (!button) return;

        suppressEvent(event);
        button.click();
    };

    const attachListeners = () => {
        if (state.attached) return;
        document.addEventListener("keydown", state.keyHandler, true);
        state.attached = true;
    };

    attachListeners();
});
