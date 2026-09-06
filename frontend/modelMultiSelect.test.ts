/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { initBatchCompare } from "./batchCompare";
import { enableModelMultiSelect, modelMultiSelect } from "./modelMultiSelect";

const g = globalThis as unknown as Record<string, unknown>;
// Exercise the actual host selector rather than duplicating its selection logic.
const hostBrowserPath = resolve(
    __dirname,
    "../../../wwwroot/js/genpage/helpers/browsers.js",
);
// Standalone extension checkouts do not have the host code. Keep these as
// explicit integration tests, running them whenever installed inside SwarmUI.
const Browser = existsSync(hostBrowserPath)
    ? new Function(
          `${readFileSync(hostBrowserPath, "utf8")}\nreturn GenPageBrowserClass;`,
      )()
    : null;
const describeWithSwarm = Browser ? describe : describe.skip;

type Request = {
    data: WtdPresetLinks;
    success: () => void;
    fail: (message: string) => void;
};
let requests: Request[];
let wrapper: WtdModelBrowser;
let browser: WtdModelBrowser["browser"] & {
    contentDiv: HTMLElement;
    multiSelectActive: boolean;
    multiSelectToggleButton: HTMLButtonElement;
    multiSelectActionSelect: HTMLSelectElement;
    setMultiSelectActive(active: boolean): void;
    handleMultiSelectTileClick(tile: HTMLElement, event?: Event): boolean;
};
const links = (): WtdPresetLinks =>
    (g.modelPresetLinkManager as { links: WtdPresetLinks }).links;
const choose = (title: string): void => {
    const select = document.querySelector<HTMLSelectElement>(
        "#wtd-model-preset-choice",
    );
    select.value = title;
    select.dispatchEvent(new Event("change"));
    document
        .querySelector("form")
        .dispatchEvent(new Event("submit", { cancelable: true }));
};

beforeEach(() => {
    requests = [];
    g.translate = (text: string) => text;
    g.applyTranslations = () => {};
    g.cleanModelName = (name: string) => name.replace(/\.safetensors$/, "");
    g.modelPresetLinkManager = {
        links: {
            "Stable-Diffusion": {
                "folder/a": ["Old", "Second"],
                untouched: ["Keep"],
            },
            LoRA: { accessory: ["LoRA preset"] },
        },
    };
    g.allPresetsUnsorted = [
        { title: "Portrait" },
        { data: { title: "<b>Duck & friends</b>" } },
    ];
    g.doNoticePopover = jest.fn();
    g.genericRequest = (
        endpoint: string,
        data: WtdPresetLinks,
        success: () => void,
        _depth: number,
        fail: (message: string) => void,
    ) => {
        expect(endpoint).toBe("SetPresetLinks");
        requests.push({ data, success, fail });
    };
    g.$ = (selector: string) => ({
        modal: (action: string) => {
            const modal = document.querySelector(selector);
            if (action === "show") {
                modal.classList.add("show");
            } else if (action === "hide") {
                const hide = new Event("hide.bs.modal", { cancelable: true });
                if (modal.dispatchEvent(hide)) {
                    modal.classList.remove("show");
                    modal.dispatchEvent(new Event("hidden.bs.modal"));
                }
            }
        },
    });
    document.body.innerHTML =
        '<div id="models"><div data-name="folder/a.safetensors"></div><div data-name="b.safetensors"></div></div><button class="browser-multiselect-toggle"></button><select><option value="">Action</option></select>';
    browser = Object.assign(Object.create(Browser.prototype), {
        allowMultiSelect: false,
        multiSelectActive: false,
        multiSelectToggleButton: document.querySelector("button"),
        contentDiv: document.getElementById("models"),
        multiSelectActionSelect: document.querySelector("select"),
        lastFiles: ["folder/a.safetensors", "b.safetensors"].map((name) => ({
            name,
            data: { name },
        })),
        describe: () => ({
            buttons: [
                {
                    label: "Existing action",
                    can_multi: true,
                    onclick: jest.fn(),
                },
            ],
        }),
        rerender: jest.fn(),
    });
    browser.multiSelectToggleButton.addEventListener("click", () => {
        browser.setMultiSelectActive(!browser.multiSelectActive);
    });
    wrapper = { subType: "Stable-Diffusion", browser };
});

