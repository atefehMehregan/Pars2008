/* ============================================================================
 * services/images.js — پردازش تصویر و واترمارک
 * ----------------------------------------------------------------------------
 * معماری:
 *
 *   اصل (original)  →  storage/originals/<uuid>.<ext>   خصوصی، دست‌نخورده
 *   مشتق (derived)  →  storage/products/<uuid>/<size>.webp و .jpg   عمومی
 *
 * چرا اصل نگه داشته می‌شود؟ چون تنها چیزی است که امکان «خاموش/روشن کردن
 * واترمارک»، تغییر لوگو، یا برش دوباره را می‌دهد. بدون اصل، واترمارک
 * برگشت‌ناپذیر است.
 *
 * چرا واترمارک در زمان آپلود و نه در لحظه درخواست؟ چون CPU سرور محدود است
 * و پردازش در لحظه، تأخیر و خطر ازدحام کش می‌آورد.
 *
 * نکته امنیتی: تصویر ورودی همیشه دوباره رمزگذاری می‌شود. بایت‌های کاربر
 * هرگز مستقیم ذخیره یا سرو نمی‌شوند؛ این کار محموله‌های جاسازی‌شده و
 * فراداده مخرب را از بین می‌برد.
 * ==========================================================================*/
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { randomFilename } from '../middleware/security.js';
import { storage as defaultStorage } from './storage.js';

/**
 * گزینه‌های ورودی sharp.
 *
 * limitInputPixels صریح است چون پیش‌فرض خودِ sharp (حدود ۲۶۸ مگاپیکسل)
 * برای آپلود ۵ مگابایتی بیش از حد سخاوتمند است: یک PNG کوچکِ فشرده
 * می‌تواند به گیگابایت‌ها حافظه باز شود. این سقف، همان حمله را می‌بندد
 * پیش از آنکه بافر رمزگشایی شود.
 */
const inputOptions = () => ({
  failOn: 'error',
  limitInputPixels: config.uploads.maxImagePixels,
});

/** نسخه sharp و کتابخانه‌های زیرین — برای بررسی سلامت محیط. */
export function imagingInfo() {
  return {
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    platform: `${process.platform}-${process.arch}`,
    concurrency: sharp.concurrency(),
  };
}

/**
 * فراداده یک تصویر را می‌خواند بدون اینکه کل آن را رمزگشایی کند.
 * اگر بافر تصویر معتبر نباشد خطا می‌دهد — که خودش یک لایه اعتبارسنجی است.
 */
export async function readImageMetadata(buffer) {
  const meta = await sharp(buffer, inputOptions()).metadata();
  return { format: meta.format, width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha };
}

/**
 * بررسی اینکه آیا این بافر *قابل پردازش* است — گام پس از تشخیص نوع از
 * روی بایت‌های ابتدایی و پیش از ساختن مشتق‌ها.
 *
 * چرا جدا از validateUploadedImage؟ چون آن یکی بدون رمزگشایی کار می‌کند
 * (اندازه و magic bytes) و این یکی باید ابعاد را بداند، که یعنی باید
 * تصویر را واقعا باز کند. دو لایه، دو هزینه، به همان ترتیب.
 *
 * هرگز استثنا پرتاب نمی‌کند؛ مثل بقیهٔ اعتبارسنجی‌های پروژه
 * { ok, ... } برمی‌گرداند.
 *
 * @returns {Promise<{ok:true, meta:object} | {ok:false, message:string}>}
 */
export async function inspectUploadedImage(buffer) {
  let meta;
  try {
    meta = await readImageMetadata(buffer);
  } catch (err) {
    /* sharp برای بمب فشرده‌سازی همین‌جا شکست می‌خورد — پیش از رمزگشایی کامل. */
    if (/pixel limit/i.test(err.message || '')) {
      return { ok: false, message: 'ابعاد تصویر بیش از حد بزرگ است.' };
    }
    return { ok: false, message: 'فایل تصویر معتبر نیست.' };
  }

  if (!meta.format || !meta.width || !meta.height) {
    return { ok: false, message: 'فایل تصویر معتبر نیست.' };
  }

  const longest = Math.max(meta.width, meta.height);
  if (longest < config.uploads.minImageDimension) {
    return {
      ok: false,
      message: `ضلع بزرگ‌تر تصویر باید دست‌کم ${config.uploads.minImageDimension} پیکسل باشد.`,
    };
  }

  if (meta.width * meta.height > config.uploads.maxImagePixels) {
    return { ok: false, message: 'ابعاد تصویر بیش از حد بزرگ است.' };
  }

  return { ok: true, meta };
}

