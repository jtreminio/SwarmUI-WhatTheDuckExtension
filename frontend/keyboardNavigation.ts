/**
 * Keyboard Navigation Module
 *
 * Provides keyboard shortcuts for image navigation and actions:
 * - A: Navigate to previous image (left arrow)
 * - D: Navigate to next image (right arrow)
 * - S: Toggle star/favorite on current image
 * - X: Delete current image (double-tap required within 500ms)
 * - Q: Delete current image (single press)
 * - E: End / interrupt current generation(s) (same as the interrupt button)
 * - R: Redo current image with a fresh seed (same as the Redo button)
 */
import { isEditableElement, suppressEvent } from "./dom";
import { redo } from "./redo";

const DELETE_DOUBLE_TAP_TIMEOUT = 500;

interface UIContext {
    getStarButton: () => Element | null;
    getDeleteButton: () => Element | null;
}

let attached = false;
let lastDeletePress = 0;
let deleteTimer: ReturnType<typeof setTimeout> | null = null;

const dispatchArrowKey = (direction: "left" | "right"): void => {
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
    } as KeyboardEventInit);

    document.dispatchEvent(event);
};

/** @param modifiers Pass shiftKey for "hold Shift to bypass" delete confirmation. */
const simulateClick = (
    element: Element | null,
    modifiers: { shiftKey?: boolean } = {},
): boolean => {
    if (!element) {
        return false;
    }

    const shiftKey = !!modifiers.shiftKey;
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        shiftKey,
    };

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

const findDeleteButton = (container: Element | null): Element | null => {
    if (!container) {
        return null;
    }

    const buttons = [
        ...container.querySelectorAll("button, [role='button'], .basic-button"),
    ];

    return (
        buttons.find((button) => {
            const text = (button.textContent || "").trim().toLowerCase();
            return text === "delete" || text.includes("delete");
        }) ?? null
    );
};

const triggerInterrupt = (): void => {
    const altBtn = document.getElementById("alt_interrupt_button");
    if (altBtn) {
        simulateClick(altBtn);
        return;
    }
    const simpleBtn = document.getElementById("simple_interrupt_button");
    if (simpleBtn) {
        simulateClick(simpleBtn);
        return;
    }
    mainGenHandler.doInterrupt();
};

const getUIContext = (): UIContext => {
    const modalContainer = document.querySelector("#imageview_modal_imagewrap");

    if (modalContainer) {
        return {
            getStarButton: () =>
                document.querySelector(
                    ".imageview_popup_modal_undertext .basic-button.star-button",
                ),
            getDeleteButton: () => {
                const container =
                    modalContainer.querySelector(
                        ".image_fullview_extra_buttons",
                    ) ||
                    document.querySelector(".image_fullview_extra_buttons");
                return findDeleteButton(container);
            },
        };
    }

    return {
        getStarButton: () =>
            document.querySelector(
                ".current-image-buttons .basic-button.star-button",
            ),
        getDeleteButton: () => {
            const container = document.querySelector(".current-image-buttons");
            return findDeleteButton(container);
        },
    };
};

const handleDeleteKey = (
    keydownEvent: KeyboardEvent,
    context: UIContext,
): void => {
    const now = Date.now();
    const timeSinceLastPress = now - lastDeletePress;

    if (lastDeletePress && timeSinceLastPress <= DELETE_DOUBLE_TAP_TIMEOUT) {
        if (deleteTimer) {
            clearTimeout(deleteTimer);
            deleteTimer = null;
        }
        lastDeletePress = 0;
        simulateClick(context.getDeleteButton(), {
            shiftKey: keydownEvent.shiftKey,
        });
    } else {
        lastDeletePress = now;

        if (deleteTimer) {
            clearTimeout(deleteTimer);
        }

        deleteTimer = setTimeout(() => {
            lastDeletePress = 0;
            deleteTimer = null;
        }, DELETE_DOUBLE_TAP_TIMEOUT);
    }
};

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

    const key = event.key;
    if (
        key !== "a" &&
        key !== "A" &&
        key !== "d" &&
        key !== "D" &&
        key !== "s" &&
        key !== "S" &&
        key !== "x" &&
        key !== "X" &&
        key !== "q" &&
        key !== "Q" &&
        key !== "e" &&
        key !== "E" &&
        key !== "r" &&
        key !== "R"
    ) {
        return;
    }

    suppressEvent(event);

    if (key === "a" || key === "A") {
        dispatchArrowKey("left");
        return;
    }
    if (key === "d" || key === "D") {
        dispatchArrowKey("right");
        return;
    }
    if (key === "e" || key === "E") {
        triggerInterrupt();
        return;
    }
    if (key === "r" || key === "R") {
        redo.run();
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

export const initKeyboardNavigation = (): void => {
    if (attached) {
        return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    attached = true;
};
