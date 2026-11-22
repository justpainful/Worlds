// Line drawings for the release cards on changelog.enterworlds.space.
// White strokes on a near-black panel, drawn a little loose, like a pen on paper.
// Each drawing is the inside of a 160 x 120 SVG. `k` marks a shape filled with
// the panel colour, so a sheet in front hides the lines behind it.
// A release names its drawings in `feature:` lines (web/changelog/README.md).

const plus = (x, y, s = 5) => `<path d="M${x} ${y - s}V${y + s}M${x - s} ${y}H${x + s}"/>`;

export const ART = {
  // A stack of pages, the front one written on: Pages 2.0 and Worlds 1.0.
  pages: `<path d="M51 36 Q51 33 54 33 L97 29 Q100 29 100.5 32 L104 79 Q104 82 101 82.5 L58 86 Q55 86 54.5 83 Z"/>
<path class="k" d="M64 42 Q61 42 60.7 45 L57 92 Q57 95 60 95.3 L104 99 Q107 99 107.3 96 L111 49 Q111 46 108 45.7 Z"/>
<path d="M71 57 L99 59.5M70 65.5 L98 68M69 74 L89 75.5"/>
<path d="M114 31 L120 25M116 39 H124M45 93 Q43 99 49 102"/>`,

  // Thoughts as a cloud, three ideas joined inside it: Cognition.
  cognition: `<path d="M58 67 Q47 67 47.5 57 Q48 47 58 46.5 Q60 34 72 34.5 Q82 29 90.5 37.5 Q100.5 33 106.5 43.5 Q117 45.5 114.5 57 Q119 68 106.5 70.5 Q100 79 88 74.5 Q78 81 70 72.5 Q61 76 58 67 Z"/>
<path d="M70.5 52.5 L93 48.5 L88 66 Z"/>
<circle class="k" cx="70.5" cy="52.5" r="4.2"/><circle class="k" cx="93" cy="48.5" r="4.2"/><circle class="k" cx="88" cy="66" r="4.2"/>
${plus(40, 34)}${plus(121, 86, 4)}`,

  // One page made of blocks: a heading, a task and a table.
  blocks: `<path d="M56 25 H104 Q108 25 108 29 V95 Q108 99 104 99 H56 Q52 99 52 95 V29 Q52 25 56 25 Z"/>
<path d="M61 37 H91" stroke-width="3.2"/>
<path d="M61.5 47.5 h7 v7 h-7 Z M63 51 l2 2 l3.5 -4"/><path d="M74 51 H99"/>
<path d="M61 63 H99 V83 H61 Z M61 73 H99 M80 63 V83"/>
${plus(120, 36, 4)}<path d="M38 88 L44 84"/>`,

  // A pen writing in a page, with the way back: Claude edits, every change can be undone.
  claude: `<path d="M48 30 H92 Q96 30 96 34 V94 Q96 98 92 98 H48 Q44 98 44 94 V34 Q44 30 48 30 Z"/>
<path d="M53 44 H86M53 53 H84M53 62 H74"/>
<path class="k" d="M88 84 L114 56 L121 62.5 L95 90.5 L86 93 Z"/><path d="M88.5 85.5 L93.5 90"/>
<path d="M123 47 Q123 32 108 32"/><path d="M113 26.5 L107.5 32 L113 37.5"/>`,

  // A laptop and a phone: Worlds on every device.
  devices: `<path d="M42 34 H96 Q99 34 99 37 V71 H39 V37 Q39 34 42 34 Z"/>
<path d="M31 75 H106 L101.5 82 H35.5 Z"/>
<path class="k" d="M108 47 Q108 43 112 43 H124 Q128 43 128 47 V83 Q128 87 124 87 H112 Q108 87 108 83 Z"/>
<path d="M115.5 81 H120.5"/>
<path d="M51 47 H80M51 55 H72"/>${plus(130, 30, 4)}`,

  // A pencil and the line it left: the drawing workspace.
  drawing: `<path d="M34 86 Q46 46 66 68 Q84 90 94 60 Q102 36 122 42"/>
<path class="k" d="M100 94 L126 66 L133 72.5 L107 100.5 L98 103 Z"/><path d="M100.5 95.5 L105.5 100"/>
<circle cx="66" cy="68" r="2.4"/>${plus(42, 34, 4)}`,

  // One chip wired to several providers: AI from any provider.
  providers: `<path class="k" d="M68 46 Q68 43 71 43 H89 Q92 43 92 46 V74 Q92 77 89 77 H71 Q68 77 68 74 Z"/>
<path d="M75 52 H85 V68 H75 Z"/>
<path d="M68 52 H54 Q50 52 50 48 V38M68 68 H54 Q50 68 50 72 V82M92 52 H106 Q110 52 110 48 V38M92 68 H106 Q110 68 110 72 V82"/>
<circle class="k" cx="50" cy="33" r="5"/><circle class="k" cx="110" cy="33" r="5"/><circle class="k" cx="50" cy="87" r="5"/><circle class="k" cx="110" cy="87" r="5"/>`,

  // Lines that start on the right, and an arrow leading left: a right to left interface.
  rtl: `<path d="M44 26 H124 Q128 26 128 30 V96 Q128 100 124 100 H44 Q40 100 40 96 V30 Q40 26 44 26 Z"/>
<path d="M40 38 H128"/><circle cx="118" cy="32" r="1.6"/><circle cx="111.5" cy="32" r="1.6"/>
<path d="M118 51 H66M118 60 H80M118 69 H58M118 78 H90" />
<path d="M116 90 H62M68 85 L62 90 L68 95"/>`,

  // A crescent over a calendar: the Hijri date, and Arabic everywhere.
  arabic: `<path d="M44 46 H96 Q100 46 100 50 V94 Q100 98 96 98 H44 Q40 98 40 94 V50 Q40 46 44 46 Z"/>
<path d="M40 58 H100M54 41 V51M86 41 V51"/>
<path d="M52 68 h1M64 68 h1M76 68 h1M88 68 h1M52 79 h1M64 79 h1M88 79 h1M52 89 h1M64 89 h1M76 89 h1" stroke-width="3"/>
<path d="M73 75 h7 v7 h-7 Z"/>
<path d="M123 26 Q109 29 110 43 Q111 55 125 56 Q113 63 103 53 Q95 41 105 31 Q112 25 123 26 Z"/>`,

  // A lens over an alef with a hamza and one without, equal: search that understands Arabic.
  search: `<circle cx="72" cy="54" r="23"/>
<path d="M89 71 L113 95" stroke-width="4.2"/>
<path d="M63 46 V64M81 46 V64M69 52.5 H75M69 57.5 H75"/><path d="M60 41.5 Q63 37 66.5 40 Q63.5 41.5 61 43.5 H66.5"/>
${plus(118, 34, 4)}<path d="M40 88 L46 84"/>`,

  // An open box, with what it brings: sector packs.
  packs: `<path class="k" d="M46 58 L80 68 L114 58 V91 L80 101 L46 91 Z"/>
<path d="M80 68 V101"/>
<path d="M46 58 L57 44 L91 54 L80 68M114 58 L103 44 L69 54"/>
<path d="M72 46 L73 30 L86 31 L85 49M88 50 L96 36 L105 41 L100 46"/>
${plus(40, 36, 4)}`,

  // A profile card with a banner, a picture and a name.
  profile: `<path d="M46 30 H116 Q122 30 122 36 V86 Q122 92 116 92 H46 Q40 92 40 86 V36 Q40 30 46 30 Z"/>
<path d="M40 50 H122"/>
<path d="M48 41 Q60 34 70 41 T92 40"/>
<circle class="k" cx="60" cy="54" r="10"/>
<path d="M76 66 H106M76 75 H96"/>
<path d="M54 84 H62"/>`,

  // The same face on the web and on a computer, passed between them: one account everywhere.
  sync: `<path d="M30 36 Q30 32 34 32 H70 Q74 32 74 36 V66 Q74 70 70 70 H34 Q30 70 30 66 Z"/><path d="M30 41 H74"/>
<circle cx="52" cy="53" r="6"/><path d="M43 66 Q52 57 61 66"/>
<path d="M92 40 Q92 37 95 37 H129 Q132 37 132 40 V66 H89 Z"/><path d="M84 70 H136 L132.5 75 H87.5 Z"/>
<circle cx="111" cy="50" r="5.5"/><path d="M103 63 Q111 55 119 63"/>
<path d="M58 84 Q80 100 104 84"/><path d="M98 82 L104 84 L102 90"/>
<path d="M104 26 Q82 14 64 24"/><path d="M70 21 L64 24 L67 30"/>`,

  // A name tag with a handwritten name: names are never translated.
  name: `<path class="k" d="M48 38 H112 Q118 38 118 44 V82 Q118 88 112 88 H48 Q42 88 42 82 V44 Q42 38 48 38 Z"/>
<path class="k" d="M72 32 H88 V42 H72 Z"/><path d="M76 37 H84"/>
<path d="M42 54 H118"/>
<path d="M54 74 Q58 62 62 72 Q64 77 68 70 Q71 64 74 72 Q77 77 81 71 Q84 66 88 72 Q92 76 98 70 L104 68"/>
${plus(128, 30, 4)}`,
};

/** The drawing as an SVG, sized by CSS. Decorative: the card's own heading names it. */
export function art(name) {
  if (!ART[name]) throw new Error(`changelog: no drawing named ${name}`);
  return `<svg class="art" viewBox="0 0 160 120" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ART[name]}</g></svg>`;
}
