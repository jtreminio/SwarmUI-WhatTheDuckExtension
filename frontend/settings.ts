import { initBatchCompare } from "./batchCompare";
import {
    initCivitaiArchPickers,
    renderCivitaiArchPicker,
} from "./civitaiArchPicker";
import {
    type CivitaiFolderMapping,
    foldersFromModelList,
    KNOWN_ARCHITECTURES,
    normalizeMappings,
    setCivitaiFolderMappings,
} from "./civitaiFolders";
import { initCompareShortcuts } from "./compareShortcuts";
import { escapeAttr, escapeHtml } from "./escape";
import { initKeyboardNavigation } from "./keyboardNavigation";

interface WhatTheDuckSettingsResponse {
    success: boolean;
    keyboardNavigationEnabled?: boolean;
    datadumpEnabled?: boolean;
    datadumpFolder?: string;
    datadumpActive?: boolean;
    datadumpCount?: number;
    modifiedPlaceholders?: string[];
    civitaiFolderMappings?: unknown;
    message?: string;
    error?: string;
}

export interface SettingsFormState {
    keyboardNavigationEnabled: boolean;
    datadumpEnabled: boolean;
    datadumpFolder: string;
    civitaiFolderMappings: CivitaiFolderMapping[];
}

const STATUS_TIMEOUT_MS = 5000;

// --- Pure helpers (no I/O; directly unit-testable) ---------------------------

/** Option lists for the three dropdowns in a Civitai mapping row. */
export interface CivitaiRowOptions {
    architectures: string[];
    checkpointFolders: string[];
    loraFolders: string[];
}

/**
 * A SwarmUI-styled dropdown for one mapping-row field. The empty-value
 * placeholder option means "not set"; a current value missing from the option
 * list (e.g. a folder whose models were removed, or an architecture civitai
 * added after this list) is injected so saved settings always round-trip.
 */
export const renderCivitaiSelect = (
    className: string,
    placeholder: string,
    options: string[],
    value: string,
): string => {
    const withValue =
        value && !options.includes(value) ? [...options, value] : options;
    const optionsHtml = withValue
        .map(
            (opt) =>
                `<option value="${escapeAttr(opt)}"${opt === value ? " selected" : ""}>${escapeHtml(opt)}</option>`,
        )
        .join("");
    return `<select class="auto-dropdown ${className}" autocomplete="off"><option value="">${escapeHtml(placeholder)}</option>${optionsHtml}</select>`;
};

/** One editable Civitai architectures-to-folder mapping row. */
export const renderCivitaiMappingRow = (
    mapping: CivitaiFolderMapping,
    options: CivitaiRowOptions,
): string => `
            <div class="whattheduck-civitai-row" data-wtd-civitai-row>
                ${renderCivitaiArchPicker(mapping.architectures, options.architectures)}
                ${renderCivitaiSelect("wtd-civitai-checkpoint", "(No checkpoint folder)", options.checkpointFolders, mapping.checkpointFolder)}
                ${renderCivitaiSelect("wtd-civitai-lora", "(No LoRA folder)", options.loraFolders, mapping.loraFolder)}
                <button type="button" class="basic-button wtd-civitai-remove" title="Remove this mapping">✕</button>
            </div>`;

/** All mapping rows for the Civitai Auto-Folders section. */
export const renderCivitaiMappingRows = (
    mappings: CivitaiFolderMapping[],
    options: CivitaiRowOptions,
): string => mappings.map((m) => renderCivitaiMappingRow(m, options)).join("");

/**
 * Live option lists for a mapping row: the bundled civitai architecture list
 * plus the existing checkpoint/LoRA folders from SwarmUI's model listing
 * (`coreModelMap` is guarded - jsdom tests don't define it and it fills
 * asynchronously after page load).
 */
const getCivitaiRowOptions = (): CivitaiRowOptions => {
    const map = typeof coreModelMap === "undefined" ? undefined : coreModelMap;
    return {
        architectures: KNOWN_ARCHITECTURES,
        checkpointFolders: foldersFromModelList(
            map?.["Stable-Diffusion"] ?? [],
        ),
        loraFolders: foldersFromModelList(map?.LoRA ?? []),
    };
};

