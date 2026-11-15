/* Worlds runtime for HTML pages (docs/HTML_PAGES.md). Runs first in the
   sandboxed frame. It talks to Worlds only through postMessage: the page's
   height, links the person clicks, and the state the page saves. Worlds
   checks that each message comes from this frame. */
(function () {
  var boot = window.__worldsBoot || {};
  delete window.__worldsBoot;
  var post = function (message) {
    message.worldsHtmlPage = 1;
    try { parent.postMessage(message, "*"); } catch (e) { /* not embedded */ }
  };
  var state = boot.state === undefined ? null : boot.state;
  window.worlds = Object.freeze({
    get state() { return state; },
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
})();
