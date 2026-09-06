/** Reuse SwarmUI's image multi-selector for model browsers. */
const ACTION = "Set Linked Preset";
const MODAL_ID = "wtd-model-preset-modal";
const patched = new WeakSet<WtdModelBrowser["browser"]>();
let dialog: HTMLDivElement | null = null;

/** Called by the shared C shortcut before considering image comparison. */
export function toggleHoveredModelSelection(target: Element | null): boolean {
    const tile = target?.closest<HTMLElement>("[data-name]");
    if (
        !tile?.isConnected ||
        tile.closest("[hidden], [inert], .tab-pane:not(.active)") ||
        typeof allModelBrowsers === "undefined"
    ) {
        return false;
    }
    const wrapper = allModelBrowsers.find(
        ({ browser }) =>
            patched.has(browser) && tile.parentElement === browser.contentDiv,
    );
    if (!wrapper) {
        return false;
    }
    wrapper.browser.setMultiSelectActive(true);
    return wrapper.browser.handleMultiSelectTileClick(tile);
}

function choosePreset(wrapper: WtdModelBrowser): void {
    if (dialog?.isConnected) {
        return;
    }
    // Keep the action's targets stable while the picker is open.
    const names = [
        ...new Set(
            wrapper.browser
                .getMultiSelectedFiles()
                .map((file) => cleanModelName(file.data.name)),
        ),
    ];
    if (!names.length || typeof modelPresetLinkManager === "undefined") {
        return;
    }
    const picker = document.createElement("div");
    dialog = picker;
    picker.id = MODAL_ID;
    picker.className = "modal";
    picker.tabIndex = -1;
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-labelledby", "wtd-model-preset-title");
    picker.innerHTML = `
        <div class="modal-dialog" role="document">
            <form class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="wtd-model-preset-title">Set Linked Preset</h5>
                </div>
                <div class="modal-body">
                    <p class="wtd-model-preset-summary"></p>
                    <label for="wtd-model-preset-choice">Preset</label>
                    <select id="wtd-model-preset-choice" class="modal_text_extra"></select>
                    <p>This replaces the existing preset links for these models. Choose (None) to remove their links.</p>
                    <p class="wtd-model-preset-status" role="status"></p>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn btn-primary basic-button">Apply</button>
                    <button type="button" class="btn btn-secondary basic-button">Cancel</button>
                </div>
            </form>
        </div>`;
    picker.querySelector(".wtd-model-preset-summary").textContent =
        `Assign a preset to ${names.length} selected ${wrapper.subType} model${names.length === 1 ? "" : "s"}.`;
    const select = picker.querySelector("select");
    select.add(new Option("(None)", ""));
    const titles = new Set(
        (typeof allPresetsUnsorted === "undefined" ? [] : allPresetsUnsorted)
            .map((preset) => (preset.data || preset).title)
            .filter((title): title is string => !!title?.trim()),
    );
    for (const title of [...titles].sort((a, b) => a.localeCompare(b))) {
        select.add(new Option(title, title));
    }
    // A single shared link (or no links on any model) is unambiguous. Mixed
    // selections and models with multiple links require an explicit choice.
    const currentLinks = names.map(
        (name) => modelPresetLinkManager.links[wrapper.subType]?.[name] ?? [],
    );
    const firstLinks = currentLinks[0];
    select.selectedIndex = -1;
    if (
        firstLinks.length <= 1 &&
        currentLinks.every(
            (links) =>
                links.length === firstLinks.length &&
                links[0] === firstLinks[0],
        )
    ) {
        select.value = firstLinks[0] ?? "";
    }
    const apply = picker.querySelector<HTMLButtonElement>("[type=submit]");
    const cancel = picker.querySelector<HTMLButtonElement>("[type=button]");
    const status = picker.querySelector<HTMLElement>("[role=status]");
    apply.disabled = select.selectedIndex < 0;
    select.addEventListener("change", () => {
        apply.disabled = select.selectedIndex < 0;
    });
    let saving = false;
    const hide = (): void => {
        $(`#${MODAL_ID}`).modal("hide");
    };
    cancel.addEventListener("click", hide);
    picker.addEventListener("hide.bs.modal", (event) => {
        if (saving) {
            event.preventDefault();
        }
    });
    picker.addEventListener("hidden.bs.modal", () => {
        $(`#${MODAL_ID}`).modal("dispose");
        picker.remove();
        dialog = null;
    });
    picker.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (saving || select.selectedIndex < 0) {
            return;
        }
        saving = true;
        select.disabled = apply.disabled = cancel.disabled = true;
        status.textContent = "Saving preset links…";
        const manager = modelPresetLinkManager;
        // SetPresetLinks replaces the full map. Send one snapshot for the whole
        // selection, preserving other models and avoiding per-model save races.
        const links: WtdPresetLinks = JSON.parse(JSON.stringify(manager.links));
        links[wrapper.subType] ??= {};
        for (const name of names) {
            if (select.value) {
                links[wrapper.subType][name] = [select.value];
            } else {
                delete links[wrapper.subType][name];
            }
        }
        genericRequest(
            "SetPresetLinks",
            links,
            () => {
                manager.links[wrapper.subType] ??= {};
                for (const name of names) {
                    if (links[wrapper.subType][name]) {
                        manager.links[wrapper.subType][name] =
                            links[wrapper.subType][name];
                    } else {
                        delete manager.links[wrapper.subType][name];
                    }
                }
                saving = false;
                hide();
                wrapper.browser.rerender();
                doNoticePopover(
                    `Updated preset links for ${names.length} models.`,
                    "notice-pop-green",
                );
            },
            0,
            (message) => {
                saving = false;
                select.disabled = apply.disabled = cancel.disabled = false;
                status.textContent = `Could not save preset links: ${message}`;
            },
        );
    });
    document.body.appendChild(picker);
    $(`#${MODAL_ID}`).modal("show");
}

export function enableModelMultiSelect(wrapper: WtdModelBrowser): void {
    const browser = wrapper.browser;
    if (
        wrapper.subType === "Wildcards" ||
        patched.has(browser) ||
        typeof browser.getCommonMultiSelectActionLabels !== "function" ||
        typeof browser.runMultiSelectAction !== "function"
    ) {
        return;
    }
    patched.add(browser);
    browser.allowMultiSelect = true;
    const originalLabels = browser.getCommonMultiSelectActionLabels;
    browser.getCommonMultiSelectActionLabels = function () {
        const labels = originalLabels.call(this);
        if (this.getMultiSelectedFiles().length && !labels.includes(ACTION)) {
            labels.push(ACTION);
        }
        return labels;
    };
    const originalRun = browser.runMultiSelectAction;
    browser.runMultiSelectAction = function (label) {
        if (label === ACTION) {
            choosePreset(wrapper);
        } else {
            originalRun.call(this, label);
        }
    };
}

export const modelMultiSelect = {
    init(): void {
        if (typeof allModelBrowsers !== "undefined") {
            for (const wrapper of allModelBrowsers) {
                enableModelMultiSelect(wrapper);
            }
        }
    },
};
