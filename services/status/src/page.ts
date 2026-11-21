/** The status page, drawn on the server in Arabic (/) or English (/en/). No scripts: it reloads itself every minute. */
import { type Bar, DAY_OFFSET_S, type Incident, SERVICES, type Service, SLOW_MS, type State } from "./checks";

export type Lang = "ar" | "en";

export interface ServiceView {
  svc: Service;
  state: State;
  ms: number | null;
  uptime: number | null;
  bars: Bar[];
}

export interface PageData {
  overall: State;
  lastAt: number | null;
  services: ServiceView[];
  incidents: Incident[];
}

const arCount = (n: number, [one, two, few, many]: [string, string, string, string]) =>
  n === 1 ? one : n === 2 ? two : `${n} ${n <= 10 ? few : many}`;

const T = {
  ar: {
    dir: "rtl", other: "en" as Lang, otherName: "English", name: "الحالة",
    title: "حالة خدمات Worlds",
    nav: [["الموقع", "https://enterworlds.space/"], ["سجل التحديثات", "https://changelog.enterworlds.space/"], ["GitHub", "https://github.com/justpainful/Worlds"]],
    state: { up: "تعمل", slow: "بطيئة", degraded: "متقطعة", down: "متوقفة", unknown: "لا توجد بيانات" } as Record<State, string>,
    overall: {
      up: "جميع خدمات Worlds تعمل",
      slow: "بعض خدمات Worlds بطيئة",
      degraded: "بعض خدمات Worlds متقطعة",
      down: "خدمة واحدة أو أكثر متوقفة",
      unknown: "بدأت المراقبة، وتظهر النتائج بعد أول فحص",
    } as Record<State, string>,
    groups: { app: "التطبيق والحسابات", sites: "المواقع والتنزيلات" },
    last: (t: string) => `آخر فحص الساعة ${t} بتوقيت الرياض`,
    uptime: (p: string) => `${p} نسبة التشغيل`,
    noUptime: "لا توجد بيانات بعد",
    ago: "قبل 90 يومًا", today: "اليوم",
    ms: (n: number) => `${n} م.ث`,
    incidents: "الانقطاعات في آخر 90 يومًا",
    none: "لم يُسجَّل أي انقطاع في آخر 90 يومًا.",
    ongoing: (s: string, t: string) => `${s}: متوقفة منذ ${t}، ولا يزال الانقطاع مستمرًا.`,
    past: (s: string, t: string, d: string) => `${s}: انقطعت في ${t} لمدة ${d}.`,
    minutes: (n: number) => arCount(n, ["دقيقة واحدة", "دقيقتين", "دقائق", "دقيقة"]),
    hours: (n: number) => arCount(n, ["ساعة واحدة", "ساعتين", "ساعات", "ساعة"]),
    and: " و",
    bar: (date: string, b: Bar) => (b.n ? `${date}: ${pct(b.up / b.n)} من الفحوص ناجحة` : `${date}: لا توجد بيانات`),
    how: `تُفحص كل خدمة كل 5 دقائق من شبكة Cloudflare. تُعدّ الخدمة متقطعة بعد فحص فاشل واحد، ومتوقفة بعد فحصين فاشلين متتاليين، وبطيئة إذا تجاوز ردها ${SLOW_MS / 1000} ثانية. تُحسب الأيام بتوقيت الرياض، ولا يشمل الفحص البريد الوارد إلى Worlds.`,
    api: "البيانات نفسها بصيغة JSON",
    fine: "Worlds اسم عمل إبداعي غير مسجل رسميًا.",
    locale: "ar",
  },
  en: {
    dir: "ltr", other: "ar" as Lang, otherName: "العربية", name: "Status",
    title: "Worlds status",
    nav: [["Site", "https://enterworlds.space/en/"], ["Changelog", "https://changelog.enterworlds.space/en/"], ["GitHub", "https://github.com/justpainful/Worlds"]],
    state: { up: "Working", slow: "Slow", degraded: "Intermittent", down: "Down", unknown: "No data" } as Record<State, string>,
    overall: {
      up: "All Worlds services are working",
      slow: "Some Worlds services are slow",
      degraded: "Some Worlds services are intermittent",
      down: "One or more services are down",
      unknown: "Monitoring has started; results appear after the first check",
    } as Record<State, string>,
    groups: { app: "App and accounts", sites: "Sites and downloads" },
    last: (t: string) => `Last checked at ${t}, Riyadh time`,
    uptime: (p: string) => `${p} uptime`,
    noUptime: "No data yet",
    ago: "90 days ago", today: "Today",
    ms: (n: number) => `${n} ms`,
    incidents: "Incidents in the last 90 days",
    none: "No incidents in the last 90 days.",
    ongoing: (s: string, t: string) => `${s}: down since ${t}, still ongoing.`,
    past: (s: string, t: string, d: string) => `${s}: down on ${t} for ${d}.`,
    minutes: (n: number) => (n === 1 ? "1 minute" : `${n} minutes`),
    hours: (n: number) => (n === 1 ? "1 hour" : `${n} hours`),
    and: " and ",
    bar: (date: string, b: Bar) => (b.n ? `${date}: ${pct(b.up / b.n)} of checks passed` : `${date}: no data`),
    how: `Every service is checked every 5 minutes from Cloudflare's network. A service is intermittent after one failed check, down after two in a row, and slow when it takes longer than ${SLOW_MS / 1000} seconds to answer. Days are counted in Riyadh time, and mail to Worlds is not checked.`,
    api: "The same data as JSON",
    fine: "Worlds is a creative working name, not a registered mark.",
    locale: "en-GB",
  },
};

