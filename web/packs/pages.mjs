// A page for every pack and an index of them, in Arabic and English, written
// from the pack definitions (src/packs/definitions) and the app's Arabic
// dictionary. Nothing here is typed by hand per pack: when a pack changes in
// the app, its page changes with the next site build.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = {
  ar: {
    index: "الحزم",
    indexTitle: "حزم Worlds: 39 حزمة للدراسة والعمل والمجتمع والحياة",
    indexDesc: "حزم Worlds تضيف ما يحتاجه عملك بالضبط: المعلم والعمل الحر والمشروع الصغير والمطاعم والمقاولات والجمعيات والمالية الشخصية وغيرها، بالعربية والإنجليزية.",
    indexLead: "الحزمة مجموعة ميزات اختيارية تفعّلها حسب ما تستخدم Worlds له: أنواع عناصر بحقولها، وجداول ولوحات، وأرقام وتنبيهات في الصفحة الرئيسية، وطلبات جاهزة لـ Claude. كل الحزم مجانية، وتعمل بالعربية والإنجليزية، ويمكن تفعيل أكثر من حزمة معًا.",
    pack: (l) => `حزمة ${l}`,
    title: (l) => `حزمة ${l} في Worlds`,
    adds: "ما تضيفه الحزمة",
    kinds: "ما تحفظه فيها",
    fields: "الحقول",
    views: "الجداول واللوحات",
    board: "لوحة",
    table: "جدول",
    custom: "عرض خاص",
    home: "في الصفحة الرئيسية",
    figures: "أرقام",
    alerts: "تنبيهات عندما يحتاج شيء انتباهك",
    claude: "طلبات جاهزة لـ Claude",
    claudeNote: "تختار الطلب من الحزمة، فيصل إلى Claude مع العنصر المفتوح، وكل تعديل يجريه يمكن التراجع عنه.",
    messages: "رسائل جاهزة",
    messagesNote: "يملأ Worlds الرسالة من بيانات العنصر ويفتحها في واتساب أو البريد، فتراجعها وترسلها بنفسك.",
    team: "الأدوار في مساحة الفريق",
    seesAll: "يرى كل العناصر",
    seesAssigned: "يرى ما أُسند إليه فقط",
    canEdit: "ويعدّل",
    readOnly: "للقراءة",
    send: (to) => `إرسال إلى ${to}`,
    start: "ابدأ بها",
    steps: [
      ["ثبّت Worlds أو افتحه في المتصفح", 'من <a href="/apps/">صفحة التطبيقات</a>، أو افتح <a href="https://app.enterworlds.space/">Worlds على الويب</a>.'],
      ["فعّل الحزمة", (l) => `من <strong>الإعدادات</strong>، <strong>الحزم</strong>، شغّل حزمة ${esc(l)}. أو اخترها من سؤال «لأي شيء تستخدم Worlds؟» في الترحيب.`],
      ["جرّبها بأمثلة", "أضف الأمثلة الجاهزة من الحزمة لترى كيف تعمل، ثم احذفها متى شئت."],
    ],
    related: "حزم قريبة",
    all: "كل الحزم",
    guide: "دليل الحزم",
  },
  en: {
    index: "Packs",
    indexTitle: "Worlds packs: 39 packs for study, work, community and life",
    indexDesc: "Worlds packs add exactly what your work needs: Teacher, Freelance, Small business, Restaurants, Contracting, Nonprofits, Personal finance and more, in Arabic and English.",
    indexLead: "A pack is an optional set of features you turn on for what you use Worlds for: kinds of items with their fields, tables and boards, figures and alerts on Home, and ready requests for Claude. Every pack is free, works in Arabic and English, and you can turn on several at once.",
    pack: (l) => `The ${l} pack`,
    title: (l) => `The ${l} pack in Worlds`,
    adds: "What the pack adds",
    kinds: "What you keep in it",
    fields: "Fields",
    views: "Tables and boards",
    board: "Board",
    table: "Table",
    custom: "Custom view",
    home: "On Home",
    figures: "Figures",
    alerts: "Alerts when something needs you",
    claude: "Ready requests for Claude",
    claudeNote: "Pick a request from the pack and Claude gets it with the open item; every change it makes can be undone.",
    messages: "Ready messages",
    messagesNote: "Worlds fills in the message from the item and opens it in WhatsApp or email, so you read it and send it yourself.",
    team: "Roles in a Team workspace",
    seesAll: "sees every item",
    seesAssigned: "sees only what is assigned to them",
    canEdit: "and edits",
    readOnly: "read only",
    send: (to) => `Send to ${to}`,
    start: "Get started",
    steps: [
      ["Install Worlds or open it in the browser", 'From the <a href="/en/apps/">apps page</a>, or open <a href="https://app.enterworlds.space/">Worlds on the web</a>.'],
      ["Turn the pack on", (l) => `In <strong>Settings</strong>, <strong>Packs</strong>, turn on ${esc(l)}. Or pick it when the welcome asks "What do you use Worlds for?".`],
      ["Try it with examples", "Add the pack's ready examples to see how it works, and delete them whenever you like."],
    ],
    related: "Related packs",
    all: "All packs",
    guide: "Packs guide",
  },
};

