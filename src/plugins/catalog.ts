/**
 * Plugins that ship with Worlds, so the gallery is never empty offline.
 * Each is an ordinary plugin (plugins.ts): what works here works for anyone
 * who writes their own.
 */
import type { Plugin } from "./plugins";

const STYLE = `<style>
  body { margin: 0; padding: 14px 16px; font: 15px/1.5 system-ui, sans-serif; }
  button { font: inherit; border: 0; border-radius: 999px; padding: 6px 14px; background: rgba(127,127,127,0.18); color: inherit; cursor: pointer; }
  button.primary { background: #2e92ff; color: #fff; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .big { font-size: 40px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .dim { opacity: 0.6; font-size: 13px; }
  input { font: inherit; padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; }
</style>`;

export const BUILTIN_PLUGINS: Plugin[] = [
  {
    id: "worlds.focus-timer",
    name: "Focus timer",
    nameAr: "مؤقت التركيز",
    description: "25 minutes of work, 5 of rest, with the rounds you finished kept on the page.",
    descriptionAr: "25 دقيقة عمل و5 راحة، والجولات المنجزة تنحفظ في الصفحة.",
    author: "Worlds",
    version: "1.0.0",
    kind: "block",
    icon: "clock",
    height: 150,
    html: `${STYLE}<div class="row"><div class="big" id="t">25:00</div><div><div id="mode" class="dim">Focus</div><div class="dim"><span id="n">0</span> <span id="rounds">rounds today</span></div></div></div>
<div class="row" style="margin-top:10px"><button class="primary" id="go">Start</button><button id="reset">Reset</button></div>
<script>
var ar = worlds.lang === "ar";
if (ar) { document.getElementById("mode").textContent = "تركيز"; document.getElementById("rounds").textContent = "جولة اليوم"; document.getElementById("go").textContent = "ابدأ"; document.getElementById("reset").textContent = "إعادة"; }
var s = { rounds: 0, day: "" }, left = 1500, focus = true, timer = null;
var today = new Date().toDateString();
worlds.onState(function (v) { if (v && v.day === today) s = v; document.getElementById("n").textContent = s.rounds; });
function show() { var m = Math.floor(left / 60), x = left % 60; document.getElementById("t").textContent = (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x; }
function tick() { left--; if (left <= 0) { if (focus) { s.rounds++; s.day = today; worlds.save(s); document.getElementById("n").textContent = s.rounds; } focus = !focus; left = focus ? 1500 : 300; document.getElementById("mode").textContent = focus ? (ar ? "تركيز" : "Focus") : (ar ? "راحة" : "Break"); } show(); }
document.getElementById("go").onclick = function () { if (timer) { clearInterval(timer); timer = null; this.textContent = ar ? "تابع" : "Resume"; } else { timer = setInterval(tick, 1000); this.textContent = ar ? "إيقاف" : "Pause"; } };
document.getElementById("reset").onclick = function () { clearInterval(timer); timer = null; focus = true; left = 1500; show(); document.getElementById("go").textContent = ar ? "ابدأ" : "Start"; };
show();
</script>`,
  },
  {
    id: "worlds.habit-tracker",
    name: "Habit tracker",
    nameAr: "متتبع العادات",
    description: "Tick a habit each day; the last two weeks stay on the page.",
    descriptionAr: "علّم على عادتك كل يوم، وآخر أسبوعين يبقون في الصفحة.",
    author: "Worlds",
    version: "1.0.0",
    kind: "block",
    icon: "checklist",
    height: 170,
    html: `${STYLE}<div class="row"><input id="name" placeholder="Read 20 pages"><span class="dim" id="streak"></span></div>
<div class="row" id="days" style="margin-top:12px;gap:4px"></div>
<script>
var ar = worlds.lang === "ar"; if (ar) document.getElementById("name").placeholder = "اقرأ 20 صفحة";
var s = { name: "", done: {} };
function key(d) { return d.toISOString().slice(0, 10); }
function draw() {
  document.getElementById("name").value = s.name || "";
  var box = document.getElementById("days"); box.innerHTML = "";
  for (var i = 13; i >= 0; i--) { (function (i) { var d = new Date(); d.setDate(d.getDate() - i); var k = key(d); var b = document.createElement("button");
    b.textContent = d.getDate(); b.title = k; b.style.width = "34px"; b.style.padding = "6px 0";
    if (s.done[k]) { b.className = "primary"; }
    b.onclick = function () { s.done[k] = !s.done[k]; worlds.save(s); draw(); }; box.appendChild(b); })(i); }
  var n = 0, d = new Date(); while (s.done[key(d)]) { n++; d.setDate(d.getDate() - 1); }
  document.getElementById("streak").textContent = n ? (ar ? n + " أيام متتالية" : n + " days in a row") : "";
}
document.getElementById("name").onchange = function () { s.name = this.value; worlds.save(s); };
worlds.onState(function (v) { if (v) s = v; draw(); });
draw();
</script>`,
  },
  {
    id: "worlds.countdown",
    name: "Countdown",
    nameAr: "عدّاد تنازلي",
    description: "Days, hours and minutes until a date you choose.",
    descriptionAr: "الأيام والساعات والدقائق الباقية لتاريخ تختاره.",
    author: "Worlds",
    version: "1.0.0",
    kind: "block",
    icon: "calendar",
    height: 140,
    html: `${STYLE}<div class="row"><input type="datetime-local" id="when"><input id="what" placeholder="Exam"></div><div class="big" id="left" style="margin-top:10px"></div>
<script>
var ar = worlds.lang === "ar"; if (ar) document.getElementById("what").placeholder = "الاختبار";
var s = { when: "", what: "" };
function draw() { document.getElementById("when").value = s.when; document.getElementById("what").value = s.what;
  if (!s.when) { document.getElementById("left").textContent = ""; return; }
  var ms = new Date(s.when) - new Date(); if (ms < 0) { document.getElementById("left").textContent = ar ? "حان الوقت" : "It is time"; return; }
  var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  document.getElementById("left").textContent = (s.what ? s.what + ": " : "") + d + (ar ? " يوم " : "d ") + h + (ar ? " ساعة " : "h ") + m + (ar ? " دقيقة" : "m"); }
document.getElementById("when").onchange = function () { s.when = this.value; worlds.save(s); draw(); };
document.getElementById("what").onchange = function () { s.what = this.value; worlds.save(s); draw(); };
worlds.onState(function (v) { if (v) s = v; draw(); }); setInterval(draw, 30000); draw();
</script>`,
  },
  {
    id: "worlds.random-picker",
    name: "Random picker",
    nameAr: "اختيار عشوائي",
    description: "Write a list, then let Worlds pick one for you.",
    descriptionAr: "اكتب قائمة وخل Worlds يختار لك واحد منها.",
    author: "Worlds",
    version: "1.0.0",
    kind: "block",
    icon: "shapes",
    height: 190,
    html: `${STYLE}<textarea id="list" rows="4" style="width:100%;box-sizing:border-box;font:inherit;border-radius:10px;padding:8px;background:transparent;color:inherit;border:1px solid rgba(127,127,127,0.35)"></textarea>
<div class="row" style="margin-top:8px"><button class="primary" id="pick">Pick</button><span class="big" id="out" style="font-size:24px"></span></div>
<script>
var ar = worlds.lang === "ar"; if (ar) document.getElementById("pick").textContent = "اختر";
var s = { list: "" };
document.getElementById("list").oninput = function () { s.list = this.value; worlds.save(s); };
document.getElementById("pick").onclick = function () { var items = s.list.split(/\\n+/).map(function (x) { return x.trim(); }).filter(Boolean); if (items.length) document.getElementById("out").textContent = items[Math.floor(Math.random() * items.length)]; };
worlds.onState(function (v) { if (v) { s = v; document.getElementById("list").value = s.list; } });
</script>`,
  },
  {
    id: "worlds.theme.ocean",
    name: "Ocean",
    nameAr: "المحيط",
    description: "Deep blue surfaces and a teal accent.",
    descriptionAr: "أسطح زرقاء عميقة ولون تركوازي.",
    author: "Worlds",
    version: "1.0.0",
    kind: "theme",
    icon: "palette",
    dark: { "--canvas": "#06121c", "--surface-deep": "#0c1b28", "--surface-raised": "#112332", "--surface-sidebar": "#081520", "--accent": "#2ec4c4", "--accent-rgb": "46, 196, 196" },
    light: { "--canvas": "#eaf4f7", "--surface-sidebar": "#e0eef2", "--accent": "#0f8f9a", "--accent-rgb": "15, 143, 154" },
  },
  {
    id: "worlds.theme.rose",
    name: "Rose",
    nameAr: "الورد",
    description: "Warm rose accent on soft surfaces.",
    descriptionAr: "لون وردي دافئ على أسطح هادئة.",
    author: "Worlds",
    version: "1.0.0",
    kind: "theme",
    icon: "palette",
    dark: { "--canvas": "#140c10", "--surface-deep": "#1f151a", "--surface-raised": "#271b21", "--surface-sidebar": "#170f13", "--accent": "#f07ea6", "--accent-rgb": "240, 126, 166" },
    light: { "--canvas": "#f8f1f3", "--surface-sidebar": "#f3e7eb", "--accent": "#c94a78", "--accent-rgb": "201, 74, 120" },
  },
  {
    id: "worlds.theme.forest",
    name: "Forest",
    nameAr: "الغابة",
    description: "Calm greens for long writing sessions.",
    descriptionAr: "أخضر هادئ لجلسات الكتابة الطويلة.",
    author: "Worlds",
    version: "1.0.0",
    kind: "theme",
    icon: "palette",
    dark: { "--canvas": "#08110c", "--surface-deep": "#101b14", "--surface-raised": "#16231b", "--surface-sidebar": "#0b1510", "--accent": "#5fcf8a", "--accent-rgb": "95, 207, 138" },
    light: { "--canvas": "#eef5f0", "--surface-sidebar": "#e4efe7", "--accent": "#23854a", "--accent-rgb": "35, 133, 74" },
  },
  {
    id: "worlds.theme.sand",
    name: "Sand",
    nameAr: "الرمل",
    description: "Paper-like warm light theme with a copper accent.",
    descriptionAr: "ثيم فاتح دافئ يشبه الورق بلون نحاسي.",
    author: "Worlds",
    version: "1.0.0",
    kind: "theme",
    icon: "palette",
    dark: { "--canvas": "#14110c", "--surface-deep": "#1e1a14", "--surface-raised": "#26211a", "--accent": "#d9965f", "--accent-rgb": "217, 150, 95" },
    light: { "--canvas": "#f5efe4", "--surface-deep": "#fffaf1", "--surface-raised": "#fffaf1", "--surface-sidebar": "#efe6d6", "--accent": "#b0662f", "--accent-rgb": "176, 102, 47" },
  },
  {
    id: "worlds.template.meeting",
    name: "Meeting notes",
    nameAr: "ملاحظات اجتماع",
    description: "Agenda, notes, decisions and action items.",
    descriptionAr: "الأجندة والملاحظات والقرارات والمهام.",
    author: "Worlds",
    version: "1.0.0",
    kind: "template",
    icon: "users",
    markdown: "## Agenda\n- \n\n## Notes\n\n## Decisions\n- \n\n## Action items\n- [ ] \n",
  },
  {
    id: "worlds.template.weekly-review",
    name: "Weekly review",
    nameAr: "مراجعة أسبوعية",
    description: "What went well, what to change, and the plan for next week.",
    descriptionAr: "وش مشى زين، ووش تغيّر، وخطة الأسبوع الجاي.",
    author: "Worlds",
    version: "1.0.0",
    kind: "template",
    icon: "calendar",
    markdown: "## What went well\n- \n\n## What to change\n- \n\n## Next week\n- [ ] \n- [ ] \n- [ ] \n",
  },
  {
    id: "worlds.template.book-notes",
    name: "Book notes",
    nameAr: "ملاحظات كتاب",
    description: "Summary, favourite quotes and what to apply.",
    descriptionAr: "ملخص، واقتباسات مفضّلة، ووش تطبّق منه.",
    author: "Worlds",
    version: "1.0.0",
    kind: "template",
    icon: "book",
    markdown: "## Summary\n\n## Quotes\n> \n\n## Ideas to apply\n- [ ] \n",
  },
];
