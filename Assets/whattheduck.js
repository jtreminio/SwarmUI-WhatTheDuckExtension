"use strict";
(() => {
  // frontend/archFolders.ts
  var normalizeMappings = (raw) => {
    if (!Array.isArray(raw)) {
      return [];
    }
    const result = [];
    const claimedKeys = /* @__PURE__ */ new Set();
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const rec = entry;
      const architectures = [];
      for (const value of Array.isArray(rec.architectures) ? rec.architectures : []) {
        if (typeof value !== "string") {
          continue;
        }
        const arch = value.trim();
        const key = arch.toLowerCase();
        if (arch && !claimedKeys.has(key) && !architectures.some((a) => a.toLowerCase() === key)) {
          architectures.push(arch);
        }
      }
      const checkpointFolder = typeof rec.checkpointFolder === "string" ? rec.checkpointFolder.trim() : "";
      const loraFolder = typeof rec.loraFolder === "string" ? rec.loraFolder.trim() : "";
      if (architectures.length === 0 || !checkpointFolder && !loraFolder) {
        continue;
      }
      for (const arch of architectures) {
        claimedKeys.add(arch.toLowerCase());
      }
      result.push({
        architectures,
        baseFolder: rec.baseFolder === "diffusion_models" ? "diffusion_models" : "Stable-Diffusion",
        checkpointFolder,
        loraFolder
      });
    }
    return result;
  };
  var folderForDetection = (mappings2, detection) => {
    const keys = [detection.compatClass, detection.archId].filter((key) => !!key).map((key) => key.trim().toLowerCase());
    if (keys.length === 0) {
      return null;
    }
    for (const mapping of mappings2) {
      const matches = mapping.architectures.some(
        (arch) => keys.includes(arch.trim().toLowerCase())
      );
      if (!matches) {
        continue;
      }
      const folder = detection.isLora ? mapping.loraFolder : mapping.checkpointFolder;
      if (folder) {
        return {
          folder,
          modelType: detection.isLora ? "LoRA" : "Stable-Diffusion",
          ...!detection.isLora ? { baseFolder: mapping.baseFolder } : {}
        };
      }
    }
    return null;
  };
  var shouldDetectUrl = (raw) => {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) {
      return false;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === "civitai.com" || host === "civitai.red" || host.endsWith(".civitai.com") || host.endsWith(".civitai.red")) {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return path.endsWith(".safetensors") || path.endsWith(".sft") || path.endsWith(".gguf");
  };
  var foldersFromModelList = (models) => {
    const folders = /* @__PURE__ */ new Set();
    for (const model of models) {
      const parts = model.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    return Array.from(folders).sort();
  };
  var applyFolderSelection = (select, folder) => {
    const exists = Array.from(select.options).some(
      (opt) => opt.value === folder
    );
    if (!exists) {
      const option = document.createElement("option");
      option.textContent = folder;
      select.appendChild(option);
    }
    select.value = folder;
  };
  var patchDownloader = (downloader, getMappings, detect, debounceMs = 500) => {
    let selected = null;
    let seq = 0;
    let timer = null;
    const runDetect = (url) => {
      selected = null;
      const mySeq = ++seq;
      detect(url, (detection) => {
        if (mySeq !== seq || !detection) {
          return;
        }
        const match = folderForDetection(getMappings(), detection);
        if (!match || downloader.url.value !== url) {
          return;
        }
        selected = match.baseFolder ? { url, baseFolder: match.baseFolder } : null;
        downloader.type.value = match.modelType;
        applyFolderSelection(downloader.folders, match.folder);
      });
    };
    const originalUrlInput = downloader.urlInput.bind(downloader);
    downloader.urlInput = () => {
      selected = null;
      seq++;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      originalUrlInput();
      const url = downloader.url.value.trim();
      if (!shouldDetectUrl(url)) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        runDetect(url);
      }, debounceMs);
    };
    const originalGetMetadata = downloader.getCivitaiMetadata.bind(downloader);
    downloader.getCivitaiMetadata = (id, versId, callback, identifier, validateSafe, delayedCallback) => {
      const wrapped = (...args) => {
        callback(...args);
        const [rawData, , , , downloadUrl] = args;
        try {
          if (!rawData || !delayedCallback || !downloadUrl || downloader.url.value !== downloadUrl) {
            return;
          }
          runDetect(downloadUrl);
        } catch {
        }
      };
      originalGetMetadata(
        id,
        versId,
        wrapped,
        identifier,
        validateSafe,
        delayedCallback
      );
    };
    return (url, type) => type === "Stable-Diffusion" && selected?.url === url ? selected.baseFolder : null;
  };
  var isGgufDownload = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.pathname.toLowerCase().endsWith(".gguf") || parsed.hash.toLowerCase() === "#.gguf";
    } catch {
      return false;
    }
  };
  var patchDownloadRequests = (host, prototype, getBaseFolder) => {
    const destinations = /* @__PURE__ */ new WeakMap();
    let active = null;
    const originalDownload = prototype.download;
    prototype.download = function() {
      if (!destinations.has(this)) {
        destinations.set(
          this,
          isGgufDownload(this.url) ? null : getBaseFolder(this.url, this.type)
        );
      }
      const previous = active;
      const baseFolder = destinations.get(this);
      active = baseFolder ? { card: this, baseFolder } : null;
      try {
        originalDownload.call(this);
      } finally {
        active = previous;
      }
    };
    const originalRequest = host.makeWSRequest;
    host.makeWSRequest = (endpoint, data, ...callbacks) => {
      if (endpoint === "DoModelDownloadWS" && active && data.url === active.card.url && data.type === "Stable-Diffusion") {
        return originalRequest(
          "WhatTheDuckDownloadModelWS",
          { ...data, baseFolder: active.baseFolder },
          ...callbacks
        );
      }
      return originalRequest(endpoint, data, ...callbacks);
    };
  };
  var mappings = [];
  var started = false;
  var setArchFolderMappings = (next) => {
    mappings = next;
  };
  var requestDetection = (url, callback) => {
    genericRequest(
      "WhatTheDuckDetectModelArch",
      { url },
      (data) => {
        callback(
          data?.success ? {
            archId: data.archId ?? "",
            archName: data.archName ?? "",
            compatClass: data.compatClass ?? null,
            isLora: !!data.isLora
          } : null
        );
      }
    );
  };
  var init = () => {
    if (started) {
      return;
    }
    started = true;
    if (typeof modelDownloader === "undefined" || typeof modelDownloader?.urlInput !== "function" || typeof modelDownloader?.getCivitaiMetadata !== "function") {
      return;
    }
    const getBaseFolder = patchDownloader(
      modelDownloader,
      () => mappings,
      requestDetection
    );
    if (typeof ActiveModelDownload !== "undefined" && typeof makeWSRequest === "function") {
      patchDownloadRequests(
        window,
        ActiveModelDownload.prototype,
        getBaseFolder
      );
    }
  };
  var archFolders = {
    init
  };

  // frontend/comfyWorkflowSave.ts
  var BUTTON_ID = "wtd_comfy_save_workflow_button";
  var ROW_ID = "wtd_comfy_save_workflow_row";
  var ROW_CLASS = "wtd-comfy-save-row";
  var BUTTON_LABEL = "Import & Save To Server";
  var BUTTON_TITLE = "Import the generate tab's workflow into the editor, and save it plus the payload it was built from as JSON files on the machine running SwarmUI.";
  var MARK_CLASS = "wtd-comfy-save-mark";
  var BUSY_MARK = "…";
  var DONE_MARK = "✓";
  var DONE_TIMEOUT_MS = 2500;
  var started2 = false;
  var markTimer = null;
  var buildClipboardLine = (res) => {
    const payload = res.payloadLocalPath || res.payloadPath || "";
    const workflow = res.workflowLocalPath || res.workflowPath || "";
    return `Payload: ${payload}, Generated Workflow: ${workflow}`;
  };
  var setButtonMark = (mark, timeoutMs = 0, rootDoc = document) => {
    const btn = rootDoc.getElementById(BUTTON_ID);
    if (!btn) {
      return;
    }
    if (markTimer !== null) {
      clearTimeout(markTimer);
      markTimer = null;
    }
    let span = btn.querySelector(`.${MARK_CLASS}`);
    if (!mark) {
      span?.remove();
      return;
    }
    if (!span) {
      span = rootDoc.createElement("span");
      span.className = MARK_CLASS;
      btn.appendChild(span);
    }
    span.textContent = mark;
    if (timeoutMs > 0) {
      const shown = span;
      markTimer = setTimeout(() => {
        shown.remove();
        markTimer = null;
      }, timeoutMs);
    }
  };
  var loadWorkflowIntoEditor = (workflow) => {
    if (typeof comfyFrame !== "function") {
      return false;
    }
    const win = comfyFrame()?.contentWindow;
    const app = win?.app;
    const liteGraph = win?.LiteGraph;
    if (!app?.loadApiJson || !liteGraph?.cloneObject) {
      return false;
    }
    app.loadApiJson(liteGraph.cloneObject(JSON.parse(workflow)));
    return true;
  };
  var onSaveClick = () => {
    if (typeof getGenInput !== "function") {
      showError("Generate tab parameters are not available.");
      return;
    }
    const payload = getGenInput();
    setButtonMark(BUSY_MARK);
    genericRequest(
      "ComfyGetGeneratedWorkflow",
      payload,
      (data) => {
        if (!data?.workflow) {
          setButtonMark("");
          showError(data?.error || "No workflow found.");
          return;
        }
        try {
          loadWorkflowIntoEditor(data.workflow);
        } catch (err) {
          showError(`Failed to load workflow into the editor: ${err}`);
        }
        genericRequest(
          "WhatTheDuckSaveComfyWorkflow",
          {
            payload: JSON.stringify(payload),
            workflow: data.workflow
          },
          (res) => {
            if (!res?.success) {
              setButtonMark("");
              showError(res?.error || "Failed to save workflow.");
              return;
            }
            if (typeof copyText === "function") {
              copyText(buildClipboardLine(res));
            }
            setButtonMark(DONE_MARK, DONE_TIMEOUT_MS);
          }
        );
      }
    );
  };
  function injectSaveButton(rootDoc) {
    if (rootDoc.getElementById(BUTTON_ID)) {
      return true;
    }
    const importBtn = rootDoc.querySelector(
      '#comfy_workflow_buttons button[onclick*="comfyImportWorkflow"]'
    );
    if (!importBtn) {
      return false;
    }
    const btn = rootDoc.createElement("button");
    btn.type = "button";
    btn.id = BUTTON_ID;
    btn.className = "basic-button comfy-small-button comfy-left-button";
    btn.title = BUTTON_TITLE;
    btn.textContent = BUTTON_LABEL;
    btn.addEventListener("click", onSaveClick);
    const quickload = rootDoc.querySelector(
      "#comfy_workflow_buttons .comfy_quickload"
    );
    if (quickload) {
      quickload.classList.add(ROW_CLASS);
      quickload.insertAdjacentElement("afterbegin", btn);
      return true;
    }
    const row = rootDoc.createElement("div");
    row.id = ROW_ID;
    row.className = `comfy-second-button-row ${ROW_CLASS}`;
    row.appendChild(btn);
    const importRow = importBtn.closest(".comfy-second-button-row") ?? importBtn;
    importRow.insertAdjacentElement("afterend", row);
    return true;
  }
  var init2 = () => {
    if (started2) {
      return;
    }
    started2 = true;
    if (injectSaveButton(document)) {
      return;
    }
    const observer = new MutationObserver(() => {
      if (injectSaveButton(document)) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  var comfyWorkflowSave = {
    init: init2
  };

  // frontend/modelMultiSelect.ts
  var ACTION = "Set Linked Preset";
  var MODAL_ID = "wtd-model-preset-modal";
  var patched = /* @__PURE__ */ new WeakSet();
  var dialog = null;
  function toggleHoveredModelSelection(target) {
    const tile = target?.closest("[data-name]");
    if (!tile?.isConnected || tile.closest("[hidden], [inert], .tab-pane:not(.active)") || typeof allModelBrowsers === "undefined") {
      return false;
    }
    const wrapper = allModelBrowsers.find(
      ({ browser }) => patched.has(browser) && tile.parentElement === browser.contentDiv
    );
    if (!wrapper) {
      return false;
    }
    wrapper.browser.setMultiSelectActive(true);
    return wrapper.browser.handleMultiSelectTileClick(tile);
  }
  function choosePreset(wrapper) {
    if (dialog?.isConnected) {
      return;
    }
    const names = [
      ...new Set(
        wrapper.browser.getMultiSelectedFiles().map((file) => cleanModelName(file.data.name))
      )
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
    picker.querySelector(".wtd-model-preset-summary").textContent = `Assign a preset to ${names.length} selected ${wrapper.subType} model${names.length === 1 ? "" : "s"}.`;
    const select = picker.querySelector("select");
    select.add(new Option("(None)", ""));
    const titles = new Set(
      (typeof allPresetsUnsorted === "undefined" ? [] : allPresetsUnsorted).map((preset) => (preset.data || preset).title).filter((title) => !!title?.trim())
    );
    for (const title of [...titles].sort((a, b) => a.localeCompare(b))) {
      select.add(new Option(title, title));
    }
    const currentLinks = names.map(
      (name) => modelPresetLinkManager.links[wrapper.subType]?.[name] ?? []
    );
    const firstLinks = currentLinks[0];
    select.selectedIndex = -1;
    if (firstLinks.length <= 1 && currentLinks.every(
      (links) => links.length === firstLinks.length && links[0] === firstLinks[0]
    )) {
      select.value = firstLinks[0] ?? "";
    }
    const apply = picker.querySelector("[type=submit]");
    const cancel = picker.querySelector("[type=button]");
    const status = picker.querySelector("[role=status]");
    apply.disabled = select.selectedIndex < 0;
    select.addEventListener("change", () => {
      apply.disabled = select.selectedIndex < 0;
    });
    let saving = false;
    const hide = () => {
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
      const links = JSON.parse(JSON.stringify(manager.links));
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
              manager.links[wrapper.subType][name] = links[wrapper.subType][name];
            } else {
              delete manager.links[wrapper.subType][name];
            }
          }
          saving = false;
          hide();
          wrapper.browser.rerender();
          doNoticePopover(
            `Updated preset links for ${names.length} models.`,
            "notice-pop-green"
          );
        },
        0,
        (message) => {
          saving = false;
          select.disabled = apply.disabled = cancel.disabled = false;
          status.textContent = `Could not save preset links: ${message}`;
        }
      );
    });
    document.body.appendChild(picker);
    $(`#${MODAL_ID}`).modal("show");
  }
  function enableModelMultiSelect(wrapper) {
    const browser = wrapper.browser;
    if (wrapper.subType === "Wildcards" || patched.has(browser) || typeof browser.getCommonMultiSelectActionLabels !== "function" || typeof browser.runMultiSelectAction !== "function") {
      return;
    }
    patched.add(browser);
    browser.allowMultiSelect = true;
    const originalLabels = browser.getCommonMultiSelectActionLabels;
    browser.getCommonMultiSelectActionLabels = function() {
      const labels = originalLabels.call(this);
      if (this.getMultiSelectedFiles().length && !labels.includes(ACTION)) {
        labels.push(ACTION);
      }
      return labels;
    };
    const originalRun = browser.runMultiSelectAction;
    browser.runMultiSelectAction = function(label) {
      if (label === ACTION) {
        choosePreset(wrapper);
      } else {
        originalRun.call(this, label);
      }
    };
  }
  var modelMultiSelect = {
    init() {
      if (typeof allModelBrowsers !== "undefined") {
        for (const wrapper of allModelBrowsers) {
          enableModelMultiSelect(wrapper);
        }
      }
    }
  };

  // frontend/promptEdit.ts
  var MODAL_ID2 = "wtd_prompt_edit_modal";
  var TEXTAREA_ID = "wtd_prompt_edit_textarea";
  var SAVE_ID = "wtd_prompt_edit_save";
  var EDIT_BTN_CLASS = "wtd-prompt-edit-button";
  var EDIT_BTN_MARK = "data-wtd-edit-button";
  var started3 = false;
  var getTextarea = () => document.getElementById(TEXTAREA_ID);
  var showModal = () => {
    if (typeof $ === "function") {
      $(`#${MODAL_ID2}`).modal("show");
    }
    getTextarea()?.focus();
  };
  var hideModal = () => {
    if (typeof $ === "function") {
      $(`#${MODAL_ID2}`).modal("hide");
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
    if (document.getElementById(MODAL_ID2)) {
      return;
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = MODAL_ID2;
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
  var init3 = () => {
    if (started3) {
      return;
    }
    started3 = true;
    buildModal();
    const observer = new MutationObserver(() => injectEditButtons(document));
    observer.observe(document.body, { childList: true, subtree: true });
    injectEditButtons(document);
  };
  var promptEdit = {
    init: init3
  };

  // frontend/redo.ts
  var BUTTON_NAME = "Redo";
  var BUTTON_TITLE2 = "Generate a new image with a fresh random seed, reusing every other setting from this image (including the already-finalized prompt — wildcards and MagicPrompt are not re-rolled).";
  var registered = false;
  var NON_PARAM_KEYS = /* @__PURE__ */ new Set(["swarm_version"]);
  var parseSwarmMetadata = (raw) => {
    if (!raw) {
      return null;
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
      if (obj && typeof obj === "object" && obj.sui_image_params) {
        return obj;
      }
      return null;
    } catch {
      return null;
    }
  };
  var buildRedoInput = (meta) => {
    const params = meta.sui_image_params ?? {};
    const input = {};
    for (const [key, value] of Object.entries(params)) {
      if (NON_PARAM_KEYS.has(key)) {
        continue;
      }
      input[key] = value;
    }
    input.seed = -1;
    input.images = 1;
    input.batchsize = 1;
    const extra = meta.sui_extra_data ?? {};
    const extraMetadata = {};
    if (typeof extra.original_prompt === "string") {
      extraMetadata.original_prompt = extra.original_prompt;
    }
    if (typeof extra.original_negativeprompt === "string") {
      extraMetadata.original_negativeprompt = extra.original_negativeprompt;
    }
    if (Object.keys(extraMetadata).length > 0) {
      input.extra_metadata = extraMetadata;
    }
    return input;
  };
  var onRedoClick = () => {
    const el = currentImageHelper.getCurrentImage();
    const raw = el?.dataset?.metadata || currentMetadataVal;
    const meta = parseSwarmMetadata(raw);
    if (!meta) {
      showError("No image parameters available to redo.");
      return;
    }
    const redoInput = buildRedoInput(meta);
    mainGenHandler.doGenerate(
      {},
      {},
      (actualInput) => {
        for (const key of Object.keys(actualInput)) {
          delete actualInput[key];
        }
        Object.assign(actualInput, redoInput);
      }
    );
  };
  var init4 = () => {
    if (registered) {
      return;
    }
    if (typeof registerMediaButton !== "function") {
      return;
    }
    registered = true;
    registerMediaButton(
      BUTTON_NAME,
      onRedoClick,
      BUTTON_TITLE2,
      ["image", "video"],
      false,
      true
    );
  };
  var redo = {
    init: init4,
    run: onRedoClick
  };

  // frontend/escape.ts
  var escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };
  var escapeAttr = (text) => escapeHtml(text).replaceAll('"', "&quot;");

  // frontend/archPicker.ts
  var renderArchPills = (selected) => {
    if (selected.length === 0) {
      return `<span class="wtd-arch-placeholder">(Architectures)</span>`;
    }
    return selected.map(
      (value) => `<span class="wtd-arch-pill">${escapeHtml(value)}<button type="button" class="wtd-arch-pill-x" data-wtd-arch-pill-remove data-value="${escapeAttr(value)}" title="Remove ${escapeAttr(value)}">✕</button></span>`
    ).join("");
  };
  var renderArchPicker = (selected, options) => {
    const withValues = [...options];
    for (const value of selected) {
      if (value && !withValues.includes(value)) {
        withValues.push(value);
      }
    }
    const hiddenOptions = withValues.map(
      (opt) => `<option value="${escapeAttr(opt)}"${selected.includes(opt) ? " selected" : ""}>${escapeHtml(opt)}</option>`
    ).join("");
    const checkboxes = withValues.map(
      (opt) => `<label class="wtd-arch-option"><input type="checkbox" data-wtd-arch-check value="${escapeAttr(opt)}"${selected.includes(opt) ? " checked" : ""}><span>${escapeHtml(opt)}</span></label>`
    ).join("");
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
  var selectedValues = (picker) => Array.from(
    picker.querySelectorAll("[data-wtd-arch-check]")
  ).filter((box) => box.checked).map((box) => box.value);
  var syncPicker = (picker) => {
    const selected = selectedValues(picker);
    const hiddenSelect = picker.querySelector(
      "select.wtd-arch-select"
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
  var refreshTakenOptions = (root) => {
    const pickers = Array.from(root.querySelectorAll("[data-wtd-arch-picker]"));
    const selections = pickers.map((picker) => selectedValues(picker));
    for (const [i, picker] of pickers.entries()) {
      const taken = new Set(selections.filter((_, j) => j !== i).flat());
      for (const box of Array.from(
        picker.querySelectorAll("[data-wtd-arch-check]")
      )) {
        box.closest(".wtd-arch-option")?.classList.toggle(
          "wtd-arch-option-taken",
          taken.has(box.value) && !box.checked
        );
      }
    }
  };
  var shouldOpenUpward = (spaceAbove, spaceBelow, panelHeight, margin = 12) => spaceBelow < panelHeight + margin && spaceAbove > spaceBelow;
  var setPanelOpen = (picker, open) => {
    const panel = picker.querySelector("[data-wtd-arch-panel]");
    if (!panel) {
      return;
    }
    panel.hidden = !open;
    if (open) {
      syncPicker(picker);
      refreshTakenOptions(picker.ownerDocument);
      panel.classList.remove("wtd-arch-panel-up");
      const trigger = picker.querySelector(
        "[data-wtd-arch-trigger]"
      );
      if (trigger) {
        const rect = trigger.getBoundingClientRect();
        if (shouldOpenUpward(
          rect.top,
          window.innerHeight - rect.bottom,
          panel.offsetHeight
        )) {
          panel.classList.add("wtd-arch-panel-up");
        }
      }
      picker.querySelector("[data-wtd-arch-filter]")?.focus();
    }
  };
  var closeAllPanels = (root, except) => {
    for (const picker of Array.from(
      root.querySelectorAll("[data-wtd-arch-picker]")
    )) {
      if (picker !== except) {
        setPanelOpen(picker, false);
      }
    }
  };
  var applyFilter = (picker, filterText) => {
    const wanted = filterText.trim().toLowerCase();
    for (const label of Array.from(
      picker.querySelectorAll(".wtd-arch-option")
    )) {
      const value = label.querySelector("[data-wtd-arch-check]")?.value ?? "";
      label.style.display = !wanted || value.toLowerCase().includes(wanted) ? "" : "none";
    }
  };
  var removeValue = (picker, value) => {
    for (const box of Array.from(
      picker.querySelectorAll("[data-wtd-arch-check]")
    )) {
      if (box.value === value) {
        box.checked = false;
      }
    }
    syncPicker(picker);
  };
  var started4 = false;
  var initArchPickers = (root) => {
    if (started4) {
      return;
    }
    started4 = true;
    root.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) {
        return;
      }
      const pillRemove = target.closest(
        "[data-wtd-arch-pill-remove]"
      );
      if (pillRemove) {
        const picker = pillRemove.closest("[data-wtd-arch-picker]");
        if (picker) {
          removeValue(picker, pillRemove.dataset.value ?? "");
          refreshTakenOptions(root);
        }
        e.stopPropagation();
        return;
      }
      const trigger = target.closest("[data-wtd-arch-trigger]");
      if (trigger) {
        const picker = trigger.closest("[data-wtd-arch-picker]");
        if (picker) {
          const panel = picker.querySelector(
            "[data-wtd-arch-panel]"
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
            picker.querySelectorAll(
              "[data-wtd-arch-check]"
            )
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
      const target = e.target;
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
      const target = e.target;
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
      const target = e.target;
      if ((e.key === "Enter" || e.key === " ") && target?.matches?.("[data-wtd-arch-trigger]")) {
        e.preventDefault();
        target.click();
      }
    });
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
  var hoveredElement = null;
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
    if (document.querySelector("dialog[open], .modal.show") || typeof imageCompareHelper !== "undefined" && imageCompareHelper.isOpen()) {
      return false;
    }
    if (toggleHoveredModelSelection(hoveredElement)) {
      return true;
    }
    if (typeof imageCompareHelper === "undefined") {
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
    const key = event.key;
    if (key === "Escape") {
      if (document.querySelector(
        "dialog[open], .modal.show, .sui-popover-visible"
      ) || typeof imageCompareHelper !== "undefined" && imageCompareHelper.isOpen()) {
        return;
      }
      clearMark();
      for (const toggle of document.querySelectorAll(
        "button.browser-multiselect-toggle-active"
      )) {
        toggle.click();
      }
      return;
    }
    if (isEditableElement(event.target)) {
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
    hoveredElement = target;
    const block = target?.closest?.(".image-block");
    hovered = closestContainer(block) ? block : null;
  };
  var initBatchCompare = () => {
    if (attached) {
      return;
    }
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("mouseover", handleMouseover, true);
    document.addEventListener(
      "mouseout",
      (event) => {
        hoveredElement = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      },
      true
    );
    attached = true;
  };

  // frontend/compareShortcuts.ts
  var MODAL_ID3 = "image_compare_modal";
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
    const modal = document.getElementById(MODAL_ID3);
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
    if (key !== "a" && key !== "A" && key !== "d" && key !== "D" && key !== "s" && key !== "S" && key !== "x" && key !== "X" && key !== "q" && key !== "Q" && key !== "e" && key !== "E" && key !== "r" && key !== "R") {
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
    if (key === "r" || key === "R") {
      redo.run();
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
  var SERVER_PATH_PLACEHOLDER_FALLBACK = "/path/to/SwarmUI";
  var serverPathPlaceholder = (serverRootPath2) => serverRootPath2?.trim() || SERVER_PATH_PLACEHOLDER_FALLBACK;
  var renderMappingSelect = (className, placeholder, options, value) => {
    const withValue = value && !options.includes(value) ? [...options, value] : options;
    const optionsHtml = withValue.map(
      (opt) => `<option value="${escapeAttr(opt)}"${opt === value ? " selected" : ""}>${escapeHtml(opt)}</option>`
    ).join("");
    return `<select class="auto-dropdown ${className}" autocomplete="off"><option value="">${escapeHtml(placeholder)}</option>${optionsHtml}</select>`;
  };
  var renderArchMappingRow = (mapping, options) => `
            <tr class="whattheduck-arch-row" data-wtd-arch-row>
                <td data-label="Architectures">${renderArchPicker(mapping.architectures, options.architectures)}</td>
                <td data-label="Base folder">
                    <select class="auto-dropdown wtd-arch-base" aria-label="Checkpoint base folder">
                        <option value="Stable-Diffusion"${mapping.baseFolder === "Stable-Diffusion" ? " selected" : ""}>Stable-Diffusion</option>
                        <option value="diffusion_models"${mapping.baseFolder === "diffusion_models" ? " selected" : ""}>diffusion_models</option>
                    </select>
                </td>
                <td data-label="Checkpoint folder">${renderMappingSelect("wtd-arch-checkpoint", "(No checkpoint folder)", options.checkpointFolders, mapping.checkpointFolder)}</td>
                <td data-label="LoRA folder">${renderMappingSelect("wtd-arch-lora", "(No LoRA folder)", options.loraFolders, mapping.loraFolder)}</td>
                <td class="wtd-arch-remove-cell"><button type="button" class="basic-button wtd-arch-remove" title="Remove this mapping">✕</button></td>
            </tr>`;
  var renderArchMappingRows = (mappings2, options) => mappings2.map((m) => renderArchMappingRow(m, options)).join("");
  var getArchRowOptions = () => {
    const map = typeof coreModelMap === "undefined" ? void 0 : coreModelMap;
    return {
      architectures: knownArchitectures,
      checkpointFolders: foldersFromModelList(
        map?.["Stable-Diffusion"] ?? []
      ),
      loraFolders: foldersFromModelList(map?.LoRA ?? [])
    };
  };
  var readArchMappings = (root) => normalizeMappings(
    Array.from(root.querySelectorAll("[data-wtd-arch-row]")).map((row) => ({
      architectures: Array.from(
        row.querySelector(".wtd-arch-select")?.selectedOptions ?? []
      ).map((option) => option.value),
      baseFolder: row.querySelector(".wtd-arch-base")?.value,
      checkpointFolder: row.querySelector(".wtd-arch-checkpoint")?.value ?? "",
      loraFolder: row.querySelector(".wtd-arch-lora")?.value ?? ""
    }))
  );
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

                            <div class="auto-input auto-input-flex">
                                <span class="auto-input-name">
                                    Trim Prompt Variables
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_trim_prompt_variables', arguments[0])">?</span>
                                </span>
                                <label class="auto-checkbox">
                                    <input type="checkbox" id="whattheduck-trim-prompt-variables" ${state.trimPromptVariables ? "checked" : ""}>
                                    <span class="auto-checkbox-label">Enable</span>
                                </label>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_trim_prompt_variables">
                                <b>Trim Prompt Variables</b> (toggle):<br>
                                <span class="slight-left-margin-block">
                                    Removes whitespace from the beginning and end of every value resolved by a prompt <code>&lt;setvar[...]:...&gt;</code> tag. The trimmed value is stored in the current generation's variable data, so both the tag's emitted text and later <code>&lt;var:...&gt;</code> references use it.
                                </span>
                                <br><b>Note:</b> Nested prompt tags are resolved before trimming, and changes apply to new generations immediately.
                            </div>

                        </div>
                    </div>

                    <div class="input-group input-group-open wtd-model-folders">
                        <span class="input-group-header input-group-noshrink">
                            <span class="header-label-wrap">
                                <span class="header-label">📥 Model Auto-Folders</span>
                            </span>
                        </span>
                        <div class="input-group-content">
                            <div class="auto-input auto-input-flex">
                                <span class="auto-input-name">
                                    Folder by Architecture
                                    <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_arch_folders', arguments[0])">?</span>
                                </span>
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_arch_folders">
                                <b>Model Auto-Folders</b> (mapping list):<br>
                                <span class="slight-left-margin-block">
                                    When a model URL lands in the Model Downloader utility (civitai, huggingface, or any direct safetensors/GGUF link), the extension fetches just the remote file's metadata header and identifies the architecture with SwarmUI's own model-class detection. The matched row's folder is then auto-selected in the downloader's Folder dropdown, and the Model Type is set from whether the file is a checkpoint or a LoRA.
                                    <br>• <b>Architectures</b>: one or more SwarmUI architecture IDs (e.g. <code>flux-1</code>, <code>stable-diffusion-xl-v1</code>) - click the control to open a searchable checklist (it stays open while you pick several), or remove one via its pill's ✕. Each architecture can belong to only one row, so IDs already used by another row are not offered. One ID covers both checkpoints and LoRAs of that family.
                                    <br>• <b>Base folder</b>: checkpoint downloads go under <code>Stable-Diffusion</code> (the configured checkpoint location) or <code>diffusion_models</code> in the configured download model root. LoRAs always use their normal LoRA location. GGUF downloads use SwarmUI’s core downloader and ignore this base folder setting.
                                    <br>• <b>Checkpoint folder</b>: folder auto-selected for checkpoint downloads. Leave unset to not auto-select checkpoints.
                                    <br>• <b>LoRA folder</b>: folder auto-selected for LoRA downloads. Leave unset to not auto-select LoRAs.
                                    <br>The folder lists show folders that already contain at least one model. To use a brand-new folder, download one model into it first by typing a path in the downloader's "Save as" box.
                                    <br><b>Note:</b> detection sees the true architecture, so SDXL finetunes that civitai labels separately (Pony, Illustrious, NoobAI, ...) all match the one SDXL row. Gated files need your civitai/huggingface API key set in User Settings.
                                </span>
                            </div>

                            <table class="whattheduck-arch-table" aria-label="Model auto-folder mappings">
                                <colgroup><col class="wtd-arch-column"><col><col><col><col class="wtd-arch-remove-column"></colgroup>
                                <thead><tr>
                                    <th scope="col">Architectures</th>
                                    <th scope="col">Base folder</th>
                                    <th scope="col">Checkpoint folder</th>
                                    <th scope="col">LoRA folder</th>
                                    <th scope="col"><span class="wtd-visually-hidden">Actions</span></th>
                                </tr></thead>
                                <tbody id="whattheduck-arch-mappings">${renderArchMappingRows(state.archFolderMappings, getArchRowOptions())}</tbody>
                            </table>

                            <div class="whattheduck-arch-actions">
                                <button type="button" id="whattheduck-arch-add" class="basic-button">+ Add Mapping</button>
                            </div>
                        </div>
                    </div>

                    <div class="input-group input-group-open">
                        <span class="input-group-header input-group-noshrink">
                            <span class="header-label-wrap">
                                <span class="header-label">🧩 Comfy Workflow Dump</span>
                            </span>
                        </span>
                        <div class="input-group-content">
                            <div class="auto-input auto-input-flex">
                                <label for="whattheduck-clipboard-from">
                                    <span class="auto-input-name">
                                        Server Path Prefix
                                        <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_clipboard_paths', arguments[0])">?</span>
                                    </span>
                                </label>
                                <input class="auto-text" type="text" id="whattheduck-clipboard-from" value="${escapeAttr(state.clipboardPathFrom)}" placeholder="${escapeAttr(serverPathPlaceholder(state.serverRootPath))}" autocomplete="off">
                            </div>
                            <div class="auto-input auto-input-flex">
                                <label for="whattheduck-clipboard-to">
                                    <span class="auto-input-name">
                                        Local Path Prefix
                                        <span class="auto-input-qbutton info-popover-button" onclick="doPopover('whattheduck_clipboard_paths', arguments[0])">?</span>
                                    </span>
                                </label>
                                <input class="auto-text" type="text" id="whattheduck-clipboard-to" value="${escapeAttr(state.clipboardPathTo)}" placeholder="~/swarm-data" autocomplete="off">
                            </div>
                            <div class="sui-popover sui-info-popover" id="popover_whattheduck_clipboard_paths">
                                <b>Server / Local Path Prefix</b> (string pair):<br>
                                <span class="slight-left-margin-block">
                                    Rewrites the file paths that the Comfy Workflow tab's "Import &amp; Save To Server" button copies to your clipboard, for when SwarmUI sees a different filesystem than you do (a container, a network share, a remote box).
                                    <br>• <b>Server Path Prefix</b>: the directory as SwarmUI sees it, e.g. <code>/workspace</code> - the box's placeholder shows SwarmUI's own base path.
                                    <br>• <b>Local Path Prefix</b>: the same directory as your editor sees it, e.g. <code>~/swarm-data</code>.
                                    <br>Files are still <b>saved</b> to the real server path; only the copied text is rewritten. A path outside the prefix, or an empty pair, is copied unchanged.
                                </span>
                                <br>Example: <code>/workspace/Data/WhatTheDuck/...</code> is copied as <code>~/swarm-data/Data/WhatTheDuck/...</code>
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
  var trimPromptVariables = false;
  var archFolderMappings = [];
  var clipboardPathFrom = "";
  var clipboardPathTo = "";
  var serverRootPath = "";
  var knownArchitectures = [];
  var statusTimer = null;
  var readChecked = (id) => document.getElementById(id)?.checked ?? false;
  var readValue = (id) => document.getElementById(id)?.value ?? "";
  var applyArchMappings = (mappings2) => {
    archFolderMappings = mappings2;
    setArchFolderMappings(mappings2);
    const container = document.getElementById("whattheduck-arch-mappings");
    if (container) {
      container.innerHTML = renderArchMappingRows(
        mappings2,
        getArchRowOptions()
      );
    }
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
        trimPromptVariables = data.trimPromptVariables ?? false;
        clipboardPathFrom = data.clipboardPathFrom || "";
        clipboardPathTo = data.clipboardPathTo || "";
        serverRootPath = data.serverRootPath || "";
        document.getElementById(
          "whattheduck-keyboard-nav"
        ).checked = keyboardNavigationEnabled;
        const trimPromptVariablesInput = document.getElementById(
          "whattheduck-trim-prompt-variables"
        );
        if (trimPromptVariablesInput) {
          trimPromptVariablesInput.checked = trimPromptVariables;
        }
        const fromInput = document.getElementById(
          "whattheduck-clipboard-from"
        );
        if (fromInput) {
          fromInput.value = clipboardPathFrom;
          fromInput.placeholder = serverPathPlaceholder(serverRootPath);
        }
        const toInput = document.getElementById(
          "whattheduck-clipboard-to"
        );
        if (toInput) {
          toInput.value = clipboardPathTo;
        }
        knownArchitectures = data.architectures ?? [];
        applyArchMappings(normalizeMappings(data.archFolderMappings));
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
    const nextTrimPromptVariables = readChecked(
      "whattheduck-trim-prompt-variables"
    );
    const nextArchMappings = readArchMappings(document);
    const nextClipboardFrom = readValue("whattheduck-clipboard-from").trim();
    const nextClipboardTo = readValue("whattheduck-clipboard-to").trim();
    genericRequest(
      "WhatTheDuckSaveSettings",
      {
        keyboardNavigationEnabled: keyboardNav,
        trimPromptVariables: nextTrimPromptVariables,
        archFolderMappings: JSON.stringify(nextArchMappings),
        clipboardPathFrom: nextClipboardFrom,
        clipboardPathTo: nextClipboardTo
      },
      (data) => {
        if (data.success) {
          keyboardNavigationEnabled = keyboardNav;
          trimPromptVariables = nextTrimPromptVariables;
          clipboardPathFrom = nextClipboardFrom;
          clipboardPathTo = nextClipboardTo;
          applyArchMappings(nextArchMappings);
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
  var init5 = () => {
    const toolDiv = registerNewTool("whattheduck", "WhatTheDuck Settings");
    toolDiv.innerHTML = renderSettingsForm({
      keyboardNavigationEnabled,
      trimPromptVariables,
      archFolderMappings,
      clipboardPathFrom,
      clipboardPathTo,
      serverRootPath
    });
    loadSettings();
    initArchPickers(document);
    const form = document.getElementById("whattheduck-form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        saveSettings();
      });
    }
    document.getElementById("whattheduck-arch-add")?.addEventListener("click", () => {
      document.getElementById("whattheduck-arch-mappings")?.insertAdjacentHTML(
        "beforeend",
        renderArchMappingRow(
          {
            architectures: [],
            baseFolder: "Stable-Diffusion",
            checkpointFolder: "",
            loraFolder: ""
          },
          getArchRowOptions()
        )
      );
    });
    document.getElementById("whattheduck-arch-mappings")?.addEventListener("click", (e) => {
      const target = e.target;
      if (target?.closest(".wtd-arch-remove")) {
        target.closest("[data-wtd-arch-row]")?.remove();
      }
    });
  };
  var whatTheDuck = {
    init: init5
  };

  // frontend/main.ts
  redo.init();
  document.addEventListener("DOMContentLoaded", () => {
    whatTheDuck.init();
    promptEdit.init();
    archFolders.init();
    comfyWorkflowSave.init();
    modelMultiSelect.init();
  });
})();
//# sourceMappingURL=whattheduck.js.map
