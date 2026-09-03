const DEFAULTS = {
  sourceLanguage: "auto",
  targetLanguage: "en",
};

const MAX_CHUNK = 4200;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "translate-replace",
      title: "Translate & replace in field",
      contexts: ["editable", "selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || info.menuItemId !== "translate-replace") return;
  chrome.tabs.sendMessage(
    tab.id,
    { type: "TRANSLATE_SELECTION" },
    { frameId: info.frameId },
    () => void chrome.runtime.lastError,
  );
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION" }, () => void chrome.runtime.lastError);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message?.type === "TRANSLATE_TEXT") {
    translateText(message.text, message.sourceLanguage, message.targetLanguage)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || "Translation failed" });
      });
    return true;
  }

  return false;
});

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "No text selected" };
  }

  const source = sourceLanguage || "auto";
  const target = targetLanguage || "en";
  const chunks = splitChunks(trimmed);

  try {
    const parts = [];
    for (const chunk of chunks) {
      parts.push(await translateGoogle(chunk, source, target));
    }
    return { ok: true, translated: parts.join(""), engine: "google" };
  } catch (googleError) {
    try {
      const parts = [];
      for (const chunk of chunks) {
        parts.push(await translateMyMemory(chunk, source, target));
      }
      return { ok: true, translated: parts.join(""), engine: "mymemory" };
    } catch {
      return {
        ok: false,
        error: googleError.message || "Translation failed",
      };
    }
  }
}

function splitChunks(text) {
  if (text.length <= MAX_CHUNK) return [text];

  const chunks = [];
  const blocks = text.split(/(\n\n+)/);

  let current = "";
  for (const block of blocks) {
    if ((current + block).length > MAX_CHUNK && current) {
      chunks.push(current);
      current = "";
    }
    if (block.length > MAX_CHUNK) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitByLength(block, MAX_CHUNK));
    } else {
      current += block;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
}

function splitByLength(text, size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

async function translateGoogle(text, source, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source === "auto" ? "auto" : source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url.toString());
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Google Translate HTTP ${response.status}`);
  }
  if (raw.trimStart().startsWith("<")) {
    throw new Error("Google Translate blocked this request");
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Google Translate returned an unexpected response");
  }

  const translated = Array.isArray(data?.[0])
    ? data[0].map((part) => part?.[0] || "").join("")
    : "";

  if (!translated) {
    throw new Error("Empty translation");
  }
  return translated;
}

async function translateMyMemory(text, source, target) {
  const langpair = `${source === "auto" ? "autodetect" : source}|${target}`;
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", langpair);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`MyMemory HTTP ${response.status}`);
  }

  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) {
    throw new Error("Empty translation");
  }
  return translated;
}
