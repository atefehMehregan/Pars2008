/* ============================================================================
 * services/storage.js — لایهٔ ذخیره‌سازی فایل
 * ----------------------------------------------------------------------------
 * تنها جایی که بایت‌های تصویرِ محصول روی «جایی» نوشته می‌شوند.
 *
 * هشدار عملیاتی — این را جدی بگیرید:
 *
 *   پیاده‌سازی فعلی، فایل‌سیستم محلی است و برای *توسعه و پیش‌نمایش* است،
 *   نه ذخیره‌سازی بادوامِ تولید. روی میزبانی با فایل‌سیستم ناپایدار
 *   (مثل کانتینری که با هر استقرار از نو ساخته می‌شود) این فایل‌ها از
 *   بین می‌روند، در حالی که ردیف‌های product_images در پایگاه داده
 *   می‌مانند — یعنی ارجاع شکسته. انتخاب ذخیره‌سازی بادوام یک تصمیم
 *   جداگانه و بعدی است و عمدا اینجا گرفته نشده.
 *
 * قرارداد این ماژول طوری است که جایگزینی‌اش (هر چیزی که روزی انتخاب شود)
 * فقط همین فایل را عوض کند:
 *
 *   putOriginal(imageId, buffer, format)      اصلِ دست‌نخورده، خصوصی
 *   putDerivative(imageId, name, ext, buffer) مشتقِ پردازش‌شده، عمومی
 *   removeImage(imageId)                      همهٔ فایل‌های یک تصویر
 *   publicUrl(imageId, name, ext)             نشانی عمومی مشتق
 *   hasImage(imageId)                         برای بررسی و نظافت
 *
 * قاعده‌ها:
 *   * هیچ مصرف‌کننده‌ای مسیر نمی‌سازد. فقط شناسه می‌دهد.
 *   * نام فایلِ فرستاده‌شدهٔ کاربر هرگز به اینجا نمی‌رسد؛ شناسه را سرور
 *     می‌سازد (UUID) و همین ماژول دوباره اعتبارش را می‌سنجد.
 *   * همهٔ متدها async‌اند تا پیاده‌سازی شبکه‌ای بعدا جایگزین شود.
 *   * هیچ نوعِ HTTP یا multipart از این مرز رد نمی‌شود — فقط Buffer و رشته.
 * ==========================================================================*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';

/* شناسهٔ تصویر همیشه UUID نسخه ۴ است که crypto.randomUUID ساخته. هر چیز
   دیگری یعنی ردیف خراب یا دست‌کاری — و نباید به مسیر فایل تبدیل شود. */
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* نام مشتق و پسوند هم از فهرست سفیدِ نویسه می‌گذرند. این‌ها از پیکربندی
   می‌آیند نه از کاربر، ولی دفاع در عمق ارزان است. */
const SAFE_NAME = /^[a-z0-9]{1,16}$/;
const SAFE_EXT = /^[a-z0-9]{1,5}$/;

export function assertImageId(imageId) {
  if (typeof imageId !== 'string' || !IMAGE_ID.test(imageId)) {
    throw new Error('شناسهٔ تصویر معتبر نیست.');
  }
  return imageId;
}

function assertPart(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} معتبر نیست.`);
  }
  return value;
}

/**
 * ساخت لایهٔ ذخیره‌سازی محلی.
 *
 * @param {object} [dirs] مسیرها. پیش‌فرض از config می‌آید؛ آزمون‌ها یک
 *   پوشهٔ موقت می‌دهند تا چیزی در storage واقعی نوشته نشود.
 */
export function createLocalStorage({
  originalsDir = config.storage.originals,
  productsDir = config.storage.products,
} = {}) {
  /** پوشهٔ مشتق‌های یک تصویر. */
  const imageDir = (imageId) => path.join(productsDir, assertImageId(imageId));

  /**
   * ذخیرهٔ اصل. بیرون از درخت عمومی می‌ماند و هرگز استاتیک سرو نمی‌شود.
   * @param {string} format قالبِ تشخیص‌دادهٔ sharp — نه پسوند نام کاربر
   */
  async function putOriginal(imageId, buffer, format) {
    assertImageId(imageId);
    assertPart(format, SAFE_EXT, 'قالب تصویر');
    await fs.mkdir(originalsDir, { recursive: true });
    const target = path.join(originalsDir, `${imageId}.${format}`);
    await fs.writeFile(target, buffer);
    return target;
  }

  /** ذخیرهٔ یک مشتق. این‌ها عمدا عمومی‌اند (واترمارک‌خورده). */
  async function putDerivative(imageId, name, ext, buffer) {
    assertImageId(imageId);
    assertPart(name, SAFE_NAME, 'نام اندازه');
    assertPart(ext, SAFE_EXT, 'پسوند');
    const dir = imageDir(imageId);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${name}.${ext}`);
    await fs.writeFile(target, buffer);
    return target;
  }

  /**
   * پاک کردن همهٔ فایل‌های یک تصویر: پوشهٔ مشتق‌ها و فایل اصل.
   *
   * بی‌اثرپذیر (idempotent) است: نبودِ فایل خطا نیست. این عمدی است، چون
   * این تابع در مسیر نظافت صدا زده می‌شود و باید بتواند بعد از یک شکستِ
   * نیمه‌کاره دوباره اجرا شود.
   *
   * @returns {Promise<{derivatives:boolean, original:boolean}>} چه چیزی واقعا پاک شد
   */
  async function removeImage(imageId) {
    assertImageId(imageId);
    const result = { derivatives: false, original: false };

    try {
      await fs.rm(imageDir(imageId), { recursive: true, force: true });
      result.derivatives = true;
    } catch (err) {
      console.error('[storage] پاک کردن مشتق‌ها شکست خورد:', err.code || err.message);
    }

    /* پسوند اصل به قالب فایل بستگی دارد، پس با پیشوند پیدایش می‌کنیم. */
    try {
      const entries = await fs.readdir(originalsDir).catch(() => []);
      for (const name of entries) {
        if (name.startsWith(`${imageId}.`)) {
          await fs.rm(path.join(originalsDir, name), { force: true });
          result.original = true;
        }
      }
    } catch (err) {
      console.error('[storage] پاک کردن اصل شکست خورد:', err.code || err.message);
    }

    return result;
  }

  /** آیا پوشهٔ مشتق‌های این تصویر وجود دارد؟ */
  async function hasImage(imageId) {
    assertImageId(imageId);
    try {
      const st = await fs.stat(imageDir(imageId));
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * نشانی عمومی یک مشتق.
   *
   * تنها جایی که شکلِ نشانی را می‌داند. پیاده‌سازیِ بعدی (هر چه باشد)
   * فقط همین را بازنویسی می‌کند و هیچ قالبی عوض نمی‌شود.
   */
  function publicUrl(imageId, name, ext) {
    assertImageId(imageId);
    assertPart(name, SAFE_NAME, 'نام اندازه');
    assertPart(ext, SAFE_EXT, 'پسوند');
    return `/media/products/${imageId}/${name}.${ext}`;
  }

  return { putOriginal, putDerivative, removeImage, hasImage, publicUrl, driver: 'local' };
}

/* نمونهٔ پیش‌فرض برای مسیر تولید. آزمون‌ها نمونهٔ خودشان را می‌سازند. */
export const storage = createLocalStorage();

export default storage;
