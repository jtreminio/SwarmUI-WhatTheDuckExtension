import { describe, expect, it } from "@jest/globals";
import { KEY_TO_SELECTOR } from "./compareShortcuts";

describe("compareShortcuts KEY_TO_SELECTOR", () => {
    // Each entry is [digit, shifted symbol, expected selector] in modal order.
    const mappings: ReadonlyArray<[string, string, string]> = [
        ["1", "!", '[data-compare-mode="side"]'],
        ["2", "@", '[data-compare-mode="slide_horizontal"]'],
        ["3", "#", '[data-compare-mode="slide_vertical"]'],
        ["4", "$", '[data-compare-mode="transparency"]'],
        ["5", "%", '[data-compare-mode="single"]'],
        ["6", "^", "#image_compare_swap_button"],
        ["7", "&", "#image_compare_metadata_toggle_button"],
    ];

    it.each(
        mappings,
    )("maps %s to the expected toolbar selector", (digit, _symbol, selector) => {
        expect(KEY_TO_SELECTOR[digit]).toBe(selector);
    });

    it.each(
        mappings,
    )("maps the shifted symbol for %s to the same selector as the digit", (digit, symbol) => {
        expect(KEY_TO_SELECTOR[symbol]).toBe(KEY_TO_SELECTOR[digit]);
    });

    it("maps exactly the seven digits and their seven shifted symbols", () => {
        expect(Object.keys(KEY_TO_SELECTOR).sort()).toEqual(
            [
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "!",
                "@",
                "#",
                "$",
                "%",
                "^",
                "&",
            ].sort(),
        );
    });

    it("has no mapping for keys outside the 1-7 range", () => {
        expect(KEY_TO_SELECTOR["8"]).toBeUndefined();
        expect(KEY_TO_SELECTOR["0"]).toBeUndefined();
        expect(KEY_TO_SELECTOR.a).toBeUndefined();
    });
});
