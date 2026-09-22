/* ============================================================================
 * services/validate.js — اعتبارسنجی ورودی فرم‌های مدیر
 * ----------------------------------------------------------------------------
 * چرا یک ماژول جدا و نه اعتبارسنجی داخل کنترلر؟
 *
 *   چون اعتبارسنجی منطق خالص است: ورودی می‌گیرد و خطا برمی‌گرداند. جدا
 *   کردنش یعنی می‌شود بدون HTTP، بدون پایگاه داده و بدون نشست آزمودش —
 *   و همان قاعده‌ها بعدا برای هر فرم دیگری هم در دسترس‌اند.
 *
 * قاعده‌ها:
 *   * هر تابع { value, error } برمی‌گرداند؛ هرگز استثنا پرتاب نمی‌کند.
 *   * خطا رشتهٔ فارسیِ آمادهٔ نمایش است، نه کد داخلی.
 *   * فقط فیلدهای *عددی* از toEnglishDigits رد می‌شوند. نام محصول ممکن
 *     است عمدا رقم فارسی داشته باشد («پژو ۲۰۰۸») و دست‌کاری آن خطاست.
 *   * قیدهای پایگاه داده اینجا تکرار می‌شوند تا کاربر پیام روشن ببیند،
 *     ولی قید پایگاه داده همچنان خط آخر دفاع است — نه برعکس.
 * ==========================================================================*/
import { faDigits, toEnglishDigits } from './format.js';
import { slugify } from './slug.js';

/* سقف‌ها. مقدار پول در BIGINT جا می‌شود و بقیه در INTEGER. */
export const LIMITS = {
  MONEY_MAX: 999_999_999_999,
  STOCK_MAX: 1_000_000,
  WEIGHT_MAX: 1_000_000,
  SORT_ORDER_MIN: -10_000,
  SORT_ORDER_MAX: 10_000,
  SLUG_MAX: 200,
};

/* ------------------------------------------------------- نرمال‌سازی ----- */

/** متن تک‌خطی: فاصله‌های پشت سر هم یکی می‌شوند. */
export function cleanText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

