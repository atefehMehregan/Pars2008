/* ============================================================================
 * services/password.js — هش کردن رمز با Argon2id
 * ----------------------------------------------------------------------------
 * پیاده‌سازی: @node-rs/argon2.
 *
 * چرا این و نه بستهٔ argon2؟ چون باینری از پیش ساخته‌شده می‌آورد و به
 * node-gyp و زنجیرهٔ ابزار ساخت نیاز ندارد. سرور مقصد Windows است و
 * وابستگی بومیِ نیازمند کامپایل، همان‌جایی است که استقرار می‌شکند.
 * الگوریتم و پارامترها همان‌اند؛ فقط پیاده‌سازی عوض شده است.
 *
 * این تنها جایی است که پروژه به بستهٔ رمزنگاری رمز وابسته است. هیچ کد
 * دیگری نباید مستقیم آن را import کند، تا اگر روزی پیاده‌سازی عوض شد فقط
 * همین فایل تغییر کند.
 * ==========================================================================*/
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { config } from '../config/index.js';

/** پارامترهای Argon2id — از config می‌آیند، مطابق راهنمای OWASP. */
function options() {
  return {
    algorithm: Algorithm.Argon2id,
    memoryCost: config.argon.memoryCost,
    timeCost: config.argon.timeCost,
    parallelism: config.argon.parallelism,
  };
}

/**
 * هش کردن رمز.
 * نمک تصادفی را خود کتابخانه می‌سازد، پس دو بار هش کردن یک رمز دو نتیجهٔ
 * متفاوت می‌دهد — که درست است.
 * @param {string} plain
 * @returns {Promise<string>} رشتهٔ هش به قالب استاندارد PHC
 */
export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('رمز خالی قابل هش کردن نیست.');
  }
  return argonHash(plain, options());
}

/**
 * سنجش رمز با هش ذخیره‌شده.
 *
 * نکتهٔ مهم: verify در @node-rs/argon2 وقتی رشتهٔ هش خراب یا نامعتبر باشد
 * *استثنا پرتاب می‌کند*، نه اینکه false برگرداند. اگر این را نگیریم، یک
 * سطر خراب در پایگاه داده به خطای ۵۰۰ تبدیل می‌شود و رفتار ورود را لو
 * می‌دهد. پس هر شکستی — چه رمز غلط، چه هش خراب — یکسان false است.
 *
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(storedHash, plain) {
  if (typeof storedHash !== 'string' || typeof plain !== 'string') return false;
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}

/* ----------------------------------------------------- سنجش ساختگی -------
 * وقتی حسابی با آن ایمیل وجود ندارد، باز هم یک سنجش واقعی انجام می‌دهیم.
 * بدون این، پاسخِ «حساب نیست» به‌اندازهٔ چند ده میلی‌ثانیه سریع‌تر از
 * «رمز غلط» برمی‌گردد و همان تفاوت زمان، وجود یا نبودِ حساب را لو می‌دهد.
 *
 * هش یک بار هنگام بار شدن ماژول ساخته می‌شود؛ مقدارش بی‌اهمیت است و هرگز
 * با چیزی مطابقت نمی‌کند.
 * ------------------------------------------------------------------------*/
let dummyHashPromise = null;

function dummyHash() {
  if (!dummyHashPromise) {
    const filler = 'x'.repeat(32);
    dummyHashPromise = argonHash(filler, options());
  }
  return dummyHashPromise;
}

/**
 * یک سنجش ساختگی انجام می‌دهد و همیشه false می‌دهد.
 * فقط برای یکسان کردن زمان پاسخ در مسیر «حساب پیدا نشد».
 */
export async function verifyDummy(plain) {
  try {
    await argonVerify(await dummyHash(), typeof plain === 'string' ? plain : '');
  } catch {
    /* بی‌اهمیت — هدف فقط صرف کردن همان زمان است. */
  }
  return false;
}

/** برای گزارش و بررسی محیط. */
export function passwordAlgorithmInfo() {
  return {
    algorithm: 'argon2id',
    implementation: '@node-rs/argon2',
    memoryCostKiB: config.argon.memoryCost,
    timeCost: config.argon.timeCost,
    parallelism: config.argon.parallelism,
  };
}