afterEach(() => {
    document
        .querySelector("#wtd-model-preset-modal")
        ?.dispatchEvent(new Event("hidden.bs.modal"));
    for (const key of [
        "translate",
        "applyTranslations",
        "cleanModelName",
        "modelPresetLinkManager",
        "allPresetsUnsorted",
        "doNoticePopover",
        "genericRequest",
        "allModelBrowsers",
        "$",
    ]) {
        delete g[key];
    }
});

function selectModels(): void {
    enableModelMultiSelect(wrapper);
    browser.setMultiSelectActive(true);
    for (const tile of Array.from(browser.contentDiv.children)) {
        expect(browser.handleMultiSelectTileClick(tile as HTMLElement)).toBe(
            true,
        );
    }
}

describeWithSwarm("C over models (SwarmUI integration)", () => {
    const hover = (element: Element): void => {
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    };
    const press = (
        options: KeyboardEventInit = {},
        target: EventTarget = document,
    ): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {
            key: "c",
            bubbles: true,
            cancelable: true,
            ...options,
        });
        target.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        g.allModelBrowsers = [wrapper];
        g.getMediaType = () => "image";
        g.imageCompareHelper = {
            isOpen: () => false,
            evaluateSelection: () => ({ state: "ready" }),
            isShowingPair: () => false,
            reset: jest.fn(),
            showComparison: jest.fn(),
        };
        enableModelMultiSelect(wrapper);
        initBatchCompare();
        hover(document.body);
    });

    afterEach(() => {
        press({ key: "Escape" });
        delete g.getMediaType;
        delete g.imageCompareHelper;
    });

    it("enters multi-select and toggles the hovered models without opening a comparison", () => {
        const first = browser.contentDiv.children[0];
        first.innerHTML =
            '<span class="model-descblock">Model description</span>';
        const description = first.firstElementChild as HTMLElement;
        description.click();
        expect(browser.multiSelectActive).toBe(false);
        hover(first.firstElementChild);
        expect(press().defaultPrevented).toBe(true);
        expect(browser.multiSelectActive).toBe(true);
        expect(browser.getMultiSelectedFiles()).toHaveLength(1);
        description.click();
        expect(browser.getMultiSelectedFiles()).toHaveLength(1);
        hover(browser.contentDiv.children[1]);
        press({ key: "C", shiftKey: true });
        expect(browser.getMultiSelectedFiles()).toHaveLength(2);
        expect(browser.getCommonMultiSelectActionLabels()).toContain(
            "Set Linked Preset",
        );
        press();
        expect(browser.getMultiSelectedFiles()).toHaveLength(1);
        expect(imageCompareHelper.showComparison).not.toHaveBeenCalled();
    });

    it("ignores modified keys, repeat, and editable targets", () => {
        hover(browser.contentDiv.children[0]);
        for (const options of [
            { ctrlKey: true },
            { altKey: true },
            { metaKey: true },
            { repeat: true },
        ]) {
            expect(press(options).defaultPrevented).toBe(false);
        }
        for (const tag of ["input", "textarea", "select"]) {
            const input = document.createElement(tag);
            document.body.appendChild(input);
            expect(press({}, input).defaultPrevented).toBe(false);
        }
        expect(browser.multiSelectActive).toBe(false);
    });

    it("does not select stale or hidden model tiles or models behind a modal", () => {
        const tile = browser.contentDiv.children[0];
        hover(tile);
        const modal = document.createElement("dialog");
        modal.open = true;
        document.body.appendChild(modal);
        expect(press().defaultPrevented).toBe(false);
        modal.remove();
        browser.contentDiv.hidden = true;
        expect(press().defaultPrevented).toBe(false);
        browser.contentDiv.hidden = false;
        tile.dispatchEvent(
            new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }),
        );
        expect(press().defaultPrevented).toBe(false);
        hover(tile);
        tile.remove();
        expect(press().defaultPrevented).toBe(false);
        expect(browser.multiSelectActive).toBe(false);
    });

    it("prioritizes hovered models over the current image and preserves image comparison", () => {
        const batch = document.createElement("div");
        batch.id = "current_image_batch";
        batch.innerHTML =
            '<div class="image-block image-block-current" data-src="first.png"></div><div class="image-block" data-src="second.png"></div>';
        document.body.appendChild(batch);
        hover(batch.children[0]);
        press();
        expect(batch.children[0].classList.contains("wtd-compare-marked")).toBe(
            true,
        );
        hover(browser.contentDiv.children[0]);
        press();
        expect(browser.getMultiSelectedFiles()).toHaveLength(1);
        expect(imageCompareHelper.showComparison).not.toHaveBeenCalled();
        hover(batch.children[1]);
        press();
        expect(imageCompareHelper.showComparison).toHaveBeenCalledWith(
            { src: "first.png", mediaType: "image" },
            { src: "second.png", mediaType: "image" },
        );
    });

    it("does not give wildcards a model selection shortcut", () => {
        g.allModelBrowsers = [];
        hover(browser.contentDiv.children[0]);
        expect(press().defaultPrevented).toBe(false);
        expect(browser.multiSelectActive).toBe(false);
    });

    it("Escape exits model and image multi-select and clears image comparison marks", () => {
        const history = document.createElement("div");
        history.id = "imagehistorybrowser-content";
        history.innerHTML =
            '<div class="image-block" data-name="a.png" data-src="a.png"></div>';
        const toggle = document.createElement("button");
        document.body.append(history, toggle);
        const images = Object.assign(Object.create(Browser.prototype), {
            allowMultiSelect: true,
            contentDiv: history,
            multiSelectToggleButton: toggle,
        });
        toggle.addEventListener("click", () =>
            images.setMultiSelectActive(!images.multiSelectActive),
        );
        images.setMultiSelectActive(true);
        images.handleMultiSelectTileClick(history.firstElementChild);
        hover(history.firstElementChild);
        press();
        expect(
            history.firstElementChild.classList.contains("wtd-compare-marked"),
        ).toBe(true);
        hover(browser.contentDiv.firstElementChild);
        press();
        // Escape also works after focus returns to a closed action dropdown.
        press({ key: "Escape" }, browser.multiSelectActionSelect);
        expect(browser.multiSelectActive).toBe(false);
        expect(browser.getMultiSelectedFiles()).toHaveLength(0);
        expect(images.multiSelectActive).toBe(false);
        expect(images.getMultiSelectedItems()).toHaveLength(0);
        expect(
            history.firstElementChild.classList.contains("wtd-compare-marked"),
        ).toBe(false);
        expect(
            document.querySelectorAll(".browser-multiselect-toggle-active"),
        ).toHaveLength(0);
    });

    it.each([
        "modal show",
        "sui-popover-visible",
    ])("Escape preserves selections behind an open %s", (className) => {
        hover(browser.contentDiv.firstElementChild);
        press();
        const overlay = document.createElement("div");
        overlay.className = className;
        document.body.appendChild(overlay);
        press({ key: "Escape" });
        expect(browser.getMultiSelectedFiles()).toHaveLength(1);
        overlay.remove();
        press({ key: "Escape" });
        expect(browser.multiSelectActive).toBe(false);
        expect(browser.getMultiSelectedFiles()).toHaveLength(0);
    });
});

