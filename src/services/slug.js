/* ============================================================================
 * services/slug.js — نشانی‌های فارسی
 * ----------------------------------------------------------------------------
 * نشانی‌ها فارسی می‌مانند: /category/لوازم-ترمز
 *
 * چرا نه حرف‌نویسی (transliteration)؟ چون هیچ نگاشت درست و یکتایی از فارسی
 * به لاتین وجود ندارد، هر کتابخانه‌ای نتیجهٔ متفاوتی می‌دهد، و نشانی حاصل
 * نه برای کاربر فارسی‌زبان خواناست نه برای موتور جست‌وجو معنادار. نشانی
 * فارسی در مرورگر درست نمایش داده می‌شود و فقط روی سیم percent-encode است.
 *
 * نکتهٔ کلیدی: نرمال‌سازی باید *یکسان* روی هر دو سمت اعمال شود — هنگام
 * ساختن نشانی، و هنگام جست‌وجوی آن. وگرنه «کلید» با «كليد» (ک و ی عربی)
 * دو نشانی متفاوت می‌شوند و یکی ۴۰۴ می‌دهد.
 * ==========================================================================*/
import { normalizePersian } from './format.js';

/* نویسه‌های مجاز در نشانی: حروف فارسی/عربی، حروف لاتین، رقم، و خط تیره.
   بازهٔ ؀-ۿ کل بلوک عربی/فارسی را می‌گیرد. */
const DISALLOWED = /[^؀-ۿa-z0-9-]+/g;

/**
 * ساخت نشانی از یک عنوان.
 * @param {string} value
 * @returns {string} نشانی نرمال‌شده؛ برای ورودی بی‌محتوا رشتهٔ خالی
 */
export function slugify(value) {
  const normalized = normalizePersian(value).toLowerCase();
  return normalized
    .replace(DISALLOWED, '-')   // هر چیز دیگر (فاصله، نقطه، اسلش، …) → خط تیره
    .replace(/-+/g, '-')        // خط تیره‌های پشت سر هم
    .replace(/^-|-$/g, '');     // خط تیرهٔ ابتدا و انتها
}

/**
 * نرمال‌سازی نشانیِ آمده از نشانی اینترنتی، پیش از جست‌وجو در پایگاه داده.
 *
 * Express مقدار req.params را از قبل decode کرده است، ولی همان مقدار ممکن
 * است ی/ک عربی یا رقم فارسی داشته باشد (مثلا وقتی کاربر نشانی را از جایی
 * copy کرده). با عبور دادن از همان slugify، هر دو سمت به یک شکل می‌رسند.
 */
export function normalizeSlugParam(value) {
  if (typeof value !== 'string') return '';
  /* محافظت در برابر ورودی‌های بی‌معنی و بلند پیش از رسیدن به پایگاه داده. */
  if (value.length > 200) return '';
  return slugify(value);
}

/** آیا این رشته یک نشانی معتبر است؟ */
export function isValidSlug(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && slugify(value) === value;
}

/**
 * شمارهٔ فنی (OEM) را برای ذخیره و جست‌وجو یکدست می‌کند.
 * «9678-191-580»، «۹۶۷۸۱۹۱۵۸۰» و «9678 191 580» همگی باید یک چیز شوند،
 * چون مشتری شماره را از روی قطعهٔ کهنه می‌خواند و جداکننده‌ها را حدس می‌زند.
 * @returns {string|null}
 */
export function normalizeOem(value) {
  if (value === null || value === undefined) return null;
  const cleaned = normalizePersian(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.length ? cleaned : null;
}

/**
 * ساخت متن جست‌وجوی یک محصول.
 * نام، شمارهٔ فنی، کد کالا و نام برند در یک رشتهٔ نرمال‌شده جمع می‌شوند تا
 * یک ایندکس سه‌نویسه‌ای همهٔ راه‌های پیدا کردن قطعه را پوشش بدهد.
 */
export function buildSearchText({ name, sku, oemNumber, brandName, shortDescription } = {}) {
  return [name, sku, oemNumber, normalizeOem(oemNumber), brandName, shortDescription]
    .filter(Boolean)
    .map((part) => normalizePersian(part).toLowerCase())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