/** متن چندخطی: خط‌ها می‌مانند، فقط فاصلهٔ انتهای خط و CRLF پاک می‌شود. */
export function cleanMultiline(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * متن عددی: رقم فارسی/عربی به لاتین، و جداکننده‌های هزارگان حذف.
 * کاربر «۱٬۲۰۰٬۰۰۰» را از جایی copy می‌کند؛ رد کردنش آزاردهنده است.
 */
export function cleanNumeric(raw) {
  if (raw === null || raw === undefined) return '';
  return toEnglishDigits(String(raw)).replace(/[\s,٬_]/g, '').trim();
}

/* --------------------------------------------------------- سنجه‌ها ------ */

/** متن الزامی. */
export function requiredText(raw, { label, min = 1, max = 200, multiline = false } = {}) {
  const value = multiline ? cleanMultiline(raw) : cleanText(raw);
  if (!value) return { value: '', error: `${label} الزامی است.` };
  if (value.length < min) {
    return { value, error: `${label} باید دست‌کم ${faDigits(min)} نویسه باشد.` };
  }
  if (value.length > max) {
    return { value, error: `${label} نباید بیشتر از ${faDigits(max)} نویسه باشد.` };
  }
  return { value, error: null };
}

/** متن اختیاری. خالی یعنی null، نه رشتهٔ خالی — تا در پایگاه داده NULL بماند. */
export function optionalText(raw, { label, max = 200, multiline = false } = {}) {
  const value = multiline ? cleanMultiline(raw) : cleanText(raw);
  if (!value) return { value: null, error: null };
  if (value.length > max) {
    return { value, error: `${label} نباید بیشتر از ${faDigits(max)} نویسه باشد.` };
  }
  return { value, error: null };
}

/** عدد درست. */
export function integer(raw, { label, required = true, min = null, max = null } = {}) {
  const text = cleanNumeric(raw);
  if (!text) {
    return required
      ? { value: null, error: `${label} الزامی است.` }
      : { value: null, error: null };
  }
  if (!/^-?\d+$/.test(text)) {
    return { value: null, error: `${label} باید عدد درست باشد.` };
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    return { value: null, error: `${label} خارج از محدودهٔ مجاز است.` };
  }
  if (min !== null && n < min) {
    return { value: n, error: `${label} نباید کمتر از ${faDigits(min)} باشد.` };
  }
  if (max !== null && n > max) {
    return { value: n, error: `${label} نباید بیشتر از ${faDigits(max)} باشد.` };
  }
  return { value: n, error: null };
}

/** مبلغ به تومان. همیشه عدد درستِ نامنفی. */
export function money(raw, { label, required = true } = {}) {
  return integer(raw, { label, required, min: 0, max: LIMITS.MONEY_MAX });
}

/** ارجاع به شناسهٔ یک ردیف دیگر. */
export function idRef(raw, { label, required = false } = {}) {
  return integer(raw, { label, required, min: 1, max: Number.MAX_SAFE_INTEGER });
}

/**
 * چک‌باکس HTML: نبودن یعنی خاموش. فقط «حضور» معنا دارد، پس هر مقدارِ
 * غیرِ خاموشِ آشکار، روشن حساب می‌شود.
 */
export function checkbox(raw) {
  if (raw === undefined || raw === null || raw === false) return false;
  const v = String(raw).trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off';
}

/** یکی از مقدارهای مجاز. فهرست سفید، نه سیاه. */
export function oneOf(raw, allowed, { label, required = true, fallback = null } = {}) {
  const value = cleanText(raw);
  if (!value) {
    return required
      ? { value: null, error: `${label} الزامی است.` }
      : { value: fallback, error: null };
  }
  if (!allowed.includes(value)) return { value: null, error: `${label} معتبر نیست.` };
  return { value, error: null };
}

/**
 * نشانی (slug).
 * اگر کاربر چیزی ننوشته باشد، از روی نام ساخته می‌شود. اگر نوشته باشد،
 * همان از slugify رد می‌شود تا «لوازم ترمز» بی‌سروصدا «لوازم-ترمز» شود.
 * رد کردنِ ورودیِ قابلِ اصلاح، آزار است نه دقت.
 */
export function slugField(raw, fallbackSource, { label = 'نشانی', max = LIMITS.SLUG_MAX } = {}) {
  const typed = cleanText(raw);
  const source = typed || String(fallbackSource ?? '');
  const value = slugify(source);
  if (!value) {
    return { value: '', error: `${label} معتبر نیست و از روی نام هم ساخته نشد.` };
  }
  if (value.length > max) {
    return { value, error: `${label} نباید بیشتر از ${faDigits(max)} نویسه باشد.` };
  }
  return { value, error: null };
}

/**
 * قاعدهٔ بین-فیلدیِ قیمت فروش ویژه.
 * قید پایگاه داده products_sale_below_price اکیدا «کمتر» می‌خواهد، پس
 * برابری هم رد می‌شود — وگرنه کاربر با پیام مبهم پایگاه داده روبه‌رو می‌شد.
 * @returns {string|null} پیام خطا، یا null اگر مشکلی نیست
 */
export function salePriceRule(salePrice, price, { label = 'قیمت فروش ویژه' } = {}) {
  if (salePrice === null || salePrice === undefined) return null;
  if (price === null || price === undefined) return null;
  if (salePrice >= price) return `${label} باید کمتر از قیمت اصلی باشد.`;
  return null;
}

/* ---------------------------------------------------- جمع‌کنندهٔ خطا ---- */

/**
 * خطاها را به تفکیک فیلد جمع می‌کند.
 * اولین خطای هر فیلد می‌ماند: کاربر یک پیام روشن می‌خواهد، نه فهرستی از
 * پیام‌های پشت سر هم برای یک کادر.
 */
export function createFieldErrors() {
  const errors = {};

  /** نتیجهٔ یک سنجه را می‌گیرد، خطایش را ثبت و مقدارش را برمی‌گرداند. */
  function take(field, result) {
    if (result.error && !(field in errors)) errors[field] = result.error;
    return result.value;
  }

  function add(field, message) {
    if (message && !(field in errors)) errors[field] = message;
  }

  const has = (field) => field in errors;
  const ok = () => Object.keys(errors).length === 0;

  return { take, add, has, ok, errors };
}
