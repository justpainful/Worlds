import {SvgError,svgErrorMessage} from "./svg";
import { Button } from "../ui/Button";
import { errorMessage } from "../lib/api";
import { PixelEditError,type PixelAction,type PixelEditAction,type PixelSampleSource } from "./floatingPixels";
import { ObjectTransformError } from "./objectTransforms";
import { ImageHeaderError } from "./imageHeaders";
export function pixelEditMessage(error:unknown,arabic:boolean):string{
  if(error instanceof SvgError)return svgErrorMessage(error.code,arabic);
  if(error instanceof ImageHeaderError)return({size:arabic?"حجم ملف الصورة يتجاوز 256 ميجابايت.":"The encoded image exceeds 256 MiB.",dimensions:arabic?"أبعاد الصورة غير صالحة أو تتجاوز 64 مليون بكسل.":"The image dimensions are invalid or exceed 64 million pixels.",format:arabic?"صيغة الصورة غير مدعومة أو لا تطابق محتواها.":"The image format is unsupported or does not match its contents.",truncated:arabic?"ملف الصورة غير مكتمل.":"The image file is incomplete.",animation:arabic?"الصورة المتحركة غير صالحة أو تتجاوز حدود المعالجة (1000 لقطة و256 مليون بكسل إجمالًا).":"The animated image is invalid or exceeds the processing limits (1000 frames and 256 million total pixels)."})[error.code];
  if(error instanceof ObjectTransformError&&arabic)return error.code==="dimensions"?"أدخل أبعادًا موجبة لا تتجاوز مليار بكسل.":"أدخل قيم تحويل صحيحة.";
  if(error instanceof PixelEditError)return({redaction:arabic?"يتقاطع التحديد مع تنقيح معتم. استخدم نسخ الطبقات الظاهرة لنسخة آمنة، أو أداة العناصر لتحرير التنقيح.":"This selection intersects opaque redaction. Copy visible layers for a safe flattened copy, or edit redactions with the object tool.",empty:arabic?"لا توجد بكسلات مرئية في التحديد والمصدر المختار.":"There are no visible pixels in this selection and source.",locked:arabic?"يتضمن المصدر عناصر مقفلة أو طبقة مقفلة للشفافية. اختر مصدرًا قابلًا للتحرير.":"The source contains locked elements or an alpha-locked layer. Choose an editable source.",stale:arabic?"تغيّرت بكسلات المصدر أو أبعاد الإطار. ألغِ المعاينة وأعد العملية.":"The source pixels or frame dimensions changed. Cancel the preview and try again.",invalid:arabic?"بيانات التحديد غير صالحة.":"The selection data is invalid."})[error.code];
  const message=errorMessage(error);
  if(arabic&&message==="This drawing is read-only")return"لم تعد لديك صلاحية تعديل هذا الرسم.";
  if(arabic&&message==="The pixel selection reservation was lost")return"فُقد حجز طبقات المصدر. ألغِ المعاينة وأعد المحاولة.";
  if(arabic&&message==="Image clipboard reading is unavailable in this window")return"قراءة صور الحافظة غير متاحة في هذه النافذة. استخدم إضافة صورة من ملف.";
  if(arabic&&message==="Static animation frames are unavailable in this window")return"اختيار لقطات الصور المتحركة غير متاح في هذه النافذة. استخدم صورة ثابتة أو نافذة تدعم معالجة الصور المتحركة.";
  if(arabic&&message==="The clipboard contains no supported image")return"لا توجد صورة PNG أو JPEG أو WebP أو BMP في الحافظة.";
  if(arabic&&error instanceof DOMException&&error.name==="NotAllowedError")return"تعذر الوصول إلى الحافظة. تحقق من إذن النافذة للحافظة.";
  return message;
}
export function PixelSelectionActions(p:{arabic:boolean;canEdit:boolean;available:boolean;busy:boolean;saving:boolean;completed:PixelEditAction|null;sourceLocked?:boolean;source:PixelSampleSource;setSource:(source:PixelSampleSource)=>void;run:(action:PixelAction)=>void;cancel:()=>void;error:unknown}){
  const t=(en:string,ar:string)=>p.arabic?ar:en;
  return <section className="drawing-pixel-actions" aria-label={t("Edit selected pixels","تحرير البكسلات المحددة")}>
    <label className="drawing-field"><span>{t("Pixel source","مصدر البكسلات")}</span><select disabled={p.busy||p.sourceLocked} value={p.source} onChange={e=>p.setSource(e.target.value as PixelSampleSource)}><option value="current">{t("Current layer","الطبقة الحالية")}</option><option value="visible">{t("Visible layers","الطبقات الظاهرة")}</option></select></label>
    <p className="drawing-selection-help">{t("Frame background is excluded. Move and duplicate create a separate layer. Erasing pixels preserves the original elements.","لا تشمل العينة خلفية الإطار. النقل والتكرار ينشئان طبقة مستقلة. مسح البكسلات يحتفظ بالعناصر الأصلية.")}</p>
    <div className="drawing-step-actions">{([
      ["move","Move pixels","نقل البكسلات"],["duplicate","Duplicate pixels","تكرار البكسلات"],["copy","Copy pixels","نسخ البكسلات"],["cut","Cut pixels","قص البكسلات"],["delete","Delete pixels","حذف البكسلات"],
    ]as const).map(([action,en,ar])=><Button key={action} size="compact" disabled={!p.available||p.busy||action!=="copy"&&!p.canEdit} onClick={()=>p.run(action)}>{t(en,ar)}</Button>)}</div>
    {p.busy&&<><p role="status">{p.saving?t("Saving selected pixels","جارٍ حفظ البكسلات المحددة"):t("Preparing selected pixels","جارٍ تجهيز البكسلات المحددة")}</p>{!p.saving&&<Button size="compact" onClick={p.cancel}>{t("Cancel pixel operation","إلغاء عملية البكسلات")}</Button>}</>}
    {!!p.error&&<p role="alert">{pixelEditMessage(p.error,p.arabic)}</p>}
    {!p.busy&&!p.error&&p.completed&&<p role="status">{p.completed==="copy"?t("Selected pixels copied to the clipboard as PNG.","نُسخت البكسلات المحددة إلى الحافظة بصيغة PNG."):p.completed==="cut"?t("Pixels copied and erased. One Undo restores the drawing.","نُسخت البكسلات ومسحت من الرسم. تراجع واحد يعيد الرسم."):p.completed==="delete"?t("Pixels erased. Original elements remain intact.","مُسحت البكسلات، وبقيت العناصر الأصلية محفوظة."):t("Pixel edit applied.","طُبق تعديل البكسلات.")}</p>}
  </section>;
}
