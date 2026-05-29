import { describe, expect, it, jest } from "@jest/globals";
import { isEditableElement, suppressEvent } from "./dom";

describe("dom", () => {
    describe("isEditableElement", () => {
        it("returns false for null", () => {
            expect(isEditableElement(null)).toBe(false);
        });

        it.each([
            "INPUT",
            "TEXTAREA",
            "SELECT",
        ])("returns true for <%s>", (tag) => {
            const element = document.createElement(tag);
            expect(isEditableElement(element)).toBe(true);
        });

        it("returns true for a contentEditable element", () => {
            const div = document.createElement("div");
            // jsdom does not derive isContentEditable from the attribute, so set
            // the property the predicate actually reads.
            Object.defineProperty(div, "isContentEditable", { value: true });
            expect(isEditableElement(div)).toBe(true);
        });

        it("returns false for a non-editable element", () => {
            expect(isEditableElement(document.createElement("div"))).toBe(
                false,
            );
            expect(isEditableElement(document.createElement("button"))).toBe(
                false,
            );
        });
    });

    describe("suppressEvent", () => {
        it("prevents default and stops propagation", () => {
            const event = new KeyboardEvent("keydown", { cancelable: true });
            const preventDefault = jest.spyOn(event, "preventDefault");
            const stopPropagation = jest.spyOn(event, "stopPropagation");
            const stopImmediate = jest.spyOn(event, "stopImmediatePropagation");

            suppressEvent(event);

            expect(preventDefault).toHaveBeenCalledTimes(1);
            expect(stopPropagation).toHaveBeenCalledTimes(1);
            expect(stopImmediate).toHaveBeenCalledTimes(1);
        });

        it("tolerates a missing stopImmediatePropagation", () => {
            const event = {
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            } as unknown as Event;

            expect(() => suppressEvent(event)).not.toThrow();
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        });
    });
});
