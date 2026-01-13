let whatTheDuckSettings = {
    largeFileSizeThresholdMB: 50
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
                            <input class="auto-number" type="number" id="whattheduck-threshold" min="1" step="1" value="${whatTheDuckSettings.largeFileSizeThresholdMB}" autocomplete="off" onchange="autoNumberWidth(this)">
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
            whatTheDuckSettings.largeFileSizeThresholdMB = data.largeFileSizeThresholdMB;
            document.getElementById('whattheduck-threshold').value = data.largeFileSizeThresholdMB;
        }
    });
}

function saveWhatTheDuckSettings() {
    const threshold = parseInt(document.getElementById('whattheduck-threshold').value, 10);

    if (isNaN(threshold) || threshold < 1) {
        showWhatTheDuckStatus('Please enter a valid number (minimum 1 MB)', 'error');
        return;
    }

    genericRequest('WhatTheDuckSaveSettings', { largeFileSizeThresholdMB: threshold }, (data) => {
        if (data.success) {
            whatTheDuckSettings.largeFileSizeThresholdMB = threshold;
            showWhatTheDuckStatus('Settings saved!', 'success');
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
