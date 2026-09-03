const sourceLanguage = document.getElementById("sourceLanguage");
const targetLanguage = document.getElementById("targetLanguage");

const DEFAULTS = {
  sourceLanguage: "auto",
  targetLanguage: "en",
};

chrome.storage.sync.get(DEFAULTS, (stored) => {
  sourceLanguage.value = stored.sourceLanguage || DEFAULTS.sourceLanguage;
  targetLanguage.value = stored.targetLanguage || DEFAULTS.targetLanguage;
});

sourceLanguage.addEventListener("change", save);
targetLanguage.addEventListener("change", save);
document.getElementById("openDemo").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("demo.html") });
});

function save() {
  chrome.storage.sync.set({
    sourceLanguage: sourceLanguage.value,
    targetLanguage: targetLanguage.value,
  });
}
