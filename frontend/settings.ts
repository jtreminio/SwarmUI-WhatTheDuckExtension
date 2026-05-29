import { initBatchCompare } from "./batchCompare";
import { initCompareShortcuts } from "./compareShortcuts";
import { initKeyboardNavigation } from "./keyboardNavigation";

interface WhatTheDuckSettingsResponse {
    success: boolean;
    keyboardNavigationEnabled?: boolean;
    datadumpEnabled?: boolean;
    datadumpFolder?: string;
    datadumpActive?: boolean;
    datadumpCount?: number;
    modifiedPlaceholders?: string[];
    message?: string;
    error?: string;
}

export interface SettingsFormState {
    keyboardNavigationEnabled: boolean;
    datadumpEnabled: boolean;
    datadumpFolder: string;
}

const STATUS_TIMEOUT_MS = 5000;

// --- Pure helpers (no I/O; directly unit-testable) ---------------------------

/** HTML-escape arbitrary text by round-tripping it through a detached element. */
export const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
};

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
                                <input class="auto-text" type="text" id="whattheduck-datadump-folder" value="${state.datadumpFolder}" placeholder="/path/to/datadump" autocomplete="off">
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

    genericRequest<WhatTheDuckSettingsResponse>(
        "WhatTheDuckSaveSettings",
        {
            keyboardNavigationEnabled: keyboardNav,
            datadumpEnabled: nextDatadumpEnabled,
            datadumpFolder: nextDatadumpFolder,
        },
        (data) => {
            if (data.success) {
                keyboardNavigationEnabled = keyboardNav;
                datadumpEnabled = nextDatadumpEnabled;
                datadumpFolder = nextDatadumpFolder;

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
    });

    loadSettings();

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
};

export const whatTheDuck = {
    init,
};
