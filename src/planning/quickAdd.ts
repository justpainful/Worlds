/**
 * Quick add: "Call the bank tomorrow 4pm !!" becomes a title, a due date,
 * a time and a priority. Words it understands are taken out of the title;
 * anything else stays exactly as typed. Arabic and English both work, with
 * Western or Arabic digits ("٥:٣٠ م").
 */
import { addDays, today, weekday, type Priority } from "./model";

export interface Parsed {
  title: string;
  due: string | null;
  time: string | null;
  priority: Priority;
}

const DAYS: Record<string, number> = {
  sun: 0, sunday: 0, "الأحد": 0, "الاحد": 0, "احد": 0,
  mon: 1, monday: 1, "الاثنين": 1, "الإثنين": 1, "اثنين": 1,
  tue: 2, tues: 2, tuesday: 2, "الثلاثاء": 2, "ثلاثاء": 2,
  wed: 3, wednesday: 3, "الأربعاء": 3, "الاربعاء": 3, "اربعاء": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, "الخميس": 4, "خميس": 4,
  fri: 5, friday: 5, "الجمعة": 5, "جمعة": 5, "الجمعه": 5,
  sat: 6, saturday: 6, "السبت": 6, "سبت": 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, "يناير": 1,
  feb: 2, february: 2, "فبراير": 2,
  mar: 3, march: 3, "مارس": 3,
  apr: 4, april: 4, "أبريل": 4, "ابريل": 4, "إبريل": 4,
  may: 5, "مايو": 5,
  jun: 6, june: 6, "يونيو": 6, "يونيه": 6,
  jul: 7, july: 7, "يوليو": 7, "يوليه": 7,
  aug: 8, august: 8, "أغسطس": 8, "اغسطس": 8,
  sep: 9, sept: 9, september: 9, "سبتمبر": 9,
  oct: 10, october: 10, "أكتوبر": 10, "اكتوبر": 10,
  nov: 11, november: 11, "نوفمبر": 11,
  dec: 12, december: 12, "ديسمبر": 12,
};

// Morning, afternoon and evening words, with and without tanween.
const AM = "am|a\\.m\\.|ص|صباحا|صباحًا|صباحاً|صباح|الصبح|الصباح|فجرا|فجراً|الفجر";
const PM = "pm|p\\.m\\.|م|مساء|مساءً|مساءا|المساء|العصر|عصرا|عصراً|الليل|ليلا|ليلاً|بالليل";
const NOON = "ظهرا|ظهرًا|ظهراً|الظهر";
const N = "[0-9٠-٩۰-۹]";
const re = (src: string, flags = "i") => new RegExp(src, flags);

/** "٥" and "۵" count as 5. */
const num = (s: string) =>
  Number(s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)));