function pct(x: number): string {
  const p = x * 100;
  return `${p >= 99.995 ? "100" : p < 0.005 ? "0" : p.toFixed(2)}%`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function time(at: number, lang: Lang, withDate: boolean): string {
  return new Intl.DateTimeFormat(T[lang].locale, {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
    ...(withDate ? { day: "numeric", month: "long" } : {}),
  }).format(new Date(at * 1000));
}

function dayDate(day: number, lang: Lang): string {
  return new Intl.DateTimeFormat(T[lang].locale, { timeZone: "Asia/Riyadh", day: "numeric", month: "long", year: "numeric", numberingSystem: "latn" }).format(
    new Date((day * 86400 - DAY_OFFSET_S + 3600) * 1000),
  );
}

export function duration(seconds: number, lang: Lang): string {
  const t = T[lang];
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return t.minutes(m);
  return m ? `${t.hours(h)}${t.and}${t.minutes(m)}` : t.hours(h);
}

export function render(data: PageData, lang: Lang): string {
  const t = T[lang];
  const home = lang === "en" ? "/en/" : "/";
  const alt = lang === "en" ? "/" : "/en/";
  const name = (id: string) => {
    const s = SERVICES.find((x) => x.id === id);
    return s ? (lang === "ar" ? s.ar : s.en) : id;
  };
  const row = (v: ServiceView) => `<li class="svc st-${v.state}">
<div class="head"><div class="who"><h3>${esc(lang === "ar" ? v.svc.ar : v.svc.en)}</h3><span class="host">${esc(v.svc.host)}</span></div>
<div class="now"><span class="pill">${t.state[v.state]}</span>${v.ms !== null && v.state !== "unknown" ? `<span class="ms">${t.ms(v.ms)}</span>` : ""}</div></div>
<div class="bars" role="img" aria-label="${esc(v.uptime === null ? t.noUptime : t.uptime(pct(v.uptime)))}">${v.bars.map((b) => `<span class="b l-${b.level}" title="${esc(t.bar(dayDate(b.day, lang), b))}"></span>`).join("")}</div>
<div class="scale"><span>${t.ago}</span><span class="up">${v.uptime === null ? t.noUptime : t.uptime(pct(v.uptime))}</span><span>${t.today}</span></div>
</li>`;
  const groups = (["app", "sites"] as const)
    .map((g) => `<section class="group"><h2>${t.groups[g]}</h2><ul class="svcs">${data.services.filter((v) => v.svc.group === g).map(row).join("")}</ul></section>`)
    .join("");
  const inc = data.incidents.length
    ? `<ul class="inc">${data.incidents
        .slice(0, 20)
        .map((i) => `<li class="${i.ongoing ? "on" : ""}">${esc(i.ongoing ? t.ongoing(name(i.service), time(i.from, lang, true)) : t.past(name(i.service), time(i.from, lang, true), duration(i.to - i.from + 300, lang)))}</li>`)
        .join("")}</ul>`
    : `<p class="muted">${t.none}</p>`;
  return `<!doctype html>
<html lang="${lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${esc(`${t.overall[data.overall]} · ${t.title}`)}</title>
<meta name="description" content="${esc(t.title)}">
<link rel="alternate" hreflang="${t.other}" href="https://status.enterworlds.space${alt}">
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="stylesheet" href="/status.css">
</head>
<body>
<header class="wrap top">
  <a class="brand" href="${home}"><img src="/icon-256.png" alt="" width="34" height="34"><span>Worlds</span><span class="sep" aria-hidden="true"></span><span class="what">${t.name}</span></a>
  <nav class="nav">${t.nav.map(([n, h]) => `<a href="${h}">${n}</a>`).join("")}<a class="lang" href="${alt}" hreflang="${t.other}" lang="${t.other}">${t.otherName}</a></nav>
</header>
<main id="main" class="wrap">
<section class="overall st-${data.overall}"><span class="lamp" aria-hidden="true"></span><div><h1>${t.overall[data.overall]}</h1>${data.lastAt ? `<p>${t.last(time(data.lastAt, lang, false))}</p>` : ""}</div></section>
${groups}
<section class="group"><h2>${t.incidents}</h2>${inc}</section>
<p class="how">${t.how} <a href="/api/status.json">${t.api}</a></p>
</main>
<footer class="wrap foot"><p>${t.fine}</p></footer>
</body>
</html>
`;
}
