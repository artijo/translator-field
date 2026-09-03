(() => {
  if (window.__fieldTranslatorLoaded) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
  window.__fieldTranslatorLoaded = true;

  const HOST_ID = "field-translator-host";
  const LANG_LABELS = {
    en: "EN",
    th: "TH",
    ja: "JA",
    ko: "KO",
    "zh-CN": "ZH",
    "zh-TW": "ZH",
    vi: "VI",
    lo: "LO",
    my: "MY",
    km: "KM",
    id: "ID",
    ms: "MS",
    fr: "FR",
    de: "DE",
    es: "ES",
    pt: "PT",
    ru: "RU",
    ar: "AR",
    hi: "HI",
  };

  let settings = {
    sourceLanguage: "auto",
    targetLanguage: "en",
  };
  let saved = null;
  let undoState = null;
  let hideTimer = 0;
  let translating = false;

  const ui = createUi();

  chrome.storage.sync.get(settings, (stored) => {
    settings = { ...settings, ...stored };
    updateButtonLabel();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, value] of Object.entries(changes)) {
      settings[key] = value.newValue;
    }
    updateButtonLabel();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TRANSLATE_SELECTION") {
      void translateSavedOrCurrent();
    }
  });

  document.addEventListener("mouseup", onPointerUp, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", hideSoon, true);
  window.addEventListener("resize", hideSoon);

  document.addEventListener("keydown", (event) => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
      const capture = captureSelection();
      if (!capture) return;
      event.preventDefault();
      saved = capture;
      void translateSavedOrCurrent();
    }
  }, true);

  function createUi() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-field-translator", "true");
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .wrap {
        font-family: "Segoe UI", system-ui, sans-serif;
        display: flex;
        gap: 6px;
        pointer-events: auto;
      }
      button {
        appearance: none;
        border: 0;
        cursor: pointer;
        height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.01em;
        color: #fff;
        background: #1a73e8;
        box-shadow: 0 6px 20px rgba(16, 42, 86, 0.28);
        display: inline-flex;
        align-items: center;
        gap: 7px;
        white-space: nowrap;
      }
      button:hover { background: #155fc0; }
      button:disabled { opacity: 0.8; cursor: wait; }
      button.error { background: #c5221f; }
      button.undo { background: #0f9d58; }
      .flag {
        font-size: 13px;
        line-height: 1;
      }
      .spin {
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255,255,255,0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (undoState && button.classList.contains("undo")) {
        applyUndo();
        return;
      }
      void translateSavedOrCurrent();
    });

    wrap.appendChild(button);
    shadow.append(style, wrap);

    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "z-index: 2147483647",
      "top: 0",
      "left: 0",
      "display: none",
      "pointer-events: none",
    ].join(";");

    return { host, button };
  }

  function ensureHost() {
    if (!ui.host.isConnected) {
      (document.documentElement || document.body)?.appendChild(ui.host);
    }
  }

  function updateButtonLabel(mode) {
    const lang = LANG_LABELS[settings.targetLanguage] || settings.targetLanguage.toUpperCase();
    if (mode === "loading") {
      ui.button.disabled = true;
      ui.button.className = "";
      ui.button.innerHTML = `<span class="spin"></span> Translating…`;
      return;
    }
    if (mode === "error") {
      ui.button.disabled = false;
      ui.button.className = "error";
      ui.button.textContent = "Translation failed";
      return;
    }
    if (mode === "undo") {
      ui.button.disabled = false;
      ui.button.className = "undo";
      ui.button.innerHTML = `<span class="flag">↩</span> Undo`;
      return;
    }
    ui.button.disabled = false;
    ui.button.className = "";
    ui.button.innerHTML = `<span class="flag">🇬🇧</span> Translate to ${lang}`;
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (event.target === ui.host || ui.host.contains(event.target)) return;
    window.setTimeout(() => maybeShow(event.clientX, event.clientY), 10);
  }

  function onKeyUp(event) {
    if (event.key === "Shift" || event.key.startsWith("Arrow") || event.key === "a" && event.ctrlKey) {
      maybeShow();
    }
  }

  function onSelectionChange() {
    if (translating) return;
    const capture = captureSelection();
    if (!capture) hideSoon();
  }

  function maybeShow(x, y) {
    const capture = captureSelection();
    if (!capture) {
      hideSoon();
      return;
    }
    saved = capture;
    undoState = null;
    showButton(x, y, capture);
  }

  function hideSoon() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideButton, 150);
  }

  function hideButton() {
    if (translating) return;
    ui.host.style.display = "none";
  }

  function showButton(x, y, capture) {
    window.clearTimeout(hideTimer);
    ensureHost();
    updateButtonLabel();

    let left = typeof x === "number" ? x + 8 : 0;
    let top = typeof y === "number" ? y + 12 : 0;

    if (typeof x !== "number" || typeof y !== "number") {
      const rect = getSelectionRect(capture);
      if (rect) {
        left = rect.left;
        top = rect.bottom + 8;
      }
    }

    const maxLeft = window.innerWidth - 180;
    const maxTop = window.innerHeight - 48;
    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, Math.min(top, maxTop));

    ui.host.style.left = `${left}px`;
    ui.host.style.top = `${top}px`;
    ui.host.style.display = "block";
  }

  function getSelectionRect(capture) {
    if (capture.type === "field") {
      return capture.el.getBoundingClientRect();
    }
    const selection = capture.el.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    return selection.getRangeAt(0).getBoundingClientRect();
  }

  function deepActiveElement(doc = document) {
    let el = doc.activeElement;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    if (el?.tagName === "IFRAME") {
      try {
        const inner = el.contentDocument;
        if (inner) return deepActiveElement(inner);
      } catch {
        return el;
      }
    }
    return el;
  }

  function isTextField(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    if (type === "password" || type === "hidden" || type === "file") return false;
    return ["text", "search", "email", "url", "tel", ""].includes(type);
  }

  function closestContentEditable(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return el?.closest?.("[contenteditable=''], [contenteditable='true'], [role='textbox']") || null;
  }

  function captureSelection() {
    const active = deepActiveElement();
    if (isTextField(active)) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number" || start === end) return null;
      const text = active.value.slice(start, end);
      if (!text.trim()) return null;
      return { type: "field", el: active, start, end, text };
    }

    const editable = active?.isContentEditable ? active : closestContentEditable(active);
    const selection = (editable?.ownerDocument || document).getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const anchorEditable = closestContentEditable(selection.anchorNode);
    if (!anchorEditable || !anchorEditable.isContentEditable) return null;

    const text = selection.toString();
    if (!text.trim()) return null;

    return {
      type: "contenteditable",
      el: anchorEditable,
      range: selection.getRangeAt(0).cloneRange(),
      text,
    };
  }

  async function translateSavedOrCurrent() {
    const capture = saved?.text ? saved : captureSelection();
    if (!capture) return;
    await runTranslate(capture);
  }

  async function runTranslate(capture) {
    if (translating) return;
    translating = true;
    ensureHost();
    updateButtonLabel("loading");
    ui.host.style.display = "block";

    try {
      const translated = await translateText(capture.text);
      if (translated == null || translated === "") throw new Error("Empty translation");

      restoreAndReplace(capture, translated);
      undoState = { capture, original: capture.text, translated };
      updateButtonLabel("undo");
      window.setTimeout(() => {
        if (ui.button.classList.contains("undo")) {
          hideButton();
          updateButtonLabel();
          undoState = null;
        }
      }, 8000);
    } catch (error) {
      console.warn("Field Translator:", error);
      updateButtonLabel("error");
      window.setTimeout(() => {
        updateButtonLabel();
        hideButton();
      }, 1800);
    } finally {
      translating = false;
    }
  }

  async function translateText(text) {
    const sourceLanguage = settings.sourceLanguage;
    const targetLanguage = settings.targetLanguage;
    const leading = text.match(/^\s*/)[0];
    const trailing = text.match(/\s*$/)[0];
    const core = text.slice(leading.length, text.length - trailing.length);

    const localReady = await translateOnDevice(core, sourceLanguage, targetLanguage, false);
    if (localReady != null) return leading + localReady + trailing;

    try {
      const result = await chrome.runtime.sendMessage({
        type: "TRANSLATE_TEXT",
        text: core,
        sourceLanguage,
        targetLanguage,
      });
      if (result?.ok && result.translated) return leading + result.translated + trailing;
      throw new Error(result?.error || "Translation failed");
    } catch (networkError) {
      const downloaded = await translateOnDevice(core, sourceLanguage, targetLanguage, true, (pct) => {
        ui.button.innerHTML = `<span class="spin"></span> Downloading ${pct}%`;
      });
      if (downloaded != null) return leading + downloaded + trailing;
      throw networkError;
    }
  }

  function toChromeLanguage(code) {
    if (code === "zh-CN") return "zh-Hans";
    if (code === "zh-TW") return "zh-Hant";
    return code;
  }

  async function translateOnDevice(text, sourceLanguage, targetLanguage, allowDownload, onProgress) {
    if (!("Translator" in globalThis)) return null;

    try {
      let source = sourceLanguage;
      if (source === "auto") {
        source = await detectLanguage(text, allowDownload);
        if (!source) return null;
      }

      source = toChromeLanguage(source);
      const target = toChromeLanguage(targetLanguage);
      if (source === target) return null;

      const availability = await Translator.availability({
        sourceLanguage: source,
        targetLanguage: target,
      });
      if (availability === "unavailable") return null;
      if (availability !== "available" && !allowDownload) return null;

      const translator = await Translator.create({
        sourceLanguage: source,
        targetLanguage: target,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            onProgress?.(Math.round((event.loaded || 0) * 100));
          });
        },
      });
      return await translator.translate(text);
    } catch (error) {
      console.warn("Field Translator on-device:", error);
      return null;
    }
  }

  async function detectLanguage(text, allowDownload) {
    if (!("LanguageDetector" in globalThis)) return null;
    try {
      const availability = await LanguageDetector.availability();
      if (availability === "unavailable") return null;
      if (availability !== "available" && !allowDownload) return null;
      const detector = await LanguageDetector.create();
      const results = await detector.detect(text);
      const best = results?.[0];
      if (!best || best.detectedLanguage === "und") return null;
      return best.detectedLanguage;
    } catch {
      return null;
    }
  }

  function restoreAndReplace(capture, translated) {
    if (capture.type === "field") {
      replaceInField(capture.el, capture.start, capture.end, translated);
      return;
    }
    replaceInContentEditable(capture.el, capture.range, translated);
  }

  function replaceInField(el, start, end, translated) {
    el.focus();
    try {
      el.setSelectionRange(start, end);
    } catch {
      // Some inputs do not support setSelectionRange.
    }

    const inserted = document.execCommand("insertText", false, translated);
    if (inserted && el.value.slice(start, start + translated.length) === translated) {
      fireInput(el);
      return;
    }

    const previous = el.value;
    const next = previous.slice(0, start) + translated + previous.slice(end);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(el, next);
    } else {
      el.value = next;
    }
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(previous);

    try {
      el.setSelectionRange(start, start + translated.length);
    } catch {
      // ignore
    }
    fireInput(el);
  }

  function replaceInContentEditable(el, range, translated) {
    el.focus();
    const selection = el.ownerDocument.getSelection();
    if (selection && range) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const inserted = document.execCommand("insertText", false, translated);
    if (inserted) {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: translated }));
      return;
    }
    if (range) {
      range.deleteContents();
      range.insertNode(el.ownerDocument.createTextNode(translated));
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: translated }));
  }

  function applyUndo() {
    if (!undoState) return;
    const { capture, original, translated } = undoState;
    if (capture.type === "field") {
      const start = capture.start;
      const end = start + translated.length;
      replaceInField(capture.el, start, end, original);
    } else {
      const current = captureSelection();
      if (current?.type === "contenteditable") {
        replaceInContentEditable(current.el, current.range, original);
      } else if (capture.range) {
        replaceInContentEditable(capture.el, capture.range, original);
      }
    }
    undoState = null;
    updateButtonLabel();
    hideButton();
  }

  function fireInput(el) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
})();
