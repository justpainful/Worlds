/* Worlds runtime for HTML pages (docs/HTML_PAGES.md). Runs first in the
   sandboxed frame. It talks to Worlds only through postMessage: the page's
   height, links the person clicks, and the state the page saves. Worlds
   checks that each message comes from this frame. */
(function () {
  var boot = window.__worldsBoot || {};
  delete window.__worldsBoot;
  // Follow the Worlds theme: from the boot data in the browser, from the address on the desktop.
  if (boot.theme === "light" || /[?&]theme=light(&|$)/.test(location.search)) document.documentElement.setAttribute("data-theme", "light");
  var post = function (message) {
    message.worldsHtmlPage = 1;
    try { parent.postMessage(message, "*"); } catch (e) { /* not embedded */ }
  };
  var state = boot.state === undefined ? null : boot.state;
  // A page used as Home also receives a snapshot of the workspace (titles,
  // pinned and recent pages, today's tasks) and can open or create pages.
  var data = null;
  var listeners = [];
  var stateListeners = [];
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (event.source !== parent || !m) return;
    // A plugin block gets its saved state after it loads.
    if (m.worldsState === 1) {
      state = m.state === undefined ? null : m.state;
      stateListeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
      return;
    }
    if (m.worldsHome !== 1) return;
    data = m.data;
    listeners.forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  });
  window.worlds = Object.freeze({
    get state() { return state; },
    get data() { return data; },
    onData: function (fn) { if (typeof fn === "function") { listeners.push(fn); if (data) fn(data); } },
    onState: function (fn) { if (typeof fn === "function") { stateListeners.push(fn); if (state !== null) fn(state); } },
    openPage: function (id) { post({ type: "openPage", id: String(id) }); },
    newPage: function (title) { post({ type: "newPage", title: String(title || "") }); },
    lang: boot.lang === "ar" ? "ar" : "en",
    save: function (value) {
      var text = JSON.stringify(value === undefined ? null : value);
      if (text.length > 256 * 1024) throw new Error("worlds.save: the state is larger than 256 KB");
      state = JSON.parse(text);
      post({ type: "save", state: text });
    },
  });

  var lastHeight = 0;
  var report = function () {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(h - lastHeight) > 1) { lastHeight = h; post({ type: "height", height: h }); }
  };
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(report).observe(document.documentElement);
  }
  window.addEventListener("load", report);
  document.addEventListener("DOMContentLoaded", report);

  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) === "#") return;
    event.preventDefault();
    var page = /^worlds:\/\/page\/([A-Za-z0-9_-]+)$/.exec(href);
    if (page) post({ type: "openPage", id: page[1] });
    else if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) post({ type: "openLink", url: href });
  }, true);
  post({ type: "ready" });
})();