export function packPages({ packs, families }, ar) {
  const tr = (lang, s) => (lang === "ar" ? ar[s] ?? s : s);
  const base = (lang) => (lang === "en" ? "/en/" : "/");
  const out = { ar: [], en: [] };
  for (const lang of ["ar", "en"]) {
    const w = W[lang];
    const t = (s) => esc(tr(lang, s));
    const fam = (id) => tr(lang, families.find((f) => f.id === id)?.label ?? id);

    // The index: every family with its packs.
    const groups = families
      .map((f) => {
        const list = packs.filter((p) => p.family === f.id);
        if (!list.length) return "";
        return `<h2 id="${f.id}">${t(f.label)}</h2>\n<ul class="index">${list.map((p) => `<li><a href="${base(lang)}packs/${p.id}/"><strong>${t(p.label)}</strong><span>${t(p.blurb)}</span></a></li>`).join("")}</ul>`;
      })
      .join("\n");
    out[lang].push({
      route: "packs/",
      meta: { title: w.indexTitle, nav: w.index, description: w.indexDesc },
      body: `<h1>${esc(w.index)}</h1>\n<p class="lead">${esc(w.indexLead)}</p>\n${groups}\n<p><a href="${base(lang)}docs/packs/">${esc(w.guide)}</a></p>`,
    });

    for (const p of packs) {
      const label = tr(lang, p.label);
      const parts = [];
      parts.push(`<p class="crumb"><a href="${base(lang)}packs/">${esc(w.index)}</a> / ${esc(fam(p.family))}</p>`);
      parts.push(`<h1>${esc(w.pack(label))}</h1>`);
      parts.push(`<p class="lead">${t(p.blurb)}</p>`);
      if (p.adds?.length) parts.push(`<h2 id="adds">${w.adds}</h2>\n<ul>${p.adds.map((a) => `<li>${t(a)}</li>`).join("")}</ul>`);
      parts.push(
        `<h2 id="kinds">${w.kinds}</h2>\n` +
          p.kinds
            .map((k) => {
              const fields = k.fields.filter((f) => !f.detailOnly && f.id !== "notes").map((f) => tr(lang, f.label));
              const msgs = (k.messages ?? []).map((m) => tr(lang, m.label));
              return `<h3>${t(k.plural)}</h3>\n<p>${t(k.blurb)}${fields.length ? `. ${w.fields}: ${esc(fields.join(lang === "ar" ? "، " : ", "))}.` : "."}</p>${msgs.length ? `\n<p>${esc(w.messages)}: ${esc(msgs.join(lang === "ar" ? "، " : ", "))}.</p>` : ""}`;
            })
            .join("\n"),
      );
      const views = (p.views ?? []).filter((v) => v.type !== "custom" || v.label);
      if (views.length) parts.push(`<h2 id="views">${w.views}</h2>\n<ul>${views.map((v) => `<li>${t(v.label)} (${w[v.type] ?? w.table})</li>`).join("")}</ul>`);
      if (p.stats?.length || p.alerts?.length) {
        let s = `<h2 id="home">${w.home}</h2>`;
        if (p.stats?.length) s += `\n<p><strong>${w.figures}:</strong> ${esc(p.stats.map((x) => tr(lang, x.label)).join(lang === "ar" ? "، " : ", "))}.</p>`;
        if (p.alerts?.length) s += `\n<p><strong>${w.alerts}:</strong> ${esc(p.alerts.map((x) => tr(lang, x.label)).join(lang === "ar" ? "، " : ", "))}.</p>`;
        parts.push(s);
      }
      if (p.prompts?.length) parts.push(`<h2 id="claude">${w.claude}</h2>\n<ul>${p.prompts.map((x) => `<li>${t(x.label)}</li>`).join("")}</ul>\n<p>${esc(w.claudeNote)}</p>`);
      const roleName = (id) => tr(lang, p.roles?.find((r) => r.id === id)?.label ?? id);
      const publishes = p.kinds.filter((k) => k.publish).map((k) => (lang === "ar" ? `${tr(lang, k.plural)} إلى كل ${roleName(k.publish.role)}` : `${tr(lang, k.plural)} to every ${roleName(k.publish.role)}`));
      if (p.roles?.length) {
        parts.push(
          `<h2 id="team">${w.team}</h2>\n<ul>${p.roles.map((r) => `<li><strong>${t(r.label)}</strong>: ${r.sees === "all" ? w.seesAll : w.seesAssigned}${lang === "ar" ? "، " : ", "}${r.canEdit ? w.canEdit : w.readOnly}</li>`).join("")}</ul>` +
            (publishes.length ? `\n<p>${lang === "ar" ? "ترسل من هنا، فيصل كل عنصر إلى Worlds الخاص بالعضو" : "Send from here, and each item arrives in the member's own Worlds"}: ${esc(publishes.join(lang === "ar" ? "، " : ", "))}.</p>` : ""),
        );
      }
      if (p.kinds.some((k) => k.messages?.length)) parts.push(`<p>${esc(w.messagesNote)}</p>`);
      parts.push(
        `<h2 id="start">${w.start}</h2>\n<ol class="steps">${w.steps
          .slice(0, p.samples?.length ? 3 : 2)
          .map(([h, b]) => `<li><h3>${esc(h)}</h3><p>${typeof b === "function" ? b(label) : b}</p></li>`)
          .join("")}</ol>`,
      );
      const near = packs.filter((x) => x.family === p.family && x.id !== p.id);
      if (near.length) parts.push(`<h2 id="related">${w.related}</h2>\n<ul class="index">${near.map((x) => `<li><a href="${base(lang)}packs/${x.id}/"><strong>${t(x.label)}</strong><span>${t(x.blurb)}</span></a></li>`).join("")}</ul>`);
      parts.push(`<p><a href="${base(lang)}packs/">${esc(w.all)}</a></p>`);

      const adds = (p.adds ?? []).slice(0, 3).map((a) => tr(lang, a)).join(lang === "ar" ? "، " : ", ");
      let description = `${tr(lang, p.blurb)} ${adds}${adds ? "." : ""}`.replace(/\.\./g, ".");
      if (description.length > 300) description = `${description.slice(0, 297).replace(/\s+\S*$/, "")}...`;
      out[lang].push({
        route: `packs/${p.id}/`,
        meta: { title: w.title(label), nav: label, description },
        body: parts.join("\n\n"),
      });
    }
  }
  return out;
}
