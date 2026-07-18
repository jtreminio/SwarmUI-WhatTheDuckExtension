/**
 * Multi-select architecture picker for a Model Auto-Folders mapping row:
 * removable pills when closed, a filterable checkbox panel when open (stays
 * open while toggling; closes on outside click, Esc, or the trigger). A
 * hidden native `<select multiple class="wtd-arch-select">` mirrors the
 * selection, which is what `readArchMappings` in settings.ts reads.
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
 * The full picker control. Selected values missing from `options` are
 * injected so saved settings always round-trip.
 */
export const renderArchPicker = (
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
                <select class="wtd-arch-select" multiple hidden>${hiddenOptions}</select>
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

/** Propagate the checkbox state to the hidden select, pills, and count. */
export const syncPicker = (picker: Element): void => {
    const selected = selectedValues(picker);
    const hiddenSelect = picker.querySelector<HTMLSelectElement>(
        "select.wtd-arch-select",
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

export const refreshTakenOptions = (root: Document): void => {
    const pickers = Array.from(root.querySelectorAll("[data-wtd-arch-picker]"));
    const selections = pickers.map((picker) => selectedValues(picker));
    for (const [i, picker] of pickers.entries()) {
        const taken = new Set(selections.filter((_, j) => j !== i).flat());
        for (const box of Array.from(
            picker.querySelectorAll<HTMLInputElement>("[data-wtd-arch-check]"),
        )) {
            box.closest(".wtd-arch-option")?.classList.toggle(
                "wtd-arch-option-taken",
                taken.has(box.value) && !box.checked,
            );
        }
    }
};

/** Open upward only when the panel doesn't fit below and there is more room above. */
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
        refreshTakenOptions(picker.ownerDocument);
        // Measure AFTER unhiding: offsetHeight is 0 while hidden.
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

/** Install document-level delegated handlers once, so added/re-rendered rows need no re-wiring. */
export const initArchPickers = (root: Document): void => {
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
                refreshTakenOptions(root);
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
                refreshTakenOptions(root);
            }
            return;
        }
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
            refreshTakenOptions(root);
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
