import { beforeEach, describe, expect, it } from "@jest/globals";
import {
    initCivitaiArchPickers,
    renderArchPills,
    renderCivitaiArchPicker,
    shouldOpenUpward,
    syncPicker,
} from "./civitaiArchPicker";

const OPTIONS = ["Anima", "Flux.2 Klein 4B", "Flux.2 Klein 9B", "Pony"];

const mount = (selected: string[]): HTMLElement => {
    document.body.innerHTML = renderCivitaiArchPicker(selected, OPTIONS);
    initCivitaiArchPickers(document);
    return document.querySelector("[data-wtd-arch-picker]") as HTMLElement;
};

const panel = (picker: Element): HTMLElement =>
    picker.querySelector("[data-wtd-arch-panel]") as HTMLElement;

const trigger = (picker: Element): HTMLElement =>
    picker.querySelector("[data-wtd-arch-trigger]") as HTMLElement;

const hiddenSelect = (picker: Element): HTMLSelectElement =>
    picker.querySelector("select.wtd-civitai-arch") as HTMLSelectElement;

const checkbox = (picker: Element, value: string): HTMLInputElement =>
    Array.from(
        picker.querySelectorAll<HTMLInputElement>("[data-wtd-arch-check]"),
    ).find((box) => box.value === value) as HTMLInputElement;

const selectedFromHidden = (picker: Element): string[] =>
    Array.from(hiddenSelect(picker).selectedOptions).map((o) => o.value);

const click = (el: Element): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const change = (el: Element): void => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("renderArchPills", () => {
    it("renders a placeholder when nothing is selected", () => {
        expect(renderArchPills([])).toContain("wtd-arch-placeholder");
    });

    it("renders one removable pill per value, escaped", () => {
        const html = renderArchPills(["Anima", "<b>x</b>"]);
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        expect(wrapper.querySelectorAll(".wtd-arch-pill").length).toBe(2);
        expect(
            wrapper.querySelectorAll("[data-wtd-arch-pill-remove]").length,
        ).toBe(2);
        expect(html).not.toContain("<b>x</b>");
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    });
});

describe("renderCivitaiArchPicker", () => {
    it("mirrors the selection into a hidden native select for the save path", () => {
        const picker = mount(["Anima", "Pony"]);
        const select = hiddenSelect(picker);
        expect(select.multiple).toBe(true);
        expect(select.hidden).toBe(true);
        expect(selectedFromHidden(picker)).toEqual(["Anima", "Pony"]);
    });

    it("injects unknown saved values so settings round-trip", () => {
        const picker = mount(["Brand New Arch"]);
        expect(selectedFromHidden(picker)).toEqual(["Brand New Arch"]);
        expect(checkbox(picker, "Brand New Arch")?.checked).toBe(true);
    });

    it("starts with the panel closed and pills visible", () => {
        const picker = mount(["Anima"]);
        expect(panel(picker).hidden).toBe(true);
        expect(picker.querySelectorAll(".wtd-arch-pill").length).toBe(1);
    });
});