/**
 * Read the current mapping rows back out of the DOM. Incomplete rows (no
 * architecture selected, or neither folder set) are dropped, matching what
 * the backend would persist anyway.
 */
export const readCivitaiMappings = (root: ParentNode): CivitaiFolderMapping[] =>
    normalizeMappings(
        Array.from(root.querySelectorAll("[data-wtd-civitai-row]")).map(
            (row) => ({
                architectures: Array.from(
                    row.querySelector<HTMLSelectElement>(".wtd-civitai-arch")
                        ?.selectedOptions ?? [],
                ).map((option) => option.value),
                checkpointFolder:
                    row.querySelector<HTMLSelectElement>(
                        ".wtd-civitai-checkpoint",
                    )?.value ?? "",
                loraFolder:
                    row.querySelector<HTMLSelectElement>(".wtd-civitai-lora")
                        ?.value ?? "",
            }),
        ),
    );

/** Inner HTML for the datadump status line. */
export const renderDatadumpStatus = (
    isActive: boolean,
    count: number,
): string =>
    isActive
        ? `<span class="whattheduck-datadump-active">✓ Active - ${count} datadump file(s) indexed</span>`
        : `<span class="whattheduck-datadump-inactive">○ Inactive - Enable and set path to activate</span>`;

/**
 * Inner HTML for the "modified placeholders" warning report. Returns an empty
 * string when there is nothing to report (caller hides the container).
 */
export const renderModifiedPlaceholders = (modifiedList: string[]): string => {
    if (!modifiedList || modifiedList.length === 0) {
        return "";
    }

    const fileList = modifiedList
        .map((name) => `<li><code>${escapeHtml(name)}</code></li>`)
        .join("");

    return `
            <div class="whattheduck-modified-header">
                <span class="whattheduck-modified-icon">⚠️</span>
                <span class="whattheduck-modified-title">Modified Placeholder Files (${modifiedList.length})</span>
            </div>
            <div class="whattheduck-modified-description">
                The following wildcard files were originally placeholders but have been modified.
                They will now use the local Wildcards content instead of the Datadump files:
            </div>
            <ul class="whattheduck-modified-list">${fileList}</ul>
            <div class="whattheduck-modified-hint">
                To restore datadump handling, delete these files from the Wildcards folder and click "Refresh Datadump".
            </div>
        `;
};

