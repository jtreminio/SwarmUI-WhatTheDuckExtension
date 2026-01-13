let whatTheDuckSettings = {
    largeFileSizeThreshold: 5,
    keyboardNavigationEnabled: true,
};

function initWhatTheDuck() {
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
                        <div class="auto-input auto-number-box auto-input-flex">
                            <label for="whattheduck-threshold">
                                <span class="auto-input-name">
                                    Large File Threshold (MB)
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_threshold', arguments[0])">?</span>
                                </span>
                            </label>
                            <input class="auto-number" type="number" id="whattheduck-threshold" min="1" step="1" value="${whatTheDuckSettings.largeFileSizeThreshold}" autocomplete="off" onchange="autoNumberWidth(this)">
                        </div>
                        <div class="sui-popover sui-info-popover" id="popover_whattheduck_threshold">
                            <b>Large File Threshold</b> (integer):<br>
                            <span class="slight-left-margin-block">
                                Wildcard files larger than this size (in MB) will use lazy loading instead of loading the entire file into memory.
                                <br>This dramatically reduces memory usage for very large wildcard files (50MB+).
                                <br>Files below this threshold use SwarmUI's standard wildcard handling.
                            </span>
                            <br>Examples: <code>50</code>, <code>100</code>
                        </div>

                        <div class="auto-input auto-input-flex">
                            <span class="auto-input-name">
                                Keyboard Navigation
                                <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_keyboard_nav', arguments[0])">?</span>
                            </span>
                            <label class="auto-checkbox">
                                <input type="checkbox" id="whattheduck-keyboard-nav" ${whatTheDuckSettings.keyboardNavigationEnabled ? 'checked' : ''}>
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
                            </span>
                            <br><b>Note:</b> Changes take effect after page reload.
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

    loadWhatTheDuckSettings();

    document.getElementById('whattheduck-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveWhatTheDuckSettings();
    });
}

function loadWhatTheDuckSettings() {
    genericRequest('WhatTheDuckGetSettings', {}, (data) => {
        if (data.success) {
            whatTheDuckSettings.largeFileSizeThreshold = data.largeFileSizeThreshold;
            whatTheDuckSettings.keyboardNavigationEnabled = data.keyboardNavigationEnabled;
            document.getElementById('whattheduck-threshold').value = data.largeFileSizeThreshold;
            document.getElementById('whattheduck-keyboard-nav').checked = data.keyboardNavigationEnabled;

            // Initialize keyboard navigation if enabled
            if (whatTheDuckSettings.keyboardNavigationEnabled && typeof keyboardNavigation === 'function') {
                keyboardNavigation();
            }
        }
    });
}

function saveWhatTheDuckSettings() {
    const threshold = parseInt(document.getElementById('whattheduck-threshold').value, 10);
    const keyboardNav = document.getElementById('whattheduck-keyboard-nav').checked;

    if (isNaN(threshold) || threshold < 1) {
        showWhatTheDuckStatus('Please enter a valid number (minimum 1 MB)', 'error');
        return;
    }

    genericRequest('WhatTheDuckSaveSettings', { largeFileSizeThreshold: threshold, keyboardNavigationEnabled: keyboardNav }, (data) => {
        if (data.success) {
            whatTheDuckSettings.largeFileSizeThreshold = threshold;
            whatTheDuckSettings.keyboardNavigationEnabled = keyboardNav;
            showWhatTheDuckStatus('Settings saved! Reload page for keyboard navigation changes to take effect.', 'success');
        } else {
            showWhatTheDuckStatus('Failed to save settings: ' + (data.error || 'Unknown error'), 'error');
        }
    });
}

function showWhatTheDuckStatus(message, type) {
    const statusDiv = document.getElementById('whattheduck-status');
    statusDiv.textContent = message;
    statusDiv.className = 'whattheduck-status whattheduck-status-' + type;

    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = 'whattheduck-status';
    }, 5000);
}

document.addEventListener('DOMContentLoaded', initWhatTheDuck);