describeWithSwarm("model multi-select (SwarmUI integration)", () => {
    it.each([
        { a: ["Portrait"], b: ["Portrait"], expected: "Portrait" },
        { a: [], b: [], expected: "" },
        { a: ["Portrait"], b: [], expected: null },
        { a: ["Portrait"], b: ["<b>Duck & friends</b>"], expected: null },
        {
            a: ["Portrait", "Second"],
            b: ["Portrait", "Second"],
            expected: null,
        },
        { a: ["Deleted preset"], b: ["Deleted preset"], expected: null },
    ])("prefills only an unambiguous available preset: $a / $b", ({
        a,
        b,
        expected,
    }) => {
        links()["Stable-Diffusion"]["folder/a"] = a;
        links()["Stable-Diffusion"].b = b;
        selectModels();
        browser.runMultiSelectAction("Set Linked Preset");
        const select = document.querySelector<HTMLSelectElement>(
            "#wtd-model-preset-choice",
        );
        if (expected === null) {
            expect(select.selectedIndex).toBe(-1);
        } else {
            expect(select.selectedIndex).toBeGreaterThanOrEqual(0);
            expect(select.value).toBe(expected);
        }
        expect(
            document.querySelector<HTMLButtonElement>("[type=submit]").disabled,
        ).toBe(expected === null);
        expect(requests).toHaveLength(0);
    });
    it("uses native selection controls and preserves existing bulk actions", () => {
        selectModels();
        expect(browser.getMultiSelectedFiles()).toHaveLength(2);
        expect(
            Array.from(browser.multiSelectActionSelect.options, (o) => o.value),
        ).toEqual(["", "Existing action", "Set Linked Preset"]);
        browser.runMultiSelectAction("Existing action");
        expect(document.querySelector("#wtd-model-preset-modal")).toBeNull();
        browser.setMultiSelectActive(false);
        expect(browser.getMultiSelectedFiles()).toEqual([]);
        expect(browser.multiSelectActionSelect.style.display).toBe("none");
    });

    it("patches each browser only once and skips wildcards", () => {
        g.allModelBrowsers = [
            wrapper,
            { subType: "Wildcards", browser: { allowMultiSelect: false } },
        ];
        modelMultiSelect.init();
        const actionHandler = browser.runMultiSelectAction;
        modelMultiSelect.init();
        expect(browser.runMultiSelectAction).toBe(actionHandler);
        expect(browser.rerender).not.toHaveBeenCalled();
        expect(
            (g.allModelBrowsers as WtdModelBrowser[])[1].browser
                .allowMultiSelect,
        ).toBe(false);
    });

    it("saves one snapshot, preserves unrelated links, and commits only on success", () => {
        selectModels();
        browser.runMultiSelectAction("Set Linked Preset");
        browser.runMultiSelectAction("Set Linked Preset");
        expect(
            document.querySelectorAll("#wtd-model-preset-modal"),
        ).toHaveLength(1);
        expect(
            document.querySelector<HTMLButtonElement>("[type=submit]").disabled,
        ).toBe(true);
        expect(document.querySelector("#wtd-model-preset-modal b")).toBeNull();
        // Subsequent selection changes must not change the captured targets.
        browser.setMultiSelectActive(false);
        choose("<b>Duck & friends</b>");
        expect(requests).toHaveLength(1);
        expect(requests[0].data).toEqual({
            "Stable-Diffusion": {
                "folder/a": ["<b>Duck & friends</b>"],
                b: ["<b>Duck & friends</b>"],
                untouched: ["Keep"],
            },
            LoRA: { accessory: ["LoRA preset"] },
        });
        expect(links()["Stable-Diffusion"]["folder/a"]).toEqual([
            "Old",
            "Second",
        ]);
        requests[0].success();
        expect(links()["Stable-Diffusion"].b).toEqual([
            "<b>Duck & friends</b>",
        ]);
        expect(document.querySelector("#wtd-model-preset-modal")).toBeNull();
        expect(browser.rerender).toHaveBeenCalledTimes(1);
    });

    it("keeps links and the picker on failure and permits retry", () => {
        selectModels();
        browser.runMultiSelectAction("Set Linked Preset");
        choose("Portrait");
        choose("Portrait");
        expect(requests).toHaveLength(1);
        $("#wtd-model-preset-modal").modal("hide");
        expect(
            document.querySelector("#wtd-model-preset-modal.show"),
        ).not.toBeNull();
        requests[0].fail("Server unavailable");
        expect(document.querySelector("[role=status]").textContent).toContain(
            "Server unavailable",
        );
        expect(links()["Stable-Diffusion"]["folder/a"]).toEqual([
            "Old",
            "Second",
        ]);
        choose("Portrait");
        expect(requests).toHaveLength(2);
        requests[1].success();
        expect(links()["Stable-Diffusion"]["folder/a"]).toEqual(["Portrait"]);
    });

    it("removes only selected links when (None) is explicitly selected", () => {
        selectModels();
        browser.runMultiSelectAction("Set Linked Preset");
        choose("");
        requests[0].success();
        expect(links()).toEqual({
            "Stable-Diffusion": { untouched: ["Keep"] },
            LoRA: { accessory: ["LoRA preset"] },
        });
    });

    it("does not save on cancel or open a picker for an empty selection", () => {
        enableModelMultiSelect(wrapper);
        browser.runMultiSelectAction("Set Linked Preset");
        expect(document.querySelector("#wtd-model-preset-modal")).toBeNull();
        selectModels();
        browser.runMultiSelectAction("Set Linked Preset");
        document.querySelector<HTMLButtonElement>("[type=button]").click();
        expect(requests).toHaveLength(0);
        expect(document.querySelector("#wtd-model-preset-modal")).toBeNull();
        browser.runMultiSelectAction("Set Linked Preset");
        expect(
            document.querySelectorAll("#wtd-model-preset-modal.show"),
        ).toHaveLength(1);
    });
});
