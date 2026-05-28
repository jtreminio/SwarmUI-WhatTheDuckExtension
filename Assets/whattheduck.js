class WhatTheDuck
{
    constructor()
    {
        this.keyboardNavigationEnabled = true;
        this.datadumpEnabled = false;
        this.datadumpFolder = '';

        this.init();
    }

    init()
    {
        let toolDiv = registerNewTool('whattheduck', 'WhatTheDuck Settings');

        toolDiv.innerHTML = `
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
                                    <input type="checkbox" id="whattheduck-keyboard-nav" ${this.keyboardNavigationEnabled ? 'checked' : ''}>
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
                                    <input type="checkbox" id="whattheduck-datadump-enabled" ${this.datadumpEnabled ? 'checked' : ''}>
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
                                <input class="auto-text" type="text" id="whattheduck-datadump-folder" value="${this.datadumpFolder}" placeholder="/path/to/datadump" autocomplete="off">
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
                                <button type="button" id="whattheduck-refresh-datadump" class="basic-button" onclick="refreshDatadump()">🔄 Refresh Datadump</button>
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

        this.loadSettings();

        document.getElementById('whattheduck-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSettings();
        });
    }

    loadSettings() {
        genericRequest('WhatTheDuckGetSettings', {}, (data) => {
            if (data.success) {
                this.keyboardNavigationEnabled = data.keyboardNavigationEnabled;
                this.datadumpEnabled = data.datadumpEnabled;
                this.datadumpFolder = data.datadumpFolder || '';

                document.getElementById('whattheduck-keyboard-nav').checked = data.keyboardNavigationEnabled;
                document.getElementById('whattheduck-datadump-enabled').checked = data.datadumpEnabled;
                document.getElementById('whattheduck-datadump-folder').value = data.datadumpFolder || '';

                this.updateDatadumpStatus(data.datadumpActive, data.datadumpCount);
                this.updateModifiedPlaceholders(data.modifiedPlaceholders || []);

                // Initialize keyboard navigation if enabled
                if (this.keyboardNavigationEnabled && typeof WhatTheDuckKeyboardNavigation === 'function') {
                    WhatTheDuckKeyboardNavigation();
                }
                if (this.keyboardNavigationEnabled && typeof WhatTheDuckBatchCompare === 'function') {
                    WhatTheDuckBatchCompare();
                }
                if (this.keyboardNavigationEnabled && typeof WhatTheDuckCompareShortcuts === 'function') {
                    WhatTheDuckCompareShortcuts();
                }
            }
        });
    }

    updateDatadumpStatus(isActive, count)
    {
        const statusDiv = document.getElementById('whattheduck-datadump-status');
        if (isActive) {
            statusDiv.innerHTML = `<span class="whattheduck-datadump-active">✓ Active - ${count} datadump file(s) indexed</span>`;
        } else {
            statusDiv.innerHTML = `<span class="whattheduck-datadump-inactive">○ Inactive - Enable and set path to activate</span>`;
        }
    }

    escapeHtml(text)
    {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateModifiedPlaceholders(modifiedList)
    {
        const reportDiv = document.getElementById('whattheduck-modified-placeholders');

        if (!modifiedList || modifiedList.length === 0) {
            reportDiv.innerHTML = '';
            reportDiv.style.display = 'none';
            return;
        }

        reportDiv.style.display = 'block';

        const fileList = modifiedList.map(name => `<li><code>${this.escapeHtml(name)}</code></li>`).join('');

        reportDiv.innerHTML = `
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
    }

    saveSettings()
    {
        const keyboardNav = document.getElementById('whattheduck-keyboard-nav').checked;
        const datadumpEnabled = document.getElementById('whattheduck-datadump-enabled').checked;
        const datadumpFolder = document.getElementById('whattheduck-datadump-folder').value.trim();

        genericRequest('WhatTheDuckSaveSettings', {
            keyboardNavigationEnabled: keyboardNav,
            datadumpEnabled: datadumpEnabled,
            datadumpFolder: datadumpFolder
        }, (data) => {
            if (data.success) {
                this.keyboardNavigationEnabled = keyboardNav;
                this.datadumpEnabled = datadumpEnabled;
                this.datadumpFolder = datadumpFolder;

                this.updateDatadumpStatus(data.datadumpActive, data.datadumpCount);
                this.showStatus('Settings saved! Reload page for keyboard navigation changes to take effect.', 'success');
            } else {
                this.showStatus('Failed to save settings: ' + (data.error || 'Unknown error'), 'error');
            }
        });
    }

    showStatus(message, type)
    {
        const statusDiv = document.getElementById('whattheduck-status');
        statusDiv.textContent = message;
        statusDiv.className = 'whattheduck-status whattheduck-status-' + type;

        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'whattheduck-status';
        }, 5000);
    }

    refreshDatadump()
    {
        const refreshBtn = document.getElementById('whattheduck-refresh-datadump');
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = '⏳ Refreshing...';
        refreshBtn.disabled = true;

        genericRequest('WhatTheDuckRefreshDatadump', {}, (data) => {
            if (data.success) {
                genericRequest('TriggerRefresh', { refreshType: 'wildcards' }, () => {
                    refreshBtn.textContent = originalText;
                    refreshBtn.disabled = false;

                    this.updateDatadumpStatus(true, data.datadumpCount);
                    this.updateModifiedPlaceholders(data.modifiedPlaceholders || []);
                    this.showStatus(data.message, 'success');
                });
            } else {
                refreshBtn.textContent = originalText;
                refreshBtn.disabled = false;
                this.showStatus('Refresh failed: ' + (data.error || 'Unknown error'), 'error');
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => new WhatTheDuck());
