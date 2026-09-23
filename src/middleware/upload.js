/* ============================================================================
 * middleware/upload.js — لایهٔ حمل multipart
 * ----------------------------------------------------------------------------
 * Multer فقط *حمل‌کننده* است: بدنهٔ multipart را به بافر تبدیل می‌کند و
 * سقف‌ها را پیش از خوانده شدنِ بایت‌ها اعمال می‌کند. همین و بس.
 *
 * هیچ‌کدام از این‌ها جای لایه‌های امنیتی موجود را نمی‌گیرد:
 *   * تشخیص نوع از روی بایت‌های ابتدایی (sniffImageMime)
 *   * رمزگذاری دوبارهٔ کامل با sharp
 *   * سقف ابعاد و شمار پیکسل
 *   * حذف فراداده و واترمارک
 *   * احراز هویت، CSRF و محدودیت نرخ
 *
 * به‌ویژه: file.mimetype و file.originalname را *خودِ مرورگر* می‌فرستد و
 * هرگز به آن‌ها اعتماد نمی‌شود. نه برای تصمیم دربارهٔ نوع فایل، نه برای
 * ساختن نام فایل روی دیسک.
 *
 * --------------------------------------------------------------------------
 * یک نکتهٔ ترتیبی که در قالب هم رعایت شده است:
 *
 *   فیلد پنهان _csrf باید در فرم *پیش از* کادر انتخاب فایل بیاید.
 *   Multer بخش‌ها را به ترتیب می‌خواند، پس اگر فایل زودتر بیاید و سقف
 *   حجم بشکند، پردازش همان‌جا قطع می‌شود و _csrf هرگز به req.body
 *   نمی‌رسد — نتیجه‌اش ۴۰۳ گیج‌کننده به‌جای پیام روشنِ «فایل بزرگ است».
 * ==========================================================================*/
import multer from 'multer';
import { config } from '../config/index.js';

/** تنها نام فیلدی که فایل می‌پذیرد. هر نام دیگری رد می‌شود. */
export const PRODUCT_IMAGE_FIELD = 'images';

/** خطای Multer → پیام فارسی و کد وضعیت مناسب. */
export function describeUploadError(err) {
  const mb = Math.round(config.uploads.maxImageBytes / (1024 * 1024));
  switch (err?.code) {
    case 'LIMIT_FILE_SIZE':
      return { status: 413, message: `حجم هر فایل نباید بیشتر از ${mb} مگابایت باشد.` };
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
      return {
        status: 413,
        message: `در هر بار حداکثر ${config.uploads.maxFilesPerRequest} فایل می‌توانید بفرستید.`,
      };
    case 'LIMIT_UNEXPECTED_FILE':
      return { status: 400, message: 'فیلد فایل ناشناخته است.' };
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_FIELD_COUNT':
      return { status: 400, message: 'داده‌های فرم بیش از حد بزرگ‌اند.' };
    default:
      return { status: 400, message: 'دریافت فایل ناموفق بود.' };
  }
}

/**
 * میان‌افزار آپلود تصویر محصول.
 *
 * خطا را به errorHandler نمی‌سپارد: صفحهٔ ۵۰۰ برای «فایل بزرگ است»
 * پاسخ درستی نیست. به‌جایش خطا روی req.uploadError می‌نشیند و کنترلر
 * همان صفحه را با پیام روشن دوباره رندر می‌کند.
 */
export function createProductImageUpload() {
  const handler = multer({
    /* بافر در حافظه؛ هیچ فایل موقتی روی دیسک نوشته نمی‌شود. sharp و
       اعتبارسنجیِ بایت‌های ابتدایی هر دو Buffer می‌خواهند. */
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.uploads.maxImageBytes,
      files: config.uploads.maxFilesPerRequest,
      /* فیلدهای متنی: _csrf و چند برچسب. سخاوتمند ولی بسته. */
      fields: 12,
      parts: config.uploads.maxFilesPerRequest + 12,
      fieldNameSize: 100,
      fieldSize: 2000,
    },
  }).array(PRODUCT_IMAGE_FIELD, config.uploads.maxFilesPerRequest);

  return function productImageUpload(req, res, next) {
    handler(req, res, (err) => {
      if (err) req.uploadError = describeUploadError(err);
      next();
    });
  };
}

export default createProductImageUpload;
