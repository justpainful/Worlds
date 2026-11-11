<div dir="rtl">

# Worlds

مساحة عمل محلية أولًا للصفحات والمستندات والجداول والرسم والدراسة. بياناتك تبقى على جهازك، والحساب والمزامنة اختياريان.

<p>
<img src="docs/releases/v0.2.0/windows.jpg" height="150" alt="ويندوز">
<img src="docs/releases/v0.2.0/macos.png" height="150" alt="ماك">
<img src="docs/releases/v0.2.0/ipad.png" height="150" alt="آيباد">
<img src="docs/releases/v0.2.0/iphone.png" height="150" alt="آيفون">
<img src="docs/releases/v0.2.0/android.png" height="150" alt="أندرويد">
</p>

## المنصات وحالتها

| المنصة | الحالة |
| :--- | :--- |
| ويندوز | الأكمل: الصفحات والمستندات والجداول والرسم وأدوات الطالب والذكاء عبر Claude Code |
| أندرويد وكروم بوك | تجريبي: الصفحات والرسم والجداول تعمل، والذكاء وشاشات الدراسة ما زالت ناقصة |
| آيفون وآيباد وماك | تجريبي: الواجهات الأساسية تعمل، والذكاء وأجزاء من الرسم ما زالت ناقصة |

التفاصيل الصادقة لكل ميزة في [مصفوفة أبل](docs/apple-native/FEATURE_PARITY_MATRIX.md) و[مصفوفة أندرويد](docs/android-native/FEATURE_PARITY_MATRIX.md).

## التحميل والتثبيت

حمّل آخر إصدار من [صفحة الإصدارات](https://github.com/justpainful/Worlds/releases/latest). الملفات غير موقّعة رقميًا:

- **ويندوز:** شغّل المثبّت، وإذا ظهر تحذير اختر More info ثم Run anyway.
- **أندرويد:** افتح ملف APK واسمح بالتثبيت من هذا المصدر. الملف موقّع بمفتاح تطوير.
- **آيفون وآيباد:** وقّع ملف IPA وثبّته بأداة مثل SideStore أو AltStore أو Sideloadly.
- **ماك:** انقل التطبيق إلى Applications، وافتحه أول مرة بالزر الأيمن ثم Open.

## البناء من المصدر

- **ويندوز:** Node 22 وpnpm وRust، ثم `pnpm install` و`pnpm tauri dev`.
- **أندرويد:** JDK 17 وAndroid SDK، ثم من مجلد `Android` شغّل `gradlew assembleDebug`.
- **أبل:** على ماك مع Xcode وXcodeGen، شغّل `xcodegen` داخل `Apple` ثم افتح المشروع.

## الرخصة

لم تُحدَّد بعد.

</div>

---

# Worlds (English)

A local-first workspace for pages, documents, spreadsheets, drawing and study. Your data stays on your device; accounts and sync are optional.

## Platforms and status

| Platform | Status |
| :--- | :--- |
| Windows | Most complete: pages, documents, spreadsheets, drawing, study tools, and AI through Claude Code |
| Android and ChromeOS | Preview: pages, drawing and spreadsheets work; AI and study screens are incomplete |
| iPhone, iPad and Mac | Preview: core views work; AI and parts of drawing are incomplete |

Feature by feature status: [Apple matrix](docs/apple-native/FEATURE_PARITY_MATRIX.md), [Android matrix](docs/android-native/FEATURE_PARITY_MATRIX.md).

## Download and install

Get the latest build from the [releases page](https://github.com/justpainful/Worlds/releases/latest). Builds are not code-signed: on Windows choose More info, then Run anyway; the Android APK uses a development key; IPA files must be signed with a tool such as SideStore, AltStore or Sideloadly; on Mac open the app the first time with right click, then Open.

## Build from source

- **Windows:** Node 22, pnpm and Rust, then `pnpm install` and `pnpm tauri dev`.
- **Android:** JDK 17 and the Android SDK, then `gradlew assembleDebug` in `Android`.
- **Apple:** on a Mac with Xcode and XcodeGen, run `xcodegen` in `Apple` and open the project.

## License

To be decided.
