/* ============================================================================
 * routes/adminProductImages.js — مرز دسترسی مدیریت تصویر محصول
 * ----------------------------------------------------------------------------
 * چرا یک مسیریاب جداگانه و نه افزودن به routes/adminCatalog.js؟
 *
 *   چون آنجا هر دو میان‌افزار با router.use و *پیش از همهٔ مسیرها* بسته
 *   شده‌اند، و یک آزمون ساختاری همان ترتیب را تضمین می‌کند. ولی آپلود
 *   multipart یک استثنای واقعی دارد:
 *
 *     requireAdminCsrf مقدار را از req.body._csrf می‌خواند، و
 *     express.urlencoded بدنهٔ multipart را تجزیه *نمی‌کند*. پس اگر
 *     CSRF پیش از Multer اجرا شود، req.body خالی است و هر آپلودِ درستی
 *     با ۴۰۳ رد می‌شود.
 *
 *   راه‌حل، جابه‌جا کردن ثابتِ امنیتی نیست — ثابت سر جایش می‌ماند:
 *
 *       requireAdminAuth → (تجزیهٔ multipart) → requireAdminCsrf
 *
 *   احراز هویت همچنان *پیش از* CSRF است. تنها چیزی که بینشان می‌نشیند
 *   تجزیه‌کننده است، با سقف‌های خودش.
 *
 *   معاملهٔ آگاهانه: بایت‌های یک درخواستِ جعلیِ CSRF پیش از رد شدن
 *   بافر می‌شوند. این با سقف حجم Multer، سقف تعداد، و محدودکنندهٔ نرخ
 *   آپلود مهار شده است — و درخواست بدون نشستِ معتبر اصلا به اینجا
 *   نمی‌رسد.
 *
 * این مسیریاب *پیش از* مسیریاب کاتالوگ سوار می‌شود و فقط مسیرهای
 * /products/:id/images… را می‌گیرد؛ بقیه دست‌نخورده به آن یکی می‌رسند.
 * ==========================================================================*/
import express from 'express';
import { createAdminProductImagesController } from '../controllers/adminProductImagesController.js';
import { createProductImageUpload } from '../middleware/upload.js';
import { assertImageId } from '../services/storage.js';

/**
 * @param {object} deps
 * @param {object} deps.repositories باید products و productImages داشته باشد
 * @param {object} deps.storage لایهٔ ذخیره‌سازی
 * @param {Function} deps.requireAdminAuth از createAdminAuthMiddleware والد
 * @param {Function} deps.requireAdminCsrf از createAdminAuthMiddleware والد
 * @param {Function} [deps.uploadLimiter] محدودکنندهٔ نرخ آپلود
 */
export function createAdminProductImagesRouter({
  repositories = {}, storage, audit = null,
  requireAdminAuth, requireAdminCsrf, uploadLimiter,
} = {}) {
  if (typeof requireAdminAuth !== 'function' || typeof requireAdminCsrf !== 'function') {
    throw new Error('adminProductImages: میان‌افزار احراز هویت باید از والد تزریق شود');
  }
  for (const name of ['products', 'productImages']) {
    if (!repositories[name]) {
      throw new Error(`adminProductImages: مخزن «${name}» تزریق نشده است`);
    }
  }
  if (!storage || typeof storage.publicUrl !== 'function') {
    throw new Error('adminProductImages: لایهٔ ذخیره‌سازی تزریق نشده است');
  }

  const router = express.Router();
  const c = createAdminProductImagesController({ repositories, storage, audit });
  const upload = createProductImageUpload();
  const rateLimit = typeof uploadLimiter === 'function' ? uploadLimiter : (req, res, next) => next();

  /* قفل، پیش از هر مسیری. CSRF *عمدا* اینجا نیست — به دلیل بالا. */
  router.use(requireAdminAuth);

  /* نگهبان شناسهٔ محصول — همان قاعدهٔ مسیریاب کاتالوگ. */
  router.param('id', (req, res, next, raw) => {
    const value = String(raw);
    if (/^\d{1,15}$/.test(value) && Number(value) > 0) return next();
    return res.redirect(303, '/admin/catalogue/products?error=not_found');
  });

  /* نگهبان شناسهٔ تصویر: پیش از آنکه به مسیر فایل یا نشانی تبدیل شود.
     شناسه را سرور ساخته (UUID)، پس هر شکل دیگری یعنی دست‌کاری. */
  router.param('imageId', (req, res, next, raw) => {
    try {
      assertImageId(String(raw));
      return next();
    } catch {
      return res.redirect(303, `/admin/catalogue/products/${req.params.id}/images?error=not_found`);
    }
  });

  /* --- خواندنی: CSRF لازم ندارد (خودش هم GET را رد می‌کند) --- */
  router.get('/products/:id/images', requireAdminCsrf, c.index);

  /* --- آپلود: تنها مسیری که ترتیبش استثناست --- */
  router.post('/products/:id/images', rateLimit, upload, requireAdminCsrf, c.upload);

  /* --- بقیهٔ نوشتن‌ها بدنهٔ معمولی دارند، پس ترتیب عادی است --- */
  router.post('/products/:id/images/reorder', requireAdminCsrf, c.reorder);
  router.post('/products/:id/images/:imageId/primary', requireAdminCsrf, c.setPrimary);
  router.post('/products/:id/images/:imageId/alt', requireAdminCsrf, c.updateAlt);
  router.post('/products/:id/images/:imageId/delete', requireAdminCsrf, c.remove);

  return router;
}
