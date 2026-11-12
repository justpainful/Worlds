import { afterAll, describe, expect, it } from "vitest";
import dictionary from "./ar.json";
import { countedNoun, loadDictionary, resolveUiLanguage, translate } from "./ui";

describe("Arabic interface dictionary", () => {
  afterAll(() => loadDictionary(dictionary as Record<string, string>));

  it("chooses Arabic only when asked or when the system is Arabic", () => {
    expect(resolveUiLanguage("ar")).toBe("ar");
    expect(resolveUiLanguage("en")).toBe("en");
  });

  it("translates exact text and ignores surrounding white space", () => {
    loadDictionary({ Save: "حفظ", "Move to Trash": "نقل إلى سلة المهملات" });
    expect(translate("Save")).toBe("حفظ");
    expect(translate("  Move   to Trash \n")).toBe("نقل إلى سلة المهملات");
    expect(translate("Unknown words")).toBeNull();
    expect(translate("123")).toBeNull();
  });

  it("fills patterns and translates their parts when it can", () => {
    loadDictionary({ "§{0} pages": "{0} صفحات", "§Moved {0} to {1}": "نُقل {0} إلى {1}", Trash: "سلة المهملات", "§Untitled {0}": "{0} بلا عنوان", drawing: "رسم" });
    expect(translate("12 pages")).toBe("12 صفحة"); // 11 and up take the singular
    expect(translate("Moved Notes to Trash")).toBe("نُقل Notes إلى سلة المهملات");
    expect(translate("Untitled drawing")).toBe("رسم بلا عنوان");
  });

  it("drops English plural endings and still matches the singular", () => {
    loadDictionary({ "§{0} page{1}": "{0} صفحة{1}" });
    expect(translate("3 pages")).toBe("3 صفحات");
    expect(translate("1 page")).toBe("صفحة واحدة");
    expect(translate("pages")).toBeNull();
    // A count pattern must not swallow a whole sentence.
    expect(translate("Plan my week from my pages")).toBeNull();
  });

  it("prefers the most specific pattern", () => {
    loadDictionary({ "§{0} items": "{0} عناصر", "§{0} items selected": "تم تحديد {0} عناصر" });
    expect(translate("3 items selected")).toBe("تم تحديد 3 عناصر");
  });

  it("keeps placeholders in every pattern of the real dictionary", () => {
    for (const [en, ar] of Object.entries(dictionary as Record<string, string>)) {
      if (!en.startsWith("§")) continue;
      const want = (en.match(/\{\d\}/g) ?? []).sort().join();
      expect((ar.match(/\{\d\}/g) ?? []).sort().join(), en).toBe(want);
    }
  });

  it("translates counts and labels added for the exhibition with the real dictionary", () => {
    loadDictionary(dictionary as Record<string, string>);
    expect(translate("1 step")).toBe("خطوة واحدة");
    expect(translate("3 steps")).toBe("3 خطوات");
    expect(translate("10 pts")).toBe("10 نقاط");
    expect(translate("Exam Tomorrow")).toBe("الاختبار غدًا");
    expect(translate("Daily · 2.3 MB")).toBe("نسخة يومية · 2.3 MB");
    expect(translate("the bot host over SSH · Components V2")).toBe("جهاز البوت عبر SSH · Components V2");
    // Short count patterns must not swallow ordinary sentences.
    expect(translate("Next step: review the draft")).toBeNull();
  });

  it("keeps plural slots to plural endings or a punctuated aside", () => {
    loadDictionary(dictionary as Record<string, string>);
    expect(translate("3 subpages")).toBe("3 صفحات فرعية");
    expect(translate("1 subpage")).toBe("صفحة فرعية واحدة");
    // Before, "{0} subpage{1}" took the rest of this sentence as its plural ending.
    expect(translate("No subpages yet. Pages you create here stay organized under “Weekly plan”.")).toBe(
      "لا توجد صفحات فرعية بعد. الصفحات التي تنشئها هنا تبقى منظمة تحت «Weekly plan».",
    );
    expect(translate("The last check found a problem: disk full. Restore the newest backup below, or keep working and back up now.")).toMatch(/^وجد آخر فحص مشكلة: disk full\./);
    expect(translate("The last check found a problem. Restore the newest backup below, or keep working and back up now.")).toMatch(/^وجد آخر فحص مشكلة\./);
  });

  it("makes the noun after a count agree with it, as Arabic does", () => {
    loadDictionary(dictionary as Record<string, string>);
    expect(translate("3 pages")).toBe("3 صفحات");
    expect(translate("1 page")).toBe("صفحة واحدة");
    expect(translate("12 pages")).toBe("12 صفحة");
    expect(translate("3 classes today")).toBe("3 حصص اليوم");
    expect(translate("Replaced 4 matches")).toBe("استُبدلت 4 نتائج");
    expect(translate("4 subpages")).toBe("4 صفحات فرعية");
    expect(translate("10 pts")).toBe("10 نقاط");
    expect(translate("1 task for today")).toBe("مهمة واحدة لليوم");
    expect(translate("3 tasks for today")).toBe("3 مهام لليوم");
    expect(translate("2 tasks for today")).toBe("مهمتان لليوم");
    expect(translate("2 subpages")).toBe("صفحتان فرعيتان");
    expect(translate("1 item left today")).toBe("المتبقي اليوم: عنصر واحد");
    expect(translate("expires in 2 days")).toBe("تنتهي بعد يومين");
    expect(translate("2 changes will sync when you are back online")).toBe("ستتم مزامنة تغييرين عند عودة الاتصال");
    expect(translate("Sending 2 changes")).toBe("جارٍ إرسال تغييرين");
    expect(translate("1 min read")).toBe("قراءة دقيقة واحدة");
    expect(translate("2 min read")).toBe("قراءة دقيقتين");
    expect(translate("5 characters")).toBe("5 أحرف");
    expect(translate("Adding 2 files")).toBe("جارٍ إضافة ملفين");
    expect(translate("3 changes")).toBe("3 تغييرات");
    expect(translate("12 pictures")).toBe("12 صورة");
    expect(translate("4 handed in")).toBe("المُسلَّمة: 4");
    expect(translate("About 1,500 words written")).toBe("كتبت نحو 1,500 كلمة");
    expect(translate("2 instructions")).toBe("تعليمتان");
    expect(translate("14 blocks")).toBe("14 كتلة");
    expect(translate("2.5 pts")).toBe("2.5 نقطة");
    expect(translate("18/20 pts")).toBe("18/20 نقطة");
    expect(translate("5 edits in the last 7 days")).toBe("5 تعديلات في آخر 7 أيام");
    expect(translate("Since October 2026")).toBe("منذ October 2026");
    expect(translate("Deleted قبل ساعتين")).toBe("حُذف قبل ساعتين");
    expect(translate("Join فريق المختبر")).toBe("الانضمام إلى فريق المختبر");
    expect(translate("Showing the first 2,000 of 5,000 rows")).toBe("يُعرض أول 2,000 صف من 5,000");
    expect(translate("1,204 words · 6 min read")).toBe("1,204 كلمات · قراءة 6 دقائق");
    expect(translate("2 items left today")).toBe("المتبقي اليوم: عنصران");
    expect(countedNoun(4000, "أحرف")).toBe("حرف");
    expect(countedNoun(103, "صفحة")).toBe("صفحات");
    expect(countedNoun(5, "كتاب")).toBe("كتاب");
  });

  it("has no dashes the interface rules forbid", () => {
    for (const ar of Object.values(dictionary as Record<string, string>)) expect(ar).not.toMatch(/[–—]/);
  });
});
