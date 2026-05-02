/**
 * Keyboard Navigation Module
 * 
 * Provides keyboard shortcuts for image navigation and actions:
 * - A: Navigate to previous image (left arrow)
 * - D: Navigate to next image (right arrow)
 * - S: Toggle star/favorite on current image
 * - X: Delete current image (double-tap required within 500ms)
 * - Q: Delete current image (single press)
 */
const WhatTheDuckKeyboardNavigation = (() => {
    const STATE_KEY = "__keyboardNavigation";

    if (window[STATE_KEY]?.attached) {
        return;
    }

    const state = (window[STATE_KEY] = {
        attached: false,
        lastDeletePress: 0,
        deleteTimer: null,
        handler: null,
    });

    const DELETE_DOUBLE_TAP_TIMEOUT = 500;

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

    const dispatchArrowKey = (direction) => {
        const isLeft = direction === "left";
        const key = isLeft ? "ArrowLeft" : "ArrowRight";
        const keyCode = isLeft ? 37 : 39;

        const event = new KeyboardEvent("keydown", {
            key,
            code: key,
            keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
        });

        document.dispatchEvent(event);
    };

    /** @param {{shiftKey?: boolean}} [modifiers] Pass shiftKey for "hold Shift to bypass" delete confirmation. */
    const simulateClick = (element, modifiers = {}) => {
        if (!element) return false;

        let shiftKey = !!modifiers.shiftKey;
        let eventOptions = { bubbles: true, cancelable: true, view: window, shiftKey };

        try {
            element.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
        } catch {
            // PointerEvent not supported
        }

        element.dispatchEvent(new MouseEvent("mousedown", eventOptions));

        try {
            element.dispatchEvent(new PointerEvent("pointerup", eventOptions));
        } catch {
            // PointerEvent not supported
        }

        element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
        element.dispatchEvent(new MouseEvent("click", eventOptions));

        return true;
    };

    const findDeleteButton = (container) => {
        if (!container) return null;

        const buttons = [...container.querySelectorAll("button, [role='button'], .basic-button")];

        return buttons.find((button) => {
            const text = (button.textContent || "").trim().toLowerCase();
            return text === "delete" || text.includes("delete");
        }) || null;
    };

    const getUIContext = () => {
        const modalContainer = document.querySelector("#imageview_modal_imagewrap");

        if (modalContainer) {
            return {
                mode: "modal",
                getStarButton: () =>
                    document.querySelector(".imageview_popup_modal_undertext .basic-button.star-button"),
                getDeleteButton: () => {
                    const container =
                        modalContainer.querySelector(".image_fullview_extra_buttons") ||
                        document.querySelector(".image_fullview_extra_buttons");
                    return findDeleteButton(container);
                },
            };
        }

        return {
            mode: "page",
            getStarButton: () =>
                document.querySelector(".current-image-buttons .basic-button.star-button"),
            getDeleteButton: () => {
                const container = document.querySelector(".current-image-buttons");
                return findDeleteButton(container);
            },
        };
    };

    const handleDeleteKey = (keydownEvent, context) => {
        const now = Date.now();
        const timeSinceLastPress = now - state.lastDeletePress;

        if (state.lastDeletePress && timeSinceLastPress <= DELETE_DOUBLE_TAP_TIMEOUT) {
            if (state.deleteTimer) {
                clearTimeout(state.deleteTimer);
                state.deleteTimer = null;
            }
            state.lastDeletePress = 0;
            simulateClick(context.getDeleteButton(), { shiftKey: keydownEvent.shiftKey });
        } else {
            state.lastDeletePress = now;

            if (state.deleteTimer) {
                clearTimeout(state.deleteTimer);
            }

            state.deleteTimer = setTimeout(() => {
                state.lastDeletePress = 0;
                state.deleteTimer = null;
            }, DELETE_DOUBLE_TAP_TIMEOUT);
        }
    };

    state.handler = (event) => {
        if (event.repeat) return;
        if (isEditableElement(event.target)) return;

        const key = event.key;
        if (
            key !== "a" && key !== "A" && key !== "d" && key !== "D" &&
            key !== "s" && key !== "S" && key !== "x" && key !== "X" &&
            key !== "q" && key !== "Q"
        ) return;

        suppressEvent(event);

        if (key === "a" || key === "A") {
            dispatchArrowKey("left");
            return;
        }
        if (key === "d" || key === "D") {
            dispatchArrowKey("right");
            return;
        }

        const context = getUIContext();
        if (key === "s" || key === "S") {
            simulateClick(context.getStarButton());
            return;
        }
        if (key === "x" || key === "X") {
            handleDeleteKey(event, context);
            return;
        }
        if (key === "q" || key === "Q") {
            simulateClick(context.getDeleteButton(), { shiftKey: event.shiftKey });
        }
    };

    const attachListeners = () => {
        if (state.attached) return;

        document.addEventListener("keydown", state.handler, true);

        state.attached = true;
    };

    attachListeners();
});