/**
 * ساخت یک مشتق مربعی.
 * قطعات نسبت ابعادی بسیار متفاوتی دارند (پیچ در برابر سپر)، پس همه روی
 * بوم مربع با حاشیه یکسان می‌نشینند تا شبکه محصولات منظم بماند.
 */
async function renderSize(buffer, width, { watermark } = {}) {
  let pipeline = sharp(buffer, inputOptions())
    .rotate()                       // اعمال جهت EXIF پیش از حذف فراداده
    .resize(width, width, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: true,
    });

  if (watermark) {
    /* واترمارک برای هر اندازه جداگانه ساخته می‌شود؛ واترمارکی که برای
       ۱۶۰۰ پیکسل طراحی شده در ۱۶۰ پیکسل ناخواناست. */
    pipeline = pipeline.composite([{ input: watermark, gravity: 'southwest' }]);
  }

  return pipeline;
}

/**
 * یک تصویر محصول را پردازش می‌کند: اصل را ذخیره و مشتق‌ها را می‌سازد.
 *
 * بایت‌ها از راه لایهٔ ذخیره‌سازی نوشته می‌شوند، نه مستقیم روی دیسک:
 * این تابع نمی‌داند فایل کجا می‌نشیند و نباید بداند.
 *
 * @param {Buffer} buffer بایت‌های تصویر (باید از پیش اعتبارسنجی شده باشد)
 * @param {object} [opts]
 * @param {Buffer} [opts.watermark] PNG شفاف لوگو؛ نبودنش یعنی بدون واترمارک
 * @param {object} [opts.storage] لایهٔ ذخیره‌سازی؛ پیش‌فرض نمونهٔ محلی
 * @returns {Promise<{id:string, originalPath:string, derivatives:object[]}>}
 */
export async function processProductImage(buffer, { watermark = null, storage = defaultStorage } = {}) {
  const meta = await readImageMetadata(buffer);
  if (!meta.format) throw new Error('فایل تصویر معتبر نیست.');

  const id = randomFilename().replace(/\.[^.]*$/, '');
  const originalPath = await storage.putOriginal(id, buffer, meta.format);

  const useWatermark = config.images.watermarkEnabled && watermark;
  const derivatives = [];

  for (const size of config.images.sizes) {
    /* واترمارک متناسب با عرض همین اندازه مقیاس می‌شود. */
    let mark = null;
    if (useWatermark) {
      const markWidth = Math.max(40, Math.round(size.width * 0.22));
      mark = await sharp(watermark).resize({ width: markWidth }).png().toBuffer();
    }

    const webp = await (await renderSize(buffer, size.width, { watermark: mark }))
      .webp({ quality: config.images.webpQuality }).toBuffer();
    const jpeg = await (await renderSize(buffer, size.width, { watermark: mark }))
      .jpeg({ quality: config.images.jpegQuality, mozjpeg: true }).toBuffer();

    await storage.putDerivative(id, size.name, 'webp', webp);
    await storage.putDerivative(id, size.name, 'jpg', jpeg);

    derivatives.push({
      size: size.name, width: size.width,
      webp: storage.publicUrl(id, size.name, 'webp'),
      jpeg: storage.publicUrl(id, size.name, 'jpg'),
      webpBytes: webp.length, jpegBytes: jpeg.length,
    });
  }

  return { id, originalPath, derivatives, source: meta };
}

/**
 * رسید پرداخت: دوباره رمزگذاری و ذخیره در مسیر خصوصی.
 * هیچ مشتق عمومی‌ای ساخته نمی‌شود و این فایل هرگز استاتیک سرو نمی‌شود —
 * فقط از راه یک مسیر احراز هویت‌شده قابل دیدن است.
 */
export async function processReceipt(buffer) {
  const meta = await readImageMetadata(buffer);
  if (!meta.format) throw new Error('فایل تصویر معتبر نیست.');

  const id = randomFilename().replace(/\.[^.]*$/, '');
  const storedName = `${id}.webp`;
  const target = path.join(config.storage.receipts, storedName);
  await fs.mkdir(config.storage.receipts, { recursive: true });

  /* حداکثر ۲۰۰۰ پیکسل کافی است تا متن رسید خوانا بماند و حجم کنترل شود.
     فراداده حذف می‌شود (sharp به‌صورت پیش‌فرض EXIF را نگه نمی‌دارد). */
  const out = await sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();

  await fs.writeFile(target, out);
  return { storedName, path: target, bytes: out.length, source: meta };
}