/** Full settings-panel markup, given the values to seed the form controls. */
export const renderSettingsForm = (state: SettingsFormState): string => `
            <div class="whattheduck-settings">
                <form id="whattheduck-form">
                    <div class="input-group input-group-open">
                        <span class="input-group-header input-group-noshrink">
                            <span class="header-label-wrap">
                                <span class="header-label">🦆 WhatTheDuck</span>
                            </span>
                        </span>
                        <div class="input-group-content">
                            <div class="auto-input auto-input-flex">
                                <span class="auto-input-name">
                                    Keyboard Navigation
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_keyboard_nav', arguments[0])">?</span>
                                </span>
                                <label class="auto-checkbox">
                                    <input type="checkbox" id="whattheduck-keyboard-nav" ${state.keyboardNavigationEnabled ? "checked" : ""}>
                                    <span class="auto-checkbox-label">Enable</span>
                                </label>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_keyboard_nav">
                                <b>Keyboard Navigation</b> (toggle):<br>
                                <span class="slight-left-margin-block">
                                    Enables keyboard shortcuts for image navigation and actions:
                                    <br>• <code>A</code> - Navigate to previous image
                                    <br>• <code>D</code> - Navigate to next image
                                    <br>• <code>S</code> - Toggle star/favorite
                                    <br>• <code>X</code> - Delete image (double-tap required)
                                    <br>• <code>C</code> - Compare: mark a batch item, press again on another to open compare (<code>Esc</code> to clear)
                                    <br>• <code>1</code>-<code>7</code> (or Shift symbols <code>!@#$%^&</code>) - In the comparison modal, switch view: Side by Side, Horizontal Slide, Vertical Slide, Transparency Overlay, Single View, Switch Image, Toggle Metadata
                                </span>
                                <br><b>Note:</b> Changes take effect after page reload.
                            </div>

                        </div>
                    </div>

                    <div class="input-group input-group-open">
                        <span class="input-group-header input-group-noshrink">
                            <span class="header-label-wrap">
                                <span class="header-label">📦 Datadump</span>
                            </span>
                        </span>
                        <div class="input-group-content">
                            <div class="auto-input auto-input-flex">
                                <span class="auto-input-name">
                                    Enable Datadump
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_datadump_enable', arguments[0])">?</span>
                                </span>
                                <label class="auto-checkbox">
                                    <input type="checkbox" id="whattheduck-datadump-enabled" ${state.datadumpEnabled ? "checked" : ""}>
                                    <span class="auto-checkbox-label">Enable</span>
                                </label>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_datadump_enable">
                                <b>Enable Datadump</b> (toggle):<br>
                                <span class="slight-left-margin-block">
                                    Enables the Datadump feature for handling very large wildcard files.
                                    <br>When enabled, files in the Datadump folder are indexed and placeholder files are created in the Wildcards folder for autocomplete.
                                    <br>This prevents SwarmUI from loading massive files into memory during "Refresh Wildcards".
                                    <br><b>Both this toggle AND the Datadump Path must be set for the feature to be active.</b>
                                </span>
                            </div>

                            <div class="auto-input auto-input-flex">
                                <label for="whattheduck-datadump-folder">
                                    <span class="auto-input-name">
                                        Datadump Path
                                        <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_datadump_folder', arguments[0])">?</span>
                                    </span>
                                </label>
                                <input class="auto-text" type="text" id="whattheduck-datadump-folder" value="${escapeAttr(state.datadumpFolder)}" placeholder="/path/to/datadump" autocomplete="off">
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_datadump_folder">
                                <b>Datadump Path</b> (string):<br>
                                <span class="slight-left-margin-block">
                                    Absolute path to the directory containing your large wildcard files.
                                    <br>Files in this directory (and subdirectories) with .txt extension will be indexed.
                                    <br>Placeholder files will be created in the Wildcards folder so autocomplete works.
                                    <br><b>Both this path AND the Enable toggle must be set for the feature to be active.</b>
                                </span>
                                <br>Example: <code>/data/wildcards/large</code>
                            </div>

                            <div id="whattheduck-datadump-status" class="whattheduck-datadump-info"></div>

                            <div id="whattheduck-modified-placeholders" class="whattheduck-modified-report"></div>

                            <div class="whattheduck-datadump-actions">
                                <button type="button" id="whattheduck-refresh-datadump" class="basic-button">🔄 Refresh Datadump</button>
                                <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_datadump_refresh', arguments[0])">?</span>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_datadump_refresh">
                                <b>Refresh Datadump</b>:<br>
                                <span class="slight-left-margin-block">
                                    Rescans the datadump directory for new or removed files.
                                    <br>Creates placeholder files in the Wildcards folder for any new datadump files.
                                    <br>Clears the index cache so files will be re-indexed on next use.
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="input-group input-group-open">
                        <span class="input-group-header input-group-noshrink">
                            <span class="header-label-wrap">
                                <span class="header-label">📥 Civitai Auto-Folders</span>
                            </span>
                        </span>
                        <div class="input-group-content">
                            <div class="auto-input auto-input-flex">
                                <span class="auto-input-name">
                                    Folder by Architecture
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_civitai_folders', arguments[0])">?</span>
                                </span>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_civitai_folders">
                                <b>Civitai Auto-Folders</b> (mapping list):<br>
                                <span class="slight-left-margin-block">
                                    When the Model Downloader utility resolves a Civitai URL, the model's base architecture (e.g. <code>Anima</code>, <code>Pony</code>, <code>Illustrious</code>) is matched against this list and the mapped folder is auto-selected in the downloader's Folder dropdown.
                                    <br>• <b>Architectures</b>: one or more of Civitai's "Base model" labels - click the control to open a searchable checklist (it stays open while you pick several, e.g. every "Flux.2 Klein" flavor in one row), or remove one via its pill's ✕. The label is shown on the download page after pasting a URL.
                                    <br>• <b>Checkpoint folder</b>: folder auto-selected for checkpoint downloads. Leave unset to not auto-select checkpoints.
                                    <br>• <b>LoRA folder</b>: folder auto-selected for LoRA downloads. Leave unset to not auto-select LoRAs.
                                    <br>The folder lists show folders that already contain at least one model. To use a brand-new folder, download one model into it first by typing a path in the downloader's "Save as" box.
                                </span>
                            </div>

                            <div id="whattheduck-civitai-mappings">${renderCivitaiMappingRows(state.civitaiFolderMappings, getCivitaiRowOptions())}</div>

                            <div class="whattheduck-civitai-actions">
                                <button type="button" id="whattheduck-civitai-add" class="basic-button">+ Add Mapping</button>
                            </div>
                        </div>
                    </div>

                    <div id="whattheduck-status" class="whattheduck-status"></div>

                    <div class="whattheduck-actions">
                        <button type="submit" class="basic-button">Save Settings</button>
                    </div>
                </form>
            </div>
        `;

