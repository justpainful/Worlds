importScripts("common.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "worlds-selection", title: "Save selection to Worlds", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "worlds-page", title: "Save page to Worlds", contexts: ["page"] });
  chrome.contextMenus.create({ id: "worlds-article", title: "Save as an article to read later", contexts: ["page", "link"] });
  chrome.contextMenus.create({ id: "worlds-link", title: "Save link to Worlds", contexts: ["link"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const base = { title: tab && tab.title, url: info.linkUrl || (tab && tab.url) };
  const item =
    info.menuItemId === "worlds-selection" ? { ...base, kind: "selection", text: info.selectionText } :
    info.menuItemId === "worlds-article" ? { ...base, kind: "article", url: info.linkUrl || (tab && tab.url) } :
    info.menuItemId === "worlds-link" ? { kind: "link", title: info.linkUrl, url: info.linkUrl } :
    { ...base, kind: "page" };
  try {
    await sendToWorlds(item);
    chrome.action.setBadgeText({ text: "✓", tabId: tab && tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab && tab.id }), 1500);
  } catch (e) {
    chrome.action.setBadgeText({ text: "!", tabId: tab && tab.id });
  }
});
