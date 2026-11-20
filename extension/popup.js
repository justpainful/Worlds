const status = (text, ok) => {
  const el = document.getElementById("status");
  el.textContent = text;
  el.style.color = ok ? "#3dbb6a" : "#e5534b";
};
const ar = (navigator.language || "").startsWith("ar");
if (ar) {
  document.documentElement.dir = "rtl";
  document.getElementById("page").textContent = "احفظ هذه الصفحة";
  document.getElementById("selection").textContent = "احفظ النص المحدد";
  document.getElementById("article").textContent = "احفظها مقالة للقراءة لاحقًا";
  document.querySelector("#setup summary").textContent = "الربط مع Worlds";
  document.querySelector("#setup .note").textContent = "في Worlds افتح الإعدادات › المحرر › إضافة المتصفح وانسخ الرمز.";
  document.getElementById("token").placeholder = "الصق الرمز";
}
const tokenInput = document.getElementById("token");
worldsToken().then((t) => {
  tokenInput.value = t;
  if (!t) document.getElementById("setup").open = true;
});
tokenInput.addEventListener("change", () => chrome.storage.local.set({ token: tokenInput.value.trim() }));

async function current() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function run(kind) {
  const tab = await current();
  try {
    const item = { kind, title: tab.title, url: tab.url };
    if (kind === "selection") {
      item.text = await selectionIn(tab.id);
      if (!item.text) return status(ar ? "حدد نصًا في الصفحة أولًا" : "Select some text on the page first");
    }
    await sendToWorlds(item);
    status(ar ? "انحفظ في Worlds" : "Saved to Worlds", true);
  } catch (e) {
    status(e.message);
  }
}
document.getElementById("page").onclick = () => run("page");
document.getElementById("selection").onclick = () => run("selection");
document.getElementById("article").onclick = () => run("article");
