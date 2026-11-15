// The only script on enterworlds.space. Every page reads the same without it.
// - Front page: types `puts`, then writes "Hello, Worlds!" with the pen, stroke
//   by stroke (the timings sit on each path as data-t and data-d, in seconds).
// - Docs: a Copy button on code blocks.
// It loads in <head> without defer, so the words are hidden before the first
// paint when they are about to be written; the rest waits for the page.
const still = matchMedia("(prefers-reduced-motion: reduce)");
if (!still.matches) document.documentElement.classList.add("will-write");
document.addEventListener("DOMContentLoaded", () => {
  const ar = document.documentElement.lang === "ar";

  const hw = document.querySelector(".hw");
  const puts = document.querySelector(".puts");
  const run = document.querySelector(".run");
  if (hw && puts) {
    const word = puts.querySelector(".word");
    const caret = puts.querySelector(".caret");
    const strokes = [...hw.querySelectorAll("path[data-t]")];
    const total = Number(hw.dataset.total || 0);
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    const write = () => {
      timers.forEach(clearTimeout);
      timers = [];
      if (run) run.hidden = true;
      word.textContent = "";
      caret.hidden = false;
      hw.classList.remove("is-writing", "is-done");
      void hw.getBoundingClientRect(); // start the animations from the top again
      const typed = "puts";
      [...typed].forEach((ch, i) => later(260 + i * 110, () => (word.textContent += ch)));
      const lead = 260 + typed.length * 110 + 260;
      for (const p of strokes) {
        p.style.setProperty("--t", `${Number(p.dataset.t) + lead / 1000}s`);
        p.style.setProperty("--d", `${p.dataset.d}s`);
      }
      hw.classList.add("is-writing");
      later(lead + total * 1000 + 80, () => {
        hw.classList.add("is-done");
        caret.hidden = true;
        if (run) run.hidden = false;
      });
    };

    if (still.matches) {
      word.textContent = "puts";
      caret.hidden = true;
    } else {
      word.textContent = "";
      if (run) run.hidden = true;
      // Wait for the page to be on screen before writing.
      requestAnimationFrame(() => requestAnimationFrame(write));
    }
    run?.addEventListener("click", () => {
      if (still.matches) return;
      write();
    });
  }

  for (const pre of document.querySelectorAll("pre")) {
    if (!navigator.clipboard) break;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = ar ? "نسخ" : "Copy";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code")?.innerText ?? pre.innerText);
        b.textContent = ar ? "تم النسخ" : "Copied";
      } catch {
        b.textContent = ar ? "تعذر النسخ" : "Could not copy";
      }
      setTimeout(() => (b.textContent = ar ? "نسخ" : "Copy"), 1600);
    });
    pre.append(b);
  }
});