describe("picker interaction", () => {
    it("opens on trigger click and STAYS OPEN across multiple checkbox toggles", () => {
        const picker = mount([]);
        click(trigger(picker));
        expect(panel(picker).hidden).toBe(false);

        const klein4 = checkbox(picker, "Flux.2 Klein 4B");
        klein4.checked = true;
        change(klein4);
        expect(panel(picker).hidden).toBe(false);

        const klein9 = checkbox(picker, "Flux.2 Klein 9B");
        klein9.checked = true;
        change(klein9);
        expect(panel(picker).hidden).toBe(false);

        expect(selectedFromHidden(picker)).toEqual([
            "Flux.2 Klein 4B",
            "Flux.2 Klein 9B",
        ]);
        expect(picker.querySelectorAll(".wtd-arch-pill").length).toBe(2);
    });

    it("closes when the trigger is clicked again", () => {
        const picker = mount([]);
        click(trigger(picker));
        expect(panel(picker).hidden).toBe(false);
        click(trigger(picker));
        expect(panel(picker).hidden).toBe(true);
    });

    it("closes on a click outside the picker but not on a click inside the panel", () => {
        const picker = mount([]);
        click(trigger(picker));
        click(panel(picker));
        expect(panel(picker).hidden).toBe(false);
        click(document.body);
        expect(panel(picker).hidden).toBe(true);
    });

    it("closes on Escape", () => {
        const picker = mount([]);
        click(trigger(picker));
        document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        expect(panel(picker).hidden).toBe(true);
    });

    it("removes a value via its pill's ✕ without opening the panel", () => {
        const picker = mount(["Anima", "Pony"]);
        const removeAnima = picker.querySelector(
            '[data-wtd-arch-pill-remove][data-value="Anima"]',
        ) as HTMLElement;
        click(removeAnima);
        expect(panel(picker).hidden).toBe(true);
        expect(selectedFromHidden(picker)).toEqual(["Pony"]);
        expect(checkbox(picker, "Anima").checked).toBe(false);
    });

    it("filters the checkbox list case-insensitively", () => {
        const picker = mount([]);
        click(trigger(picker));
        const filter = picker.querySelector(
            "[data-wtd-arch-filter]",
        ) as HTMLInputElement;
        filter.value = "klein";
        filter.dispatchEvent(new Event("input", { bubbles: true }));
        const visible = Array.from(
            picker.querySelectorAll<HTMLElement>(".wtd-arch-option"),
        ).filter((label) => label.style.display !== "none");
        expect(visible.length).toBe(2);
    });

    it("clears the whole selection via the Clear button", () => {
        const picker = mount(["Anima", "Pony"]);
        click(trigger(picker));
        click(picker.querySelector("[data-wtd-arch-clear]") as Element);
        expect(selectedFromHidden(picker)).toEqual([]);
        expect(panel(picker).hidden).toBe(false);
        expect(picker.querySelector("[data-wtd-arch-count]")?.textContent).toBe(
            "0 selected",
        );
    });

    it("updates the selected count while picking", () => {
        const picker = mount([]);
        click(trigger(picker));
        const pony = checkbox(picker, "Pony");
        pony.checked = true;
        change(pony);
        expect(picker.querySelector("[data-wtd-arch-count]")?.textContent).toBe(
            "1 selected",
        );
    });
});

describe("shouldOpenUpward", () => {
    it("stays downward when the panel fits below", () => {
        expect(shouldOpenUpward(100, 400, 300)).toBe(false);
    });

    it("flips upward when the panel does not fit below and there is more room above", () => {
        expect(shouldOpenUpward(600, 150, 300)).toBe(true);
    });

    it("stays downward when space is short on both sides but below has more", () => {
        expect(shouldOpenUpward(100, 150, 300)).toBe(false);
    });
});

describe("panel flip on open", () => {
    it("adds the flipped class when the trigger sits near the viewport bottom", () => {
        const picker = mount([]);
        const triggerEl = trigger(picker);
        // Simulate a trigger near the bottom of the viewport with a tall panel.
        triggerEl.getBoundingClientRect = () =>
            ({ top: 700, bottom: 730 }) as DOMRect;
        Object.defineProperty(panel(picker), "offsetHeight", {
            value: 300,
            configurable: true,
        });
        click(triggerEl);
        expect(panel(picker).classList.contains("wtd-arch-panel-up")).toBe(
            true,
        );
    });

    it("keeps the default downward position when there is room below", () => {
        const picker = mount([]);
        const triggerEl = trigger(picker);
        triggerEl.getBoundingClientRect = () =>
            ({ top: 50, bottom: 80 }) as DOMRect;
        Object.defineProperty(panel(picker), "offsetHeight", {
            value: 300,
            configurable: true,
        });
        click(triggerEl);
        expect(panel(picker).classList.contains("wtd-arch-panel-up")).toBe(
            false,
        );
    });
});

describe("syncPicker", () => {
    it("propagates checkbox state to hidden select, pills, and count", () => {
        const picker = mount([]);
        const pony = checkbox(picker, "Pony");
        pony.checked = true;
        syncPicker(picker);
        expect(selectedFromHidden(picker)).toEqual(["Pony"]);
        expect(picker.querySelectorAll(".wtd-arch-pill").length).toBe(1);
        expect(picker.querySelector("[data-wtd-arch-count]")?.textContent).toBe(
            "1 selected",
        );
    });
});
