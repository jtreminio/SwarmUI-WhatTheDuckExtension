/**
 * Civitai Architecture Picker
 *
 * The architecture control for a Civitai Auto-Folders mapping row. Closed, it
 * is a SwarmUI-dropdown-styled control showing the selection as removable
 * pills (each pill's ✕ removes that architecture without opening anything).
 * Clicking it opens a floating panel with a filter input and a checkbox list
 * of every architecture; the panel STAYS OPEN while multiple boxes are
 * toggled, closing only on outside click, Esc, or clicking the control again.
 *
 * A hidden native `<select multiple class="wtd-civitai-arch">` inside the
 * control mirrors the selection at all times, so `readCivitaiMappings` in
 * settings.ts keeps reading `selectedOptions` with no changes.
 */

import { escapeAttr, escapeHtml } from "./escape";

// --- Pure renderers ----------------------------------------------------------

/** Inner content of the trigger's pill area. */
export const renderArchPills = (selected: string[]): string => {
    if (selected.length === 0) {
        return `<span class="wtd-arch-placeholder">(Architectures)</span>`;
    }
    return selected
        .map(
            (value) =>
                `<span class="wtd-arch-pill">${escapeHtml(value)}<button type="button" class="wtd-arch-pill-x" data-wtd-arch-pill-remove data-value="${escapeAttr(value)}" title="Remove ${escapeAttr(value)}">✕</button></span>`,
        )
        .join("");
};

/**
 * The full picker control. `options` is the known architecture list; selected
 * values missing from it (e.g. civitai added one after the last sync) are
 * injected so saved settings always round-trip.
 */
export const renderCivitaiArchPicker = (
    selected: string[],
    options: string[],
): string => {
    const withValues = [...options];
    for (const value of selected) {
        if (value && !withValues.includes(value)) {
            withValues.push(value);
        }
    }
    const hiddenOptions = withValues
        .map(
            (opt) =>
                `<option value="${escapeAttr(opt)}"${selected.includes(opt) ? " selected" : ""}>${escapeHtml(opt)}</option>`,
        )
        .join("");
    const checkboxes = withValues
        .map(
            (opt) =>
                `<label class="wtd-arch-option"><input type="checkbox" data-wtd-arch-check value="${escapeAttr(opt)}"${selected.includes(opt) ? " checked" : ""}><span>${escapeHtml(opt)}</span></label>`,
        )
        .join("");
    return `
            <div class="wtd-arch-picker" data-wtd-arch-picker>
                <select class="wtd-civitai-arch" multiple hidden>${hiddenOptions}</select>
                <div class="wtd-arch-trigger" data-wtd-arch-trigger role="button" tabindex="0" title="Architectures - click to edit">
                    <span class="wtd-arch-pills" data-wtd-arch-pills>${renderArchPills(selected)}</span>
                    <span class="wtd-arch-caret">▾</span>
                </div>
                <div class="wtd-arch-panel" data-wtd-arch-panel hidden>
                    <input type="text" class="auto-text wtd-arch-filter" data-wtd-arch-filter placeholder="Filter architectures..." autocomplete="off">
                    <div class="wtd-arch-list">${checkboxes}</div>
                    <div class="wtd-arch-actions">
                        <span class="wtd-arch-count" data-wtd-arch-count></span>
                        <button type="button" class="basic-button wtd-arch-clear" data-wtd-arch-clear>Clear</button>
                    </div>
                </div>
            </div>`;
};

// --- DOM sync helpers --------------------------------------------------------

const selectedValues = (picker: Element): string[] =>
    Array.from(
        picker.querySelectorAll<HTMLInputElement>("[data-wtd-arch-check]"),
    )
        .filter((box) => box.checked)
        .map((box) => box.value);

/**
 * Propagate the checkbox state to the hidden native select, the pill area,
 * and the "N selected" count. The checkboxes are the interaction surface; the
 * hidden select is what the save path reads.
 */
export const syncPicker = (picker: Element): void => {
    const selected = selectedValues(picker);
    const hiddenSelect = picker.querySelector<HTMLSelectElement>(
        "select.wtd-civitai-arch",
    );
    if (hiddenSelect) {
        for (const option of Array.from(hiddenSelect.options)) {
            option.selected = selected.includes(option.value);
        }
    }
    const pills = picker.querySelector("[data-wtd-arch-pills]");
    if (pills) {
        pills.innerHTML = renderArchPills(selected);
    }
    const count = picker.querySelector("[data-wtd-arch-count]");
    if (count) {
        count.textContent = `${selected.length} selected`;
    }
};

/**
 * Decide whether the panel should open upward: only when it doesn't fit below
 * the trigger AND there is more room above than below. `margin` accounts for
 * the gap between trigger and panel plus a little breathing room.
 */
export const shouldOpenUpward = (
    spaceAbove: number,
    spaceBelow: number,
    panelHeight: number,
    margin = 12,
): boolean => spaceBelow < panelHeight + margin && spaceAbove > spaceBelow;

