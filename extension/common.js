// Shared by the popup and the background worker: send something to Worlds
// running on this computer (127.0.0.1 only), with the token from Settings.
const WORLDS = "http://127.0.0.1:47321";

async function worldsToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || "";
}

async function sendToWorlds(item) {
  const token = await worldsToken();
  if (!token) throw new Error("Paste the token from Worlds › Settings › Editor first.");
  const res = await fetch(`${WORLDS}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worlds-token": token },
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Worlds answered ${res.status}`);
  }
}

async function selectionIn(tabId) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(window.getSelection() || "") });
  return (result && result.result) || "";
}
