// The only script on enterworlds.space: today's date in both calendars, the
// greeting for the hour, and which page of the tree is open. The page reads
// the same without it.
(() => {
  const ar = document.documentElement.lang === "ar";
  const now = new Date();

  const date = document.querySelector("[data-date]");
  if (date) {
    const day = new Intl.DateTimeFormat(ar ? "ar-u-ca-gregory-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now);
    const hijri = new Intl.DateTimeFormat(ar ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-u-ca-islamic-umalqura", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
    date.textContent = `${day} · ${hijri}`;
    date.setAttribute("datetime", now.toISOString().slice(0, 10));
  }

  const greet = document.querySelector("[data-greet]");
  if (greet) {
    const h = now.getHours();
    greet.textContent = ar ? (h >= 4 && h < 12 ? "صباح الخير" : "مساء الخير") : h >= 4 && h < 12 ? "Good morning" : h < 18 && h >= 12 ? "Good afternoon" : "Good evening";
  }

  // Mark the page of the tree that is on screen, as Worlds marks the open page.
  const links = new Map([...document.querySelectorAll(".tree a[href^='#']")].map((a) => [a.getAttribute("href").slice(1), a]));
  if (!("IntersectionObserver" in window) || !links.size) return;
  let current = null;
  const mark = (id) => {
    if (id === current) return;
    current = id;
    for (const [key, a] of links) a.toggleAttribute("aria-current", key === id);
    const a = links.get(id);
    if (a) {
      a.setAttribute("aria-current", "true");
      // On a phone the tree is a row: keep the open page in view.
      if (matchMedia("(max-width: 760px)").matches) a.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };
  const seen = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
      const first = [...links.keys()].find((id) => seen.has(id));
      if (first) mark(first);
    },
    { rootMargin: "-20% 0px -55% 0px" },
  );
  for (const id of links.keys()) {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  }
})();
