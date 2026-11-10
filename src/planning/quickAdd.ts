/**
 * Quick add: "Call the bank tomorrow 4pm !!" becomes a title, a due date,
 * a time and a priority. Words it understands are taken out of the title;
 * anything else stays exactly as typed. Arabic and English both work.
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
  fri: 5, friday: 5, "الجمعة": 5, "جمعة": 5,
  sat: 6, saturday: 6, "السبت": 6, "سبت": 6,
};

function nextWeekday(from: string, day: number): string {
  const diff = (day - weekday(from) + 7) % 7 || 7;
  return addDays(from, diff);
}

function to24(h: number, m: number, ampm: string | undefined): string | null {
  if (ampm) {
    const pm = /^(pm|p|م|مساء|مساءً|العصر|الليل)$/i.test(ampm);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseQuickAdd(input: string, now: Date = new Date()): Parsed {
  const base = today(now);
  let text = ` ${input.trim()} `;
  let due: string | null = null;
  let time: string | null = null;
  let priority: Priority = 0;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re);
    if (!m) return;
    if (fn(m) === false) return;
    text = text.replace(m[0], " ");
  };

  // Priority: !, !!, !!! or !1..!3
  take(/\s!([1-3])(?=\s)/, (m) => void (priority = Number(m[1]) as Priority));
  if (!priority) take(/\s(!{1,3})(?=\s)/, (m) => void (priority = m[1].length as Priority));

  // Time: "at 5pm", "5:30pm", "17:00", "الساعة 5 مساء"
  take(/\s(?:at\s+|@|الساعة\s+)?(\d{1,2}):(\d{2})\s*(am|pm|a|p|ص|م)?(?=\s)/i, (m) => {
    const t = to24(Number(m[1]), Number(m[2]), m[3]);
    if (!t) return false;
    time = t;
  });
  if (!time)
    take(/\s(?:at\s+|@|الساعة\s+)?(\d{1,2})\s*(am|pm|ص|م|مساء|مساءً|صباحا|صباحًا)(?=\s)/i, (m) => {
      const t = to24(Number(m[1]), 0, m[2].startsWith("صباح") ? "am" : m[2]);
      if (!t) return false;
      time = t;
    });
  if (!time) take(/\s(?:at|الساعة)\s+(\d{1,2})(?=\s)/i, (m) => {
    const t = to24(Number(m[1]), 0, undefined);
    if (!t) return false;
    time = t;
  });

  // Dates
  take(/\s(today|tod|اليوم)(?=\s)/i, () => void (due = base));
  if (!due) take(/\s(tonight|الليلة)(?=\s)/i, () => {
    due = base;
    time ??= "20:00";
  });
  if (!due) take(/\s(tomorrow|tmr|tmrw|بكرة|بكره|غدا|غدًا|غداً)(?=\s)/i, () => void (due = addDays(base, 1)));
  if (!due) take(/\s(?:after tomorrow|بعد بكرة|بعد بكره|بعد غد)(?=\s)/i, () => void (due = addDays(base, 2)));
  if (!due) take(/\s(?:next week|الأسبوع الجاي|الاسبوع الجاي|الأسبوع القادم)(?=\s)/i, () => void (due = addDays(base, 7)));
  if (!due)
    take(/\s(?:in\s+(\d{1,3})\s+(day|days|week|weeks)|بعد\s+(\d{1,3})\s+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع))(?=\s)/i, (m) => {
      const n = Number(m[1] ?? m[3]);
      const unit = (m[2] ?? m[4]).toLowerCase();
      due = addDays(base, /week|سبوع|سابيع/.test(unit) ? n * 7 : n);
    });
  if (!due) {
    // A weekday anywhere in the text: "review deck sunday", "on Mon", "يوم الخميس".
    for (const m of text.matchAll(/\s(?:on\s+|next\s+|يوم\s+)?([A-Za-z]{3,9}|[\u0600-\u06FF]{3,9})(?=\s)/g)) {
      const key = m[1].toLowerCase();
      if (key in DAYS) {
        due = nextWeekday(base, DAYS[key]);
        text = text.replace(m[0], " ");
        break;
      }
    }
  }
  if (!due)
    take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => void (due = `${m[1]}-${m[2]}-${m[3]}`));
  if (!due)
    take(/\s(\d{1,2})\/(\d{1,2})(?=\s)/, (m) => {
      // Day/month, the way most of the world writes it.
      const d = Number(m[1]), mo = Number(m[2]);
      if (!d || !mo || d > 31 || mo > 12) return false;
      const y = now.getFullYear();
      let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (iso < base) iso = `${y + 1}-${iso.slice(5)}`;
      due = iso;
    });

  // A time on its own means today, or tomorrow if that time has passed.
  // (Assigned inside callbacks, so read it back with its declared type.)
  const at = time as string | null;
  if (at && !due) {
    const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    due = at > nowHM ? base : addDays(base, 1);
  }

  return { title: text.replace(/\s+/g, " ").trim(), due, time, priority };
}
