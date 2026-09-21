/* ============================================================================
 * services/format.js — قالب‌بندی فارسی
 * ----------------------------------------------------------------------------
 * قاعده بنیادی: مقدار متعارف در پایگاه داده عدد است (تومان، BIGINT).
 * رشته فارسیِ قالب‌بندی‌شده هرگز ذخیره نمی‌شود — چون نه جمع‌پذیر است،
 * نه مرتب‌شدنی، نه قابل مقایسه.
 *
 * تبدیل فقط در لحظه نمایش انجام می‌شود، و در جهت مخالف، ورودی کاربر
 * پیش از اعتبارسنجی به رقم انگلیسی نرمال می‌شود.
 * ==========================================================================*/

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** رقم‌های انگلیسی را فارسی می‌کند (فقط برای نمایش). */
export function faDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** رقم‌های فارسی/عربی را انگلیسی می‌کند (برای ذخیره و محاسبه). */
export function toEnglishDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = PERSIAN_DIGITS.indexOf(d);
    if (fa !== -1) return String(fa);
    return String(ARABIC_DIGITS.indexOf(d));
  });
}

/**
 * مبلغ تومان را برای نمایش قالب‌بندی می‌کند.
 * ۱۲۵۰۰۰۰۰ → «۱۲٬۵۰۰٬۰۰۰ تومان»
 */
export function formatToman(amount, { withUnit = true } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const grouped = faDigits(Math.round(n).toLocaleString('en-US')).replace(/,/g, '٬');
  return withUnit ? `${grouped} تومان` : grouped;
}

/**
 * تاریخ شمسی برای نمایش.
 * از Intl خود Node استفاده می‌کند تا وابستگی اضافه نداشته باشیم.
 * زمان متعارف همیشه UTC در پایگاه داده می‌ماند؛ این فقط نمایش است.
 */
export function formatJalali(value, { withTime = false } = {}) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const opts = {
    calendar: 'persian', timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  };
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', opts).format(d);
}

/**
 * نرمال‌سازی متن فارسی برای جست‌وجو و ذخیره‌سازی یکدست.
 * ی/ي، ک/ك، ه/ة، نیم‌فاصله، اعراب و کشیده را یکسان می‌کند.
 */
export function normalizePersian(value) {
  return toEnglishDigits(String(value ?? ''))
    .replace(/[يیى]/g, 'ی')  // انواع ی → ی فارسی
    .replace(/[كک]/g, 'ک')        // انواع ک → ک فارسی
    .replace(/ة/g, 'ه')                // ة → ه
    .replace(/[ً-ْٰ]/g, '')       // اعراب
    .replace(/ـ/g, '')                      // کشیده
    .replace(/‌/g, ' ')                     // نیم‌فاصله → فاصله
    .replace(/\s+/g, ' ')
    .trim();
}

/** شماره موبایل ایران را به شکل 09xxxxxxxxx در می‌آورد؛ نامعتبر باشد null. */
export function normalizeMobile(value) {
  let v = toEnglishDigits(value).replace(/[\s()\-]/g, '');
  if (v.startsWith('+98')) v = '0' + v.slice(3);
  else if (v.startsWith('0098')) v = '0' + v.slice(4);
  else if (v.startsWith('98') && v.length === 12) v = '0' + v.slice(2);
  else if (/^9\d{9}$/.test(v)) v = '0' + v;
  return /^09\d{9}$/.test(v) ? v : null;
}

/** کد پستی ایران: دقیقا ۱۰ رقم. به‌صورت متن نگه داشته می‌شود (صفر ابتدایی مهم است). */
export function normalizePostalCode(value) {
  const v = toEnglishDigits(value).replace(/[\s\-]/g, '');
  return /^\d{10}$/.test(v) ? v : null;
}