const setPanelOpen = (picker: Element, open: boolean): void => {
    const panel = picker.querySelector<HTMLElement>("[data-wtd-arch-panel]");
    if (!panel) {
        return;
    }
    panel.hidden = !open;
    if (open) {
        syncPicker(picker);
        // Measure AFTER unhiding (offsetHeight is 0 while hidden) and flip
        // the panel above the trigger when it would extend past the bottom of
        // the viewport, so the user never has to scroll to reach options.
        panel.classList.remove("wtd-arch-panel-up");
        const trigger = picker.querySelector<HTMLElement>(
            "[data-wtd-arch-trigger]",
        );
        if (trigger) {
            const rect = trigger.getBoundingClientRect();
            if (
                shouldOpenUpward(
                    rect.top,
                    window.innerHeight - rect.bottom,
                    panel.offsetHeight,
                )
            ) {
                panel.classList.add("wtd-arch-panel-up");
            }
        }
        picker
            .querySelector<HTMLInputElement>("[data-wtd-arch-filter]")
            ?.focus();
    }
};

const closeAllPanels = (root: Document, except?: Element): void => {
    for (const picker of Array.from(
        root.querySelectorAll("[data-wtd-arch-picker]"),
    )) {
        if (picker !== except) {
            setPanelOpen(picker, false);
        }
    }
};

const applyFilter = (picker: Element, filterText: string): void => {
    const wanted = filterText.trim().toLowerCase();
    for (const label of Array.from(
        picker.querySelectorAll<HTMLElement>(".wtd-arch-option"),
    )) {
        const value =
            label.querySelector<HTMLInputElement>("[data-wtd-arch-check]")
                ?.value ?? "";
        label.style.display =
            !wanted || value.toLowerCase().includes(wanted) ? "" : "none";
    }
};

const removeValue = (picker: Element, value: string): void => {
    for (const box of Array.from(
        picker.querySelectorAll<HTMLInputElement>("[data-wtd-arch-check]"),
    )) {
        if (box.value === value) {
            box.checked = false;
        }
    }
    syncPicker(picker);
};

// --- Delegated event wiring --------------------------------------------------

let started = false;

/**
 * Install document-level delegated handlers once. Delegation means rows added
 * later via "+ Add Mapping" (or re-rendered on load/save) need no re-wiring.
 */
export const initCivitaiArchPickers = (root: Document): void => {
    if (started) {
        return;
    }
    started = true;

    root.addEventListener("click", (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) {
            return;
        }
        const pillRemove = target.closest<HTMLElement>(
            "[data-wtd-arch-pill-remove]",
        );
        if (pillRemove) {
            const picker = pillRemove.closest("[data-wtd-arch-picker]");
            if (picker) {
                removeValue(picker, pillRemove.dataset.value ?? "");
            }
            // Removing a pill must not toggle the panel underneath it.
            e.stopPropagation();
            return;
        }
        const trigger = target.closest("[data-wtd-arch-trigger]");
        if (trigger) {
            const picker = trigger.closest("[data-wtd-arch-picker]");
            if (picker) {
                const panel = picker.querySelector<HTMLElement>(
                    "[data-wtd-arch-panel]",
                );
                closeAllPanels(root, picker);
                // `hidden` is boolean|string in the DOM lib (until-found);
                // treat any truthy value as hidden -> toggle to open.
                setPanelOpen(picker, panel ? Boolean(panel.hidden) : true);
            }
            return;
        }
        const clear = target.closest("[data-wtd-arch-clear]");
        if (clear) {
            const picker = clear.closest("[data-wtd-arch-picker]");
            if (picker) {
                for (const box of Array.from(
                    picker.querySelectorAll<HTMLInputElement>(
                        "[data-wtd-arch-check]",
                    ),
                )) {
                    box.checked = false;
                }
                syncPicker(picker);
            }
            return;
        }
        // A click anywhere inside an open panel (checkboxes, filter, labels)
        // keeps it open; anything outside every picker closes them all.
        if (!target.closest("[data-wtd-arch-picker]")) {
            closeAllPanels(root);
        }
    });

    root.addEventListener("change", (e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.matches?.("[data-wtd-arch-check]")) {
            return;
        }
        const picker = target.closest("[data-wtd-arch-picker]");
        if (picker) {
            syncPicker(picker);
        }
    });

    root.addEventListener("input", (e) => {
        const target = e.target as HTMLInputElement | null;
        if (!target?.matches?.("[data-wtd-arch-filter]")) {
            return;
        }
        const picker = target.closest("[data-wtd-arch-picker]");
        if (picker) {
            applyFilter(picker, target.value);
        }
    });

    root.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeAllPanels(root);
            return;
        }
        const target = e.target as HTMLElement | null;
        if (
            (e.key === "Enter" || e.key === " ") &&
            target?.matches?.("[data-wtd-arch-trigger]")
        ) {
            e.preventDefault();
            target.click();
        }
    });
};
