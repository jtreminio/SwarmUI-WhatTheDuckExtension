import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "@jest/globals";
import { initBatchCompare } from "./batchCompare";
import { initCompareShortcuts, KEY_TO_SELECTOR } from "./compareShortcuts";
import { initKeyboardNavigation } from "./keyboardNavigation";

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

describe("comparison pair navigation", () => {
    let resets: number;
    let pair: [CompareItem, CompareItem];

    const press = (key: string, target: EventTarget = document): boolean =>
        target.dispatchEvent(
            new KeyboardEvent("keydown", {
                key,
                bubbles: true,
                cancelable: true,
            }),
        );

    const gallery = (id: string, ...sources: string[]): HTMLElement[] => {
        const container = document.createElement("div");
        container.id = id;
        document.body.appendChild(container);
        return sources.map((src) => {
            const block = document.createElement("div");
            block.className = "image-block";
            block.dataset.src = src;
            const thumbnail = document.createElement("img");
            thumbnail.className = "image-block-img-inner";
            block.append(thumbnail);
            container.append(block);
            return block;
        });
    };

    const compare = (left: HTMLElement, right: HTMLElement): void => {
        for (const tile of [left, right]) {
            tile.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            press("c");
        }
    };

    const sources = (): string[] => pair.map((item) => item.src);

    beforeAll(() => {
        initKeyboardNavigation();
        initBatchCompare();
        initCompareShortcuts();
    });

    beforeEach(() => {
        resets = 0;
        pair = undefined;
        Object.assign(globalThis, {
            getMediaType: (src: string) =>
                src.endsWith(".png") ? "image" : "audio",
            imageCompareHelper: {
                get left() {
                    return pair?.[0];
                },
                get right() {
                    return pair?.[1];
                },
                evaluateSelection: () => ({ state: "ready" }),
                isOpen: () => pair !== undefined,
                isShowingPair: () => false,
                reset: () => {
                    resets++;
                },
                showComparison: (left: CompareItem, right: CompareItem) => {
                    pair = [left, right];
                },
            },
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, "imageCompareHelper");
        Reflect.deleteProperty(globalThis, "getMediaType");
        Reflect.deleteProperty(window, "quarryGetImageSearchMetadata");
    });

    it("steps each side in its own gallery even when the same file exists in both", () => {
        const [batch] = gallery(
            "current_image_batch",
            "batch.png",
            "batch-next.png",
        );
        const [search] = gallery(
            "quarryimagesearch-content",
            "shared.png",
            "search-next.png",
        );
        gallery(
            "imagehistorybrowser-content",
            "shared.png",
            "history-next.png",
        );
        compare(batch, search);

        expect(press("D")).toBe(false);
        expect(sources()).toEqual(["batch-next.png", "search-next.png"]);
        expect(press("ArrowLeft")).toBe(false);
        expect(sources()).toEqual(["batch.png", "shared.png"]);
        expect(resets).toBe(1);
    });

    it("uses Quarry metadata when Image Search tiles lack data-metadata", () => {
        const [batch] = gallery(
            "current_image_batch",
            "batch.png",
            "batch-next.png",
        );
        const [search, nextSearch] = gallery(
            "quarryimagesearch-content",
            "/Output/local/start.png",
            "/Output/local/next.png",
        );
        search.dataset.name = "local/start.png";
        nextSearch.dataset.name = "local/next.png";
        const metadata = new Map([
            ["local/start.png", '{"sui_image_params":{"seed":101}}'],
            ["local/next.png", '{"sui_image_params":{"seed":202}}'],
        ]);
        Reflect.set(window, "quarryGetImageSearchMetadata", (name: string) =>
            metadata.get(name),
        );

        compare(batch, search);
        expect(pair[1].metadata).toBe('{"sui_image_params":{"seed":101}}');

        press("ArrowRight");
        expect(pair[1].metadata).toBe('{"sui_image_params":{"seed":202}}');
    });

    it("keeps both sides in place at an end and permits moving away from it", () => {
        const [left, right] = gallery(
            "current_image_batch",
            "a.png",
            "b.png",
            "c.png",
        );
        compare(left, right);

        expect(press("ArrowLeft")).toBe(false);
        expect(sources()).toEqual(["a.png", "b.png"]);
        press("ArrowRight");
        expect(sources()).toEqual(["b.png", "c.png"]);
        press("d");
        expect(sources()).toEqual(["b.png", "c.png"]);
        press("a");
        expect(sources()).toEqual(["a.png", "b.png"]);
    });

    it("follows the sides after the modal swaps them", () => {
        const [batch] = gallery(
            "current_image_batch",
            "batch.png",
            "batch-next.png",
        );
        const [history] = gallery(
            "imagehistorybrowser-content",
            "history.png",
            "history-next.png",
        );
        compare(batch, history);
        pair.reverse();

        press("ArrowRight");
        expect(sources()).toEqual(["history-next.png", "batch-next.png"]);
    });

    it("lets A/D move the pair while a modal slider has keyboard focus", () => {
        const [left, right] = gallery(
            "current_image_batch",
            "a.png",
            "b.png",
            "c.png",
        );
        compare(left, right);
        const modal = document.createElement("div");
        modal.id = "image_compare_modal";
        const slider = document.createElement("input");
        slider.type = "range";
        modal.append(slider);
        document.body.append(modal);
        slider.focus();

        expect(press("ArrowRight", slider)).toBe(true);
        expect(sources()).toEqual(["a.png", "b.png"]);
        expect(press("d", slider)).toBe(false);
        expect(sources()).toEqual(["b.png", "c.png"]);
    });

    it("uses History order for the built-in Compare action", () => {
        gallery("current_image_batch", "a.png", "other.png");
        gallery("imagehistorybrowser-content", "a.png", "b.png", "c.png");
        imageCompareHelper.showComparison(
            { src: "a.png", mediaType: "image" },
            { src: "b.png", mediaType: "image" },
        );

        press("ArrowRight");
        expect(sources()).toEqual(["b.png", "c.png"]);
        expect(resets).toBe(0);
    });
});
