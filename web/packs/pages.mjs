// A page for every pack and an index of them, in Arabic and English, written
// from the pack definitions (src/packs/definitions) and the app's Arabic
// dictionary. Each pack page reads like a store listing: the pack's icon and
// name with a button to turn it on, a banner of ready requests, what it keeps,
// and an information table. Nothing here is typed by hand per pack.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DRAWN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "assets", "drawn");
// Each family draws its icons in one of the four colours of the new icon set.
const SET = { education: "teal", business: "gold", field: "blue", services: "pink", creative: "pink", community: "teal", personal: "blue" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Each family keeps one colour on its banner, from the site's palette.
const HUE = { education: "teal", business: "terra", field: "ochre", services: "sage", creative: "plum", community: "teal", personal: "ochre" };

const W = {
  ar: {
    sep: "، ",
    index: "الحزم",
    indexTitle: "حزم Worlds: 39 حزمة للدراسة والعمل والمجتمع والحياة",
    indexDesc: "حزم Worlds تضيف ما يحتاجه عملك بالضبط: المعلم والعمل الحر والمشروع الصغير والمطاعم والمقاولات والجمعيات والمالية الشخصية وغيرها، بالعربية والإنجليزية.",
    indexLead: "الحزمة مجموعة ميزات اختيارية تفعّلها حسب ما تستخدم Worlds له: أنواع عناصر بحقولها، وجداول ولوحات، وأرقام وتنبيهات في الصفحة الرئيسية، وطلبات جاهزة لـ Claude. كل الحزم مجانية، وتعمل بالعربية والإنجليزية، ويمكن تفعيل أكثر من حزمة معًا.",
    title: (l) => `حزمة ${l} في Worlds`,
    by: "من Worlds",
    get: "فعّلها في Worlds",
    keeps: "ما تحفظه",
    info: "معلومات",
    rows: {
      developer: ["المطوّر", "Worlds"],
      family: "الفئة",
      can: "القدرات",
      views: "الجداول واللوحات",
      figures: "أرقام الرئيسية",
      alerts: "التنبيهات",
      roles: "الأدوار في الفريق",
      messages: "رسائل جاهزة",
      price: ["السعر", "مجانية"],
      languages: ["اللغات", "العربية والإنجليزية"],
      platforms: ["المنصات", "ويندوز وماك ولينكس والويب، وأندرويد وآيفون وآيباد"],
      since: "متاحة منذ",
      guide: "الدليل",
      website: "الموقع",
      privacy: "سياسة الخصوصية",
      terms: "شروط الاستخدام",
    },
    caps: { tables: "جداول", boards: "لوحات", home: "أرقام وتنبيهات في الرئيسية", claude: "طلبات لـ Claude", messages: "رسائل واتساب وبريد", team: "أدوار للفريق", send: "إرسال للأعضاء" },
    guideLink: "دليل الحزم",
    fine: "تعمل الحزمة داخل Worlds على جهازك، وتبقى بياناتها معك. إطفاؤها يخفي واجهاتها وعناصرها دون حذف أي شيء، وإعادة تشغيلها تعيدها كلها. فعّلها من الإعدادات، الحزم، أو من سؤال «لأي شيء تستخدم Worlds؟» في الترحيب.",
    claudeName: "Claude",
    worldsName: "Worlds",
    related: "حزم قريبة",
    all: "كل الحزم",
  },
  en: {
    sep: ", ",
    index: "Packs",
    indexTitle: "Worlds packs: 39 packs for study, work, community and life",
    indexDesc: "Worlds packs add exactly what your work needs: Teacher, Freelance, Small business, Restaurants, Contracting, Nonprofits, Personal finance and more, in Arabic and English.",
    indexLead: "A pack is an optional set of features you turn on for what you use Worlds for: kinds of items with their fields, tables and boards, figures and alerts on Home, and ready requests for Claude. Every pack is free, works in Arabic and English, and you can turn on several at once.",
    title: (l) => `The ${l} pack in Worlds`,
    by: "By Worlds",
    get: "Turn on in Worlds",
    keeps: "What it keeps",
    info: "Information",
    rows: {
      developer: ["Developer", "Worlds"],
      family: "Category",
      can: "Capabilities",
      views: "Tables and boards",
      figures: "Home figures",
      alerts: "Alerts",
      roles: "Team roles",
      messages: "Ready messages",
      price: ["Price", "Free"],
      languages: ["Languages", "Arabic and English"],
      platforms: ["Platforms", "Windows, Mac, Linux and the web, plus Android, iPhone and iPad"],
      since: "Available since",
      guide: "Guide",
      website: "Website",
      privacy: "Privacy Policy",
      terms: "Terms of Use",
    },
    caps: { tables: "Tables", boards: "Boards", home: "Home figures and alerts", claude: "Claude requests", messages: "WhatsApp and email messages", team: "Team roles", send: "Sending to members" },
    guideLink: "Packs guide",
    fine: "The pack runs inside Worlds on your device, and its data stays with you. Turning it off hides its views and items without deleting anything, and turning it back on brings them all back. Turn it on in Settings, Packs, or when the welcome asks what you use Worlds for.",
    claudeName: "Claude",
    worldsName: "Worlds",
    related: "Related packs",
    all: "All packs",
  },
};

export function packPages({ packs, families, drawn }, ar) {
  const tr = (lang, s) => (lang === "ar" ? ar[s] ?? s : s);
  const base = (lang) => (lang === "en" ? "/en/" : "/");
  // The new hand-drawn icons, picked the way the app picks them (src/ui/drawnMap.ts):
  // the drawing for the product icon, in the family's colour, gold filling a gap.
  const icons = new Map();
  const icon = (name, size, cls = "", family = "education") => {
    const drawing = drawn[name] ?? name;
    let file = null;
    for (const set of [SET[family] ?? "gold", "gold"]) {
      for (const ext of ["png", "svg"]) if (!file && existsSync(join(DRAWN_DIR, set, `${drawing}.${ext}`))) file = `${set}/${drawing}.${ext}`;
    }
    if (!file) throw new Error(`pack icon ${name}: no drawing ${drawing}`);
    icons.set(file, join(DRAWN_DIR, file));
    return `<img${cls ? ` class="${cls}"` : ""} src="/media/packs/${file}" alt="" width="${size}" height="${size}" loading="lazy">`;
  };
  const out = { ar: [], en: [], icons };

  for (const lang of ["ar", "en"]) {
    const w = W[lang];
    const t = (s) => esc(tr(lang, s));
    const join = (list) => esc(list.join(w.sep));
    const fam = (id) => tr(lang, families.find((f) => f.id === id)?.label ?? id);

    // The index: every family with its packs, each row with the pack's icon.
    const groups = families
      .map((f) => {
        const list = packs.filter((p) => p.family === f.id);
        if (!list.length) return "";
        return `<h2 id="${f.id}">${t(f.label)}</h2>\n<ul class="pk-rows pk-links">${list
          .map((p) => `<li><a href="${base(lang)}packs/${p.id}/">${icon(p.icon, 44, "", p.family)}<div><strong>${t(p.label)}</strong><span>${t(p.blurb)}</span></div></a></li>`)
          .join("")}</ul>`;
      })
      .join("\n");
    out[lang].push({
      route: "packs/",
      meta: { title: w.indexTitle, nav: w.index, description: w.indexDesc },
      body: `<h1>${esc(w.index)}</h1>\n<p class="lead">${esc(w.indexLead)}</p>\n${groups}\n<p><a href="${base(lang)}docs/packs/">${esc(w.guideLink)}</a></p>`,
    });

    for (const p of packs) {
      const label = tr(lang, p.label);
      const hue = HUE[p.family] ?? "teal";
      const parts = [];
      parts.push(`<p class="crumb"><a href="${base(lang)}packs/">${esc(w.index)}</a> / ${esc(fam(p.family))}</p>`);

      // Head: icon, name, maker and family, and the button.
      parts.push(
        `<header class="pk-head">${icon(p.icon, 64, "pk-icon", p.family)}<div class="pk-name"><h1>${esc(label)}</h1><p>${esc(w.by)} · ${esc(fam(p.family))}</p></div>` +
          `<a class="pk-get" href="https://app.enterworlds.space/">${esc(w.get)}</a></header>`,
      );

      // Banner: the ready requests for Claude, or what the pack adds when it has none.
      const chips = (p.prompts?.length ? p.prompts.map((x) => [w.claudeName, tr(lang, x.label)]) : (p.adds ?? []).map((a) => [w.worldsName, tr(lang, a)])).slice(0, 3);
      if (chips.length) {
        parts.push(
          `<div class="pk-hero h-${hue}" role="presentation"><ul>${chips
            .map(([who, text]) => `<li><span class="pk-who">${esc(who)}</span> ${esc(text)}<span class="pk-go" aria-hidden="true"></span></li>`)
            .join("")}</ul></div>`,
        );
      }

      // Description: one short paragraph, as on a store page.
      const adds = (p.adds ?? []).map((a) => tr(lang, a));
      parts.push(`<p class="pk-desc">${t(p.blurb)}</p>`);

      // What it keeps: one row per kind, like the app list of a store page.
      parts.push(
        `<section class="pk-sec"><h2>${esc(w.keeps)} <span class="pk-count">${p.kinds.length}</span></h2>\n<ul class="pk-rows">${p.kinds
          .map((k) => {
            const fields = k.fields.filter((f) => !f.detailOnly && f.id !== "notes").map((f) => tr(lang, f.label));
            return `<li>${icon(k.icon, 44, "", p.family)}<div><strong>${t(k.plural)}</strong><span>${t(k.blurb)}${fields.length ? `: ${join(fields)}` : ""}</span></div></li>`;
          })
          .join("")}</ul></section>`,
      );

      // Information: capabilities and the facts, as label and value rows.
      const views = p.views ?? [];
      const caps = [];
      if (views.some((v) => v.type === "table")) caps.push(w.caps.tables);
      if (views.some((v) => v.type === "board")) caps.push(w.caps.boards);
      if (p.stats?.length || p.alerts?.length) caps.push(w.caps.home);
      if (p.prompts?.length) caps.push(w.caps.claude);
      if (p.kinds.some((k) => k.messages?.length)) caps.push(w.caps.messages);
      if (p.roles?.length) caps.push(w.caps.team);
      if (p.kinds.some((k) => k.publish)) caps.push(w.caps.send);
      const r = w.rows;
      const rows = [
        [r.can, join(caps)],
        [r.developer[0], esc(r.developer[1])],
        [r.family, esc(fam(p.family))],
        views.length ? [r.views, join(views.map((v) => tr(lang, v.label)))] : null,
        p.stats?.length ? [r.figures, join(p.stats.map((x) => tr(lang, x.label)))] : null,
        p.alerts?.length ? [r.alerts, join(p.alerts.map((x) => tr(lang, x.label)))] : null,
        p.roles?.length ? [r.roles, join(p.roles.map((x) => tr(lang, x.label)))] : null,
        p.kinds.some((k) => k.messages?.length) ? [r.messages, join(p.kinds.flatMap((k) => (k.messages ?? []).map((m) => tr(lang, m.label))))] : null,
        [r.price[0], esc(r.price[1])],
        [r.languages[0], esc(r.languages[1])],
        [r.platforms[0], esc(r.platforms[1])],
        [r.since, `<a href="https://changelog.enterworlds.space${base(lang)}${p.id === "study" ? "0.2.0" : "0.3.2"}/">${p.id === "study" ? "0.2.0" : "0.3.2"}</a>`],
        [r.guide, `<a class="ext" href="${base(lang)}docs/packs/">${esc(w.guideLink)}</a>`],
        [r.website, `<a class="ext" href="${base(lang)}" aria-label="enterworlds.space"></a>`],
        [r.privacy, `<a class="ext" href="${base(lang)}privacy/" aria-label="${esc(r.privacy)}"></a>`],
        [r.terms, `<a class="ext" href="${base(lang)}terms/" aria-label="${esc(r.terms)}"></a>`],
      ].filter(Boolean);
      parts.push(`<section class="pk-sec"><h2>${esc(w.info)}</h2>\n<dl class="pk-info">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl></section>`);
      parts.push(`<p class="pk-fine">${esc(w.fine)}</p>`);

      const near = packs.filter((x) => x.family === p.family && x.id !== p.id);
      if (near.length) {
        parts.push(
          `<section class="pk-sec"><h2>${esc(w.related)}</h2>\n<ul class="pk-rows pk-links">${near
            .map((x) => `<li><a href="${base(lang)}packs/${x.id}/">${icon(x.icon, 44, "", x.family)}<div><strong>${t(x.label)}</strong><span>${t(x.blurb)}</span></div></a></li>`)
            .join("")}</ul></section>`,
        );
      }
      parts.push(`<p><a href="${base(lang)}packs/">${esc(w.all)}</a></p>`);

      let description = `${tr(lang, p.blurb)} ${adds.slice(0, 3).join(w.sep)}${adds.length ? "." : ""}`;
      if (description.length > 300) description = `${description.slice(0, 297).replace(/\s+\S*$/, "")}...`;
      out[lang].push({ route: `packs/${p.id}/`, meta: { title: w.title(label), nav: label, description, layout: "store" }, body: parts.join("\n") });
    }
  }
  return out;
}