// --- Mutable module state ----------------------------------------------------

let keyboardNavigationEnabled = true;
let datadumpEnabled = false;
let datadumpFolder = "";
let civitaiFolderMappings: CivitaiFolderMapping[] = [];
let statusTimer: ReturnType<typeof setTimeout> | null = null;

// --- DOM read helpers --------------------------------------------------------

const readChecked = (id: string): boolean =>
    (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;

const readValue = (id: string): string =>
    (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

// --- DOM apply helpers (thin wrappers around the pure renderers) -------------

const applyDatadumpStatus = (isActive: boolean, count: number): void => {
    const statusDiv = document.getElementById("whattheduck-datadump-status");
    if (statusDiv) {
        statusDiv.innerHTML = renderDatadumpStatus(isActive, count);
    }
};

const applyModifiedPlaceholders = (modifiedList: string[]): void => {
    const reportDiv = document.getElementById(
        "whattheduck-modified-placeholders",
    );
    if (!reportDiv) {
        return;
    }
    const html = renderModifiedPlaceholders(modifiedList);
    reportDiv.innerHTML = html;
    reportDiv.style.display = html ? "block" : "none";
};

/**
 * Re-render the mapping rows (with fresh folder options from the live model
 * listing) and remember them as the current state.
 */
const applyCivitaiMappings = (mappings: CivitaiFolderMapping[]): void => {
    civitaiFolderMappings = mappings;
    setCivitaiFolderMappings(mappings);
    const container = document.getElementById("whattheduck-civitai-mappings");
    if (container) {
        container.innerHTML = renderCivitaiMappingRows(
            mappings,
            getCivitaiRowOptions(),
        );
    }
};

const showStatus = (message: string, type: "success" | "error"): void => {
    const statusDiv = document.getElementById("whattheduck-status");
    if (!statusDiv) {
        return;
    }
    statusDiv.textContent = message;
    statusDiv.className = `whattheduck-status whattheduck-status-${type}`;

    if (statusTimer) {
        clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
        statusDiv.textContent = "";
        statusDiv.className = "whattheduck-status";
        statusTimer = null;
    }, STATUS_TIMEOUT_MS);
};

// --- Controller (I/O against SwarmUI globals) --------------------------------

const loadSettings = (): void => {
    genericRequest<WhatTheDuckSettingsResponse>(
        "WhatTheDuckGetSettings",
        {},
        (data) => {
            if (!data.success) {
                return;
            }

            keyboardNavigationEnabled = data.keyboardNavigationEnabled ?? false;
            datadumpEnabled = data.datadumpEnabled ?? false;
            datadumpFolder = data.datadumpFolder || "";

            (
                document.getElementById(
                    "whattheduck-keyboard-nav",
                ) as HTMLInputElement
            ).checked = keyboardNavigationEnabled;
            (
                document.getElementById(
                    "whattheduck-datadump-enabled",
                ) as HTMLInputElement
            ).checked = datadumpEnabled;
            (
                document.getElementById(
                    "whattheduck-datadump-folder",
                ) as HTMLInputElement
            ).value = datadumpFolder;

            applyDatadumpStatus(
                data.datadumpActive ?? false,
                data.datadumpCount ?? 0,
            );
            applyModifiedPlaceholders(data.modifiedPlaceholders || []);
            applyCivitaiMappings(normalizeMappings(data.civitaiFolderMappings));

            if (keyboardNavigationEnabled) {
                initKeyboardNavigation();
                initBatchCompare();
                initCompareShortcuts();
            }
        },
    );
};

const saveSettings = (): void => {
    const keyboardNav = readChecked("whattheduck-keyboard-nav");
    const nextDatadumpEnabled = readChecked("whattheduck-datadump-enabled");
    const nextDatadumpFolder = readValue("whattheduck-datadump-folder").trim();
    const nextCivitaiMappings = readCivitaiMappings(document);

    genericRequest<WhatTheDuckSettingsResponse>(
        "WhatTheDuckSaveSettings",
        {
            keyboardNavigationEnabled: keyboardNav,
            datadumpEnabled: nextDatadumpEnabled,
            datadumpFolder: nextDatadumpFolder,
            civitaiFolderMappings: JSON.stringify(nextCivitaiMappings),
        },
        (data) => {
            if (data.success) {
                keyboardNavigationEnabled = keyboardNav;
                datadumpEnabled = nextDatadumpEnabled;
                datadumpFolder = nextDatadumpFolder;
                applyCivitaiMappings(nextCivitaiMappings);

                applyDatadumpStatus(
                    data.datadumpActive ?? false,
                    data.datadumpCount ?? 0,
                );
                applyModifiedPlaceholders(data.modifiedPlaceholders || []);
                showStatus(
                    "Settings saved! Reload page for keyboard navigation changes to take effect.",
                    "success",
                );
            } else {
                showStatus(
                    `Failed to save settings: ${data.error || "Unknown error"}`,
                    "error",
                );
            }
        },
    );
};

const refreshDatadump = (): void => {
    const refreshBtn = document.getElementById(
        "whattheduck-refresh-datadump",
    ) as HTMLButtonElement;
    const originalText = refreshBtn.textContent;
    refreshBtn.textContent = "⏳ Refreshing...";
    refreshBtn.disabled = true;

    genericRequest<WhatTheDuckSettingsResponse>(
        "WhatTheDuckRefreshDatadump",
        {},
        (data) => {
            if (data.success) {
                genericRequest(
                    "TriggerRefresh",
                    { refreshType: "wildcards" },
                    () => {
                        refreshBtn.textContent = originalText;
                        refreshBtn.disabled = false;

                        applyDatadumpStatus(true, data.datadumpCount ?? 0);
                        applyModifiedPlaceholders(
                            data.modifiedPlaceholders || [],
                        );
                        showStatus(
                            data.message ?? "Datadump refreshed.",
                            "success",
                        );
                    },
                );
            } else {
                refreshBtn.textContent = originalText;
                refreshBtn.disabled = false;
                showStatus(
                    `Refresh failed: ${data.error || "Unknown error"}`,
                    "error",
                );
            }
        },
    );
};

const init = (): void => {
    const toolDiv = registerNewTool("whattheduck", "WhatTheDuck Settings");

    toolDiv.innerHTML = renderSettingsForm({
        keyboardNavigationEnabled,
        datadumpEnabled,
        datadumpFolder,
        civitaiFolderMappings,
    });

    loadSettings();
    initCivitaiArchPickers(document);

    const form = document.getElementById("whattheduck-form");
    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            saveSettings();
        });
    }

    document
        .getElementById("whattheduck-refresh-datadump")
        ?.addEventListener("click", refreshDatadump);

    document
        .getElementById("whattheduck-civitai-add")
        ?.addEventListener("click", () => {
            document
                .getElementById("whattheduck-civitai-mappings")
                ?.insertAdjacentHTML(
                    "beforeend",
                    renderCivitaiMappingRow(
                        {
                            architectures: [],
                            checkpointFolder: "",
                            loraFolder: "",
                        },
                        getCivitaiRowOptions(),
                    ),
                );
        });

    // Row removal is delegated so rows added later are covered too.
    document
        .getElementById("whattheduck-civitai-mappings")
        ?.addEventListener("click", (e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest(".wtd-civitai-remove")) {
                target.closest("[data-wtd-civitai-row]")?.remove();
            }
        });
};

export const whatTheDuck = {
    init,
};
