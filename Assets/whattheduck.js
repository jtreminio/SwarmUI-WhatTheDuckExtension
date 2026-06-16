"use strict";
(() => {
  // frontend/promptEdit.ts
  var MODAL_ID = "wtd_prompt_edit_modal";
  var TEXTAREA_ID = "wtd_prompt_edit_textarea";
  var SAVE_ID = "wtd_prompt_edit_save";
  var EDIT_BTN_CLASS = "wtd-prompt-edit-button";
  var EDIT_BTN_MARK = "data-wtd-edit-button";
  var started = false;
  var getTextarea = () => document.getElementById(TEXTAREA_ID);
  var showModal = () => {
    if (typeof $ === "function") {
      $(`#${MODAL_ID}`).modal("show");
    }
    getTextarea()?.focus();
  };
  var hideModal = () => {
    if (typeof $ === "function") {
      $(`#${MODAL_ID}`).modal("hide");
    }
  };
  var setTextarea = (value) => {
    const textarea = getTextarea();
    if (textarea) {
      textarea.value = value;
    }
  };
  var getTextareaValue = () => getTextarea()?.value ?? "";
  function readPositivePrompt(raw) {
    if (!raw) {
      return "";
    }
    let jsonStr = null;
    try {
      jsonStr = interpretMetadata(raw);
    } catch {
      jsonStr = null;
    }
    if (!jsonStr) {
      jsonStr = raw;
    }
    try {
      const obj = JSON.parse(jsonStr);
      const p = obj?.sui_image_params ? obj.sui_image_params.prompt : "";
      if (typeof p === "string") {
        return p;
      }
      return p == null ? "" : String(p);
    } catch {
      return "";
    }
  }
  function injectEditButtons(rootDoc) {
    const containers = rootDoc.querySelectorAll(".current-image-data");
    for (const container of Array.from(containers)) {
      const copyButtons = container.querySelectorAll(".prompt-copy-button");
      for (const copyBtn of Array.from(copyButtons)) {
        const block = copyBtn.closest(".param_view_block");
        if (!block) {
          continue;
        }
        const nameEl = block.querySelector(".param_view_name");
        if (nameEl?.textContent?.trim() !== "Prompt") {
          continue;
        }
        const next = copyBtn.nextElementSibling;
        if (next?.hasAttribute(EDIT_BTN_MARK)) {
          continue;
        }
        if (block.querySelector(`[${EDIT_BTN_MARK}]`)) {
          continue;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `basic-button ${EDIT_BTN_CLASS}`;
        btn.title = "Edit prompt";
        btn.setAttribute(EDIT_BTN_MARK, "true");
        btn.innerHTML = "&#x270E;";
        btn.addEventListener("click", onEditClick);
        copyBtn.insertAdjacentElement("afterend", btn);
      }
    }
  }
  function onEditClick() {
    const el = currentImageHelper.getCurrentImage();
    const raw = el?.dataset?.metadata || currentMetadataVal;
    setTextarea(readPositivePrompt(raw));
    showModal();
  }
  function onSave() {
    const el = currentImageHelper.getCurrentImage();
    const path = el?.dataset ? getImageFullSrc(el.dataset.src) : null;
    const newVal = getTextareaValue();
    if (!path) {
      showError("No current image to save to.");
      hideModal();
      return;
    }
    genericRequest(
      "WhatTheDuckEditPrompt",
      { path, prompt: newVal },
      (data) => {
        if (!data?.success) {
          showError(data?.error || "Failed to save prompt.");
          return;
        }
        const newMetadata = data.metadata ?? "";
        const cur = currentImageHelper.getCurrentImage();
        const curSrc = cur?.dataset.src;
        if (cur && curSrc != null && getImageFullSrc(curSrc) === path) {
          cur.dataset.metadata = newMetadata;
          globalThis.currentMetadataVal = newMetadata;
          if (typeof setCurrentImage === "function") {
            setCurrentImage(
              curSrc,
              newMetadata,
              "",
              false,
              false,
              false
            );
          }
        }
        doNoticePopover("Prompt updated", "notice-pop-green");
        hideModal();
      }
    );
  }
  function buildModal() {
    if (document.getElementById(MODAL_ID)) {
      return;
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = MODAL_ID;
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.innerHTML = `
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header"><h5 class="modal-title">Edit Prompt</h5></div>
                <div class="modal-body">
                    <textarea id="${TEXTAREA_ID}" class="wtd-prompt-edit-textarea auto-text-block" rows="8"></textarea>
                </div>
                <div class="modal-footer">
                    <button type="button" id="${SAVE_ID}" class="btn btn-primary basic-button">Save</button>
                    <button type="button" class="btn btn-secondary basic-button" data-bs-dismiss="modal">Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById(SAVE_ID)?.addEventListener("click", onSave);
    modal.querySelector('[data-bs-dismiss="modal"]')?.addEventListener("click", () => hideModal());
  }
  var init = () => {
    if (started) {
      return;
    }
    started = true;
    buildModal();
    const observer = new MutationObserver(() => injectEditButtons(document));
    observer.observe(document.body, { childList: true, subtree: true });
    injectEditButtons(document);
  };
  var promptEdit = {
    init
  };

  // frontend/dom.ts
  var isEditableElement = (target) => {
    const element = target;
    if (!element) {
      return false;
    }
    const tag = element.tagName;
    return element.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };
  var suppressEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };

  // frontend/batchCompare.ts
  var MARKED_CLASS = "wtd-compare-marked";
  var BATCH_ID = "current_image_batch";
  var HISTORY_ID = "imagehistorybrowser-content";
  var SEARCH_ID = "quarryimagesearch-content";
  var CONTAINER_IDS = [BATCH_ID, HISTORY_ID, SEARCH_ID];
  var closestContainer = (block) => {
    for (const id of CONTAINER_IDS) {
      const container = block?.closest(`#${id}`);
      if (container) {
        return container;
      }
    }
    return null;
  };
  var attached = false;
  var hovered = null;
  var markedBlock = null;
  var isComparable = (block) => {
    if (!block || !document.body.contains(block)) {
      return false;
    }
    if (!block.dataset?.src) {
      return false;
    }
    if (block.classList.contains("image-block-placeholder") || block.classList.contains("image-block-failed")) {
      return false;
    }
    const mediaType = getMediaType(block.dataset.src);
    return mediaType === "image" || mediaType === "video";
  };
  var getTargetBlock = () => {
    if (isComparable(hovered)) {
      return hovered;
    }
    for (const id of CONTAINER_IDS) {
      const container = document.getElementById(id);
      const current = container?.querySelector(
        ".image-block.image-block-current"
      );
      if (isComparable(current)) {
        return current;
      }
    }
    return null;
  };
  var blockToItem = (block) => ({
    src: block.dataset.src,
    mediaType: getMediaType(block.dataset.src)
  });
  var clearMark = () => {
    if (markedBlock) {
      markedBlock.classList.remove(MARKED_CLASS);
    }
    markedBlock = null;
  };
  var markBlock = (block) => {
    clearMark();
    markedBlock = block;
    block.classList.add(MARKED_CLASS);
  };
  var launchCompare = (marked, target) => {
    const items = [blockToItem(marked), blockToItem(target)];
    const valid = imageCompareHelper.evaluateSelection(items);
    if (valid.state !== "ready") {
      if (typeof showError === "function") {
        showError(valid.reason || "Cannot compare current selection.");
      }
      clearMark();
      return;
    }
    clearMark();
    if (imageCompareHelper.isShowingPair(items[0], items[1])) {
      return;
    }
    imageCompareHelper.reset();
    imageCompareHelper.showComparison(items[0], items[1]);
  };
  var handleCompareKey = () => {
    if (typeof imageCompareHelper === "undefined" || imageCompareHelper.isOpen()) {
      return false;
    }
    const target = getTargetBlock();
    if (!target) {
      return false;
    }
    if (markedBlock && !document.body.contains(markedBlock)) {
      clearMark();
    }
    if (!markedBlock) {
      markBlock(target);
      return true;
    }
    if (markedBlock === target) {
      clearMark();
      return true;
    }
    launchCompare(markedBlock, target);
    return true;
  };
  var handleKeydown = (event) => {
    if (event.repeat) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (isEditableElement(event.target)) {
      return;
    }
    const key = event.key;
    if (key === "Escape") {
      if (markedBlock) {
        clearMark();
      }
      return;
    }
    if (key !== "c" && key !== "C") {
      return;
    }
    if (handleCompareKey()) {
      suppressEvent(event);
    }
  };
  var handleMouseover = (event) => {
    const target = event.target;
    const block = target?.closest?.(".image-block");
    hovered = closestContainer(block) ? block : null;
  };
  var initBatchCompare = () => {
    if (attached) {
      return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("mouseover", handleMouseover, true);
    attached = true;
  };

  // frontend/compareShortcuts.ts
  var MODAL_ID2 = "image_compare_modal";
  var KEY_TO_SELECTOR = {
    "1": '[data-compare-mode="side"]',
    "!": '[data-compare-mode="side"]',
    "2": '[data-compare-mode="slide_horizontal"]',
    "@": '[data-compare-mode="slide_horizontal"]',
    "3": '[data-compare-mode="slide_vertical"]',
    "#": '[data-compare-mode="slide_vertical"]',
    "4": '[data-compare-mode="transparency"]',
    $: '[data-compare-mode="transparency"]',
    "5": '[data-compare-mode="single"]',
    "%": '[data-compare-mode="single"]',
    "6": "#image_compare_swap_button",
    "^": "#image_compare_swap_button",
    "7": "#image_compare_metadata_toggle_button",
    "&": "#image_compare_metadata_toggle_button"
  };
  var attached2 = false;
  var isModalOpen = () => typeof imageCompareHelper !== "undefined" && imageCompareHelper.isOpen();
  var handleKeydown2 = (event) => {
    if (event.repeat) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (isEditableElement(event.target)) {
      return;
    }
    if (!isModalOpen()) {
      return;
    }
    const selector = KEY_TO_SELECTOR[event.key];
    if (!selector) {
      return;
    }
    const modal = document.getElementById(MODAL_ID2);
    const button = modal?.querySelector(selector);
    if (!button) {
      return;
    }
    suppressEvent(event);
    button.click();
  };
  var initCompareShortcuts = () => {
    if (attached2) {
      return;
    }
    document.addEventListener("keydown", handleKeydown2, true);
    attached2 = true;
  };

  // frontend/keyboardNavigation.ts
  var DELETE_DOUBLE_TAP_TIMEOUT = 500;
  var attached3 = false;
  var lastDeletePress = 0;
  var deleteTimer = null;
  var dispatchArrowKey = (direction) => {
    const isLeft = direction === "left";
    const key = isLeft ? "ArrowLeft" : "ArrowRight";
    const keyCode = isLeft ? 37 : 39;
    const event = new KeyboardEvent("keydown", {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
  };
  var simulateClick = (element, modifiers = {}) => {
    if (!element) {
      return false;
    }
    const shiftKey = !!modifiers.shiftKey;
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window,
      shiftKey
    };
    try {
      element.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
    } catch {
    }
    element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    try {
      element.dispatchEvent(new PointerEvent("pointerup", eventOptions));
    } catch {
    }
    element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
    element.dispatchEvent(new MouseEvent("click", eventOptions));
    return true;
  };
  var findDeleteButton = (container) => {
    if (!container) {
      return null;
    }
    const buttons = [
      ...container.querySelectorAll("button, [role='button'], .basic-button")
    ];
    return buttons.find((button) => {
      const text = (button.textContent || "").trim().toLowerCase();
      return text === "delete" || text.includes("delete");
    }) ?? null;
  };
  var triggerInterrupt = () => {
    const altBtn = document.getElementById("alt_interrupt_button");
    if (altBtn) {
      simulateClick(altBtn);
      return;
    }
    const simpleBtn = document.getElementById("simple_interrupt_button");
    if (simpleBtn) {
      simulateClick(simpleBtn);
      return;
    }
    mainGenHandler.doInterrupt();
  };
  var getUIContext = () => {
    const modalContainer = document.querySelector("#imageview_modal_imagewrap");
    if (modalContainer) {
      return {
        getStarButton: () => document.querySelector(
          ".imageview_popup_modal_undertext .basic-button.star-button"
        ),
        getDeleteButton: () => {
          const container = modalContainer.querySelector(
            ".image_fullview_extra_buttons"
          ) || document.querySelector(".image_fullview_extra_buttons");
          return findDeleteButton(container);
        }
      };
    }
    return {
      getStarButton: () => document.querySelector(
        ".current-image-buttons .basic-button.star-button"
      ),
      getDeleteButton: () => {
        const container = document.querySelector(".current-image-buttons");
        return findDeleteButton(container);
      }
    };
  };
  var handleDeleteKey = (keydownEvent, context) => {
    const now = Date.now();
    const timeSinceLastPress = now - lastDeletePress;
    if (lastDeletePress && timeSinceLastPress <= DELETE_DOUBLE_TAP_TIMEOUT) {
      if (deleteTimer) {
        clearTimeout(deleteTimer);
        deleteTimer = null;
      }
      lastDeletePress = 0;
      simulateClick(context.getDeleteButton(), {
        shiftKey: keydownEvent.shiftKey
      });
    } else {
      lastDeletePress = now;
      if (deleteTimer) {
        clearTimeout(deleteTimer);
      }
      deleteTimer = setTimeout(() => {
        lastDeletePress = 0;
        deleteTimer = null;
      }, DELETE_DOUBLE_TAP_TIMEOUT);
    }
  };
  var handleKeydown3 = (event) => {
    if (event.repeat) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    if (isEditableElement(event.target)) {
      return;
    }
    const key = event.key;
    if (key !== "a" && key !== "A" && key !== "d" && key !== "D" && key !== "s" && key !== "S" && key !== "x" && key !== "X" && key !== "q" && key !== "Q" && key !== "e" && key !== "E") {
      return;
    }
    suppressEvent(event);
    if (key === "a" || key === "A") {
      dispatchArrowKey("left");
      return;
    }
    if (key === "d" || key === "D") {
      dispatchArrowKey("right");
      return;
    }
    if (key === "e" || key === "E") {
      triggerInterrupt();
      return;
    }
    const context = getUIContext();
    if (key === "s" || key === "S") {
      simulateClick(context.getStarButton());
      return;
    }
    if (key === "x" || key === "X") {
      handleDeleteKey(event, context);
      return;
    }
    if (key === "q" || key === "Q") {
      simulateClick(context.getDeleteButton(), { shiftKey: event.shiftKey });
    }
  };
  var initKeyboardNavigation = () => {
    if (attached3) {
      return;
    }
    document.addEventListener("keydown", handleKeydown3, true);
    attached3 = true;
  };

  // frontend/settings.ts
  var STATUS_TIMEOUT_MS = 5e3;
  var escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };
  var renderDatadumpStatus = (isActive, count) => isActive ? `<span class="whattheduck-datadump-active">✓ Active - ${count} datadump file(s) indexed</span>` : `<span class="whattheduck-datadump-inactive">○ Inactive - Enable and set path to activate</span>`;
  var renderModifiedPlaceholders = (modifiedList) => {
    if (!modifiedList || modifiedList.length === 0) {
      return "";
    }
    const fileList = modifiedList.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("");
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
  var renderSettingsForm = (state) => `
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
  var keyboardNavigationEnabled = true;
  var datadumpEnabled = false;
  var datadumpFolder = "";
  var statusTimer = null;
  var readChecked = (id) => document.getElementById(id)?.checked ?? false;
  var readValue = (id) => document.getElementById(id)?.value ?? "";
  var applyDatadumpStatus = (isActive, count) => {
    const statusDiv = document.getElementById("whattheduck-datadump-status");
    if (statusDiv) {
      statusDiv.innerHTML = renderDatadumpStatus(isActive, count);
    }
  };
  var applyModifiedPlaceholders = (modifiedList) => {
    const reportDiv = document.getElementById(
      "whattheduck-modified-placeholders"
    );
    if (!reportDiv) {
      return;
    }
    const html = renderModifiedPlaceholders(modifiedList);
    reportDiv.innerHTML = html;
    reportDiv.style.display = html ? "block" : "none";
  };
  var showStatus = (message, type) => {
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
  var loadSettings = () => {
    genericRequest(
      "WhatTheDuckGetSettings",
      {},
      (data) => {
        if (!data.success) {
          return;
        }
        keyboardNavigationEnabled = data.keyboardNavigationEnabled ?? false;
        datadumpEnabled = data.datadumpEnabled ?? false;
        datadumpFolder = data.datadumpFolder || "";
        document.getElementById(
          "whattheduck-keyboard-nav"
        ).checked = keyboardNavigationEnabled;
        document.getElementById(
          "whattheduck-datadump-enabled"
        ).checked = datadumpEnabled;
        document.getElementById(
          "whattheduck-datadump-folder"
        ).value = datadumpFolder;
        applyDatadumpStatus(
          data.datadumpActive ?? false,
          data.datadumpCount ?? 0
        );
        applyModifiedPlaceholders(data.modifiedPlaceholders || []);
        if (keyboardNavigationEnabled) {
          initKeyboardNavigation();
          initBatchCompare();
          initCompareShortcuts();
        }
      }
    );
  };
  var saveSettings = () => {
    const keyboardNav = readChecked("whattheduck-keyboard-nav");
    const nextDatadumpEnabled = readChecked("whattheduck-datadump-enabled");
    const nextDatadumpFolder = readValue("whattheduck-datadump-folder").trim();
    genericRequest(
      "WhatTheDuckSaveSettings",
      {
        keyboardNavigationEnabled: keyboardNav,
        datadumpEnabled: nextDatadumpEnabled,
        datadumpFolder: nextDatadumpFolder
      },
      (data) => {
        if (data.success) {
          keyboardNavigationEnabled = keyboardNav;
          datadumpEnabled = nextDatadumpEnabled;
          datadumpFolder = nextDatadumpFolder;
          applyDatadumpStatus(
            data.datadumpActive ?? false,
            data.datadumpCount ?? 0
          );
          applyModifiedPlaceholders(data.modifiedPlaceholders || []);
          showStatus(
            "Settings saved! Reload page for keyboard navigation changes to take effect.",
            "success"
          );
        } else {
          showStatus(
            `Failed to save settings: ${data.error || "Unknown error"}`,
            "error"
          );
        }
      }
    );
  };
  var refreshDatadump = () => {
    const refreshBtn = document.getElementById(
      "whattheduck-refresh-datadump"
    );
    const originalText = refreshBtn.textContent;
    refreshBtn.textContent = "⏳ Refreshing...";
    refreshBtn.disabled = true;
    genericRequest(
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
                data.modifiedPlaceholders || []
              );
              showStatus(
                data.message ?? "Datadump refreshed.",
                "success"
              );
            }
          );
        } else {
          refreshBtn.textContent = originalText;
          refreshBtn.disabled = false;
          showStatus(
            `Refresh failed: ${data.error || "Unknown error"}`,
            "error"
          );
        }
      }
    );
  };
  var init2 = () => {
    const toolDiv = registerNewTool("whattheduck", "WhatTheDuck Settings");
    toolDiv.innerHTML = renderSettingsForm({
      keyboardNavigationEnabled,
      datadumpEnabled,
      datadumpFolder
    });
    loadSettings();
    const form = document.getElementById("whattheduck-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        saveSettings();
      });
    }
    document.getElementById("whattheduck-refresh-datadump")?.addEventListener("click", refreshDatadump);
  };
  var whatTheDuck = {
    init: init2
  };

  // frontend/main.ts
  document.addEventListener("DOMContentLoaded", () => {
    whatTheDuck.init();
    promptEdit.init();
  });
})();
//# sourceMappingURL=whattheduck.js.map
