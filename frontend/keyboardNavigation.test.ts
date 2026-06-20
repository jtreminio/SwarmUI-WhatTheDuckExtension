import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { initKeyboardNavigation } from "./keyboardNavigation";
import { redo } from "./redo";

jest.mock("./redo", () => ({
    redo: { init: jest.fn(), run: jest.fn() },
}));

/**
 * Exercises the X double-tap-delete state machine through the public API: we
 * dispatch real keydown events and assert whether the "Delete" button receives
 * a synthesized click. Fake timers drive both the 500ms window and Date.now(),
 * and pending timers are flushed in afterEach so module state (lastDeletePress)
 * resets to 0 between tests without needing a test-only reset hook.
 */
describe("keyboardNavigation double-tap delete", () => {
    let clicks: Array<{ shiftKey: boolean }>;

    const pressX = (shiftKey = false): void => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "x",
                bubbles: true,
                cancelable: true,
                shiftKey,
            }),
        );
    };

    beforeEach(() => {
        jest.useFakeTimers();
        // Non-zero base: the state machine treats lastDeletePress === 0 as "no
        // prior press", so a clock starting at 0 would never register a tap.
        jest.setSystemTime(1000);

        clicks = [];
        const buttons = document.createElement("div");
        buttons.className = "current-image-buttons";
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", (e) => {
            clicks.push({ shiftKey: (e as MouseEvent).shiftKey });
        });
        buttons.appendChild(deleteButton);
        document.body.appendChild(buttons);

        // Guarded by `attached`, so only the first call actually binds the
        // single document listener; later calls are no-ops.
        initKeyboardNavigation();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it("does not delete on a single tap", () => {
        pressX();
        jest.advanceTimersByTime(100);
        expect(clicks).toHaveLength(0);
    });

    it("deletes on a double tap within the window", () => {
        pressX();
        jest.advanceTimersByTime(100);
        pressX();
        expect(clicks).toHaveLength(1);
        expect(clicks[0].shiftKey).toBe(false);
    });

    it("forwards Shift on the second tap (bypass-confirm)", () => {
        pressX();
        jest.advanceTimersByTime(100);
        pressX(true);
        expect(clicks).toHaveLength(1);
        expect(clicks[0].shiftKey).toBe(true);
    });

    it("does not delete when the two taps are more than 500ms apart", () => {
        pressX();
        jest.advanceTimersByTime(600);
        pressX();
        expect(clicks).toHaveLength(0);
    });

    it("requires a fresh double tap after a completed delete", () => {
        pressX();
        jest.advanceTimersByTime(100);
        pressX();
        expect(clicks).toHaveLength(1);

        // A single tap afterwards must not re-trigger the delete.
        pressX();
        jest.advanceTimersByTime(100);
        expect(clicks).toHaveLength(1);
    });
});

describe("keyboardNavigation redo shortcut", () => {
    const pressR = (key = "r"): void => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
            }),
        );
    };

    beforeEach(() => {
        (redo.run as jest.Mock).mockClear();
        initKeyboardNavigation();
    });

    it("runs redo on R", () => {
        pressR("r");
        expect(redo.run).toHaveBeenCalledTimes(1);
    });

    it("runs redo on Shift+R (uppercase)", () => {
        pressR("R");
        expect(redo.run).toHaveBeenCalledTimes(1);
    });

    it("ignores R typed in an editable element", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "r",
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(redo.run).not.toHaveBeenCalled();
    });
});