function to24(h: number, m: number, mark: string | undefined): string | null {
  if (mark) {
    const word = mark.toLowerCase();
    const pm = re(`^(?:p|${PM})$`).test(word);
    const noon = re(`^(?:${NOON})$`).test(word);
    if (noon) h = h >= 11 ? h : h + 12;
    else if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseQuickAdd(input: string, now: Date = new Date()): Parsed {
  const base = today(now);
  const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  let text = ` ${input.trim()} `;
  let due: string | null = null;
  let time: string | null = null;
  let priority: Priority = 0;

  const take = (pattern: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(pattern);
    if (!m) return;
    if (fn(m) === false) return;
    text = text.replace(m[0], " ");
  };
  const setTime = (h: number, m: number, mark?: string) => {
    const t = to24(h, m, mark);
    if (!t) return false;
    time = t;
  };

  // Priority: !, !!, !!! or !1..!3
  take(/\s!([1-3])(?=\s)/, (m) => void (priority = Number(m[1]) as Priority));
  if (!priority) take(/\s(!{1,3})(?=\s)/, (m) => void (priority = m[1].length as Priority));

  // Time: "at 5pm", "5:30pm", "17:00", "الساعة 5 مساء", "٥:٣٠ م"
  const lead = "\\s(?:at\\s+|@|الساعة\\s+|الساعه\\s+)?";
  take(re(`${lead}(${N}{1,2})[:٫](${N}{2})\\s*(${AM}|${PM}|${NOON}|a|p)?(?=\\s)`), (m) => setTime(num(m[1]), num(m[2]), m[3]));
  if (!time) take(re(`${lead}(${N}{1,2})\\s*(${AM}|${PM}|${NOON})(?=\\s)`), (m) => setTime(num(m[1]), 0, m[2]));
  if (!time) take(re(`\\s(?:at|الساعة|الساعه)\\s+(${N}{1,2})(?=\\s)`), (m) => setTime(num(m[1]), 0));

  // Dates
  take(/\s(today|tod|اليوم)(?=\s)/i, () => void (due = base));
  if (!due)
    take(re(`\\s(?:tonight|الليلة|الليله)(?:\\s+(?:at\\s+|الساعة\\s+)?(${N}{1,2}))?(?=\\s)`), (m) => {
      due = base;
      // "الليلة 9" is nine in the evening.
      if (m[1] && !time && num(m[1]) >= 1 && num(m[1]) <= 11) time = to24(num(m[1]), 0, "pm");
      time ??= "20:00";
    });
  if (!due) take(/\s(?:after tomorrow|بعد بكرة|بعد بكره|بعد بكرا|بعد غد|بعد الغد)(?=\s)/i, () => void (due = addDays(base, 2)));
  if (!due) take(/\s(tomorrow|tmr|tmrw|بكرة|بكره|بكرا|غدا|غدًا|غداً)(?=\s)/i, () => void (due = addDays(base, 1)));
  if (!due)
    take(/\s(?:next week|(?:الأسبوع|الاسبوع)\s+(?:الجاي|القادم|المقبل))(?=\s)/i, () => void (due = addDays(base, 7)));
  if (!due)
    take(re(`\\s(?:in\\s+(${N}{1,3})\\s+(day|days|week|weeks)|بعد\\s+(${N}{1,3})\\s+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع))(?=\\s)`), (m) => {
      const n = num(m[1] ?? m[3]);
      const unit = (m[2] ?? m[4]).toLowerCase();
      due = addDays(base, /week|سبوع|سابيع/.test(unit) ? n * 7 : n);
    });
  if (!due)
    take(/\s(?:in\s+a\s+(day|week)|بعد\s+(يوم|يومين|أسبوع|اسبوع|أسبوعين|اسبوعين))(?=\s)(?!\s+(?:ال)?(?:أحد|احد|اثنين|إثنين|ثلاثاء|أربعاء|اربعاء|خميس|جمعة|سبت))/i, (m) => {
      const unit = (m[1] ?? m[2]).toLowerCase();
      const days: Record<string, number> = { day: 1, week: 7, "يوم": 1, "يومين": 2, "أسبوع": 7, "اسبوع": 7, "أسبوعين": 14, "اسبوعين": 14 };
      due = addDays(base, days[unit]);
    });
  if (!due) {
    // A weekday anywhere in the text: "review deck sunday", "on Mon", "يوم الخميس", "الأحد الجاي".
    const days = /\s(?:(on|next|يوم)\s+)?([A-Za-z]{3,9}|[؀-ۿ]{3,9})(?:\s+(القادم|القادمة|الجاي|الجاية|المقبل|المقبلة))?(?=\s)/gi;
    for (const m of text.matchAll(days)) {
      const key = m[2].toLowerCase();
      if (!(key in DAYS)) continue;
      const next = m[1]?.toLowerCase() === "next" || !!m[3];
      let diff = (DAYS[key] - weekday(base) + 7) % 7;
      // Today's own weekday means today, unless the time has passed or "next" asks for the week after.
      const at = time as string | null;
      if (diff === 0 && (next || (at !== null && at <= nowHM))) diff = 7;
      due = addDays(base, diff);
      text = text.replace(m[0], " ");
      break;
    }
  }
  if (!due) {
    // "15 نوفمبر", "Nov 15", "15 Nov 2027"
    const dated = (d: number, mo: number, y?: number) => {
      if (!d || d > 31 || !mo) return false;
      let year = y ?? now.getFullYear();
      let iso = `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!y && iso < base) iso = `${++year}-${iso.slice(5)}`;
      due = iso;
    };
    const month = "([A-Za-z]{3,9}|[؀-ۿ]{3,7})";
    // Every number in the text is tried, so "2 copies 15 Nov" still finds the date.
    const forms: [RegExp, (m: RegExpMatchArray) => [string, string, string | undefined]][] = [
      [re(`\\s(${N}{1,2})\\s+${month}(?:\\s+(${N}{4}))?(?=\\s)`, "gi"), (m) => [m[1], m[2], m[3]]],
      [re(`\\s${month}\\s+(${N}{1,2})(?:,?\\s+(${N}{4}))?(?=\\s)`, "gi"), (m) => [m[2], m[1], m[3]]],
    ];
    for (const [pattern, parts] of forms) {
      for (const m of text.matchAll(pattern)) {
        const [d, name, y] = parts(m);
        const mo = MONTHS[name.toLowerCase()];
        if (!mo || dated(num(d), mo, y ? num(y) : undefined) === false) continue;
        text = text.replace(m[0], " ");
        break;
      }
      if (due) break;
    }
  }
  if (!due)
    take(re(`\\s(${N}{4})-(${N}{2})-(${N}{2})(?=\\s)`), (m) => void (due = `${num(m[1])}-${String(num(m[2])).padStart(2, "0")}-${String(num(m[3])).padStart(2, "0")}`));
  if (!due)
    take(re(`\\s(${N}{1,2})\\/(${N}{1,2})(?=\\s)`), (m) => {
      // Day/month, the way most of the world writes it.
      const d = num(m[1]), mo = num(m[2]);
      if (!d || !mo || d > 31 || mo > 12) return false;
      const y = now.getFullYear();
      let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (iso < base) iso = `${y + 1}-${iso.slice(5)}`;
      due = iso;
    });

  // A time on its own means today, or tomorrow if that time has passed.
  // (Assigned inside callbacks, so read it back with its declared type.)
  const at = time as string | null;
  if (at && !due) due = at > nowHM ? base : addDays(base, 1);

  return { title: text.replace(/\s+/g, " ").trim(), due, time, priority };
}
