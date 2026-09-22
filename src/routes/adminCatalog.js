/* ============================================================================
 * routes/adminCatalog.js — مرز دسترسی بخش مدیریت کاتالوگ
 * ----------------------------------------------------------------------------
 * این فایل فقط مرز و نگاشت مسیر است. رفتار در کنترلر زندگی می‌کند و
 * SQL در مخزن؛ اینجا نه کوئری هست، نه اعتبارسنجی، نه منطق امنیتی.
 *
 * --------------------------------------------------------------------------
 * ترتیب میان‌افزارها — همان ثابت امنیتی فاز ۲، بدون هیچ تغییری:
 *
 *     loadAdminSession → requireAdminAuth → requireAdminCsrf
 *
 * دو تای اول از مسیریاب والد (routes/admin.js) به ارث می‌رسند و دو تای
 * بعدی اینجا به *کل* مسیریاب اعمال می‌شوند، نه مسیر به مسیر.
 *
 * چرا router.use و نه میان‌افزار روی تک‌تک مسیرها؟ چون با router.use
 * محافظت خاصیتِ خودِ مسیریاب می‌شود: هر مسیری که فردا به این فایل اضافه
 * شود، از همان لحظه محافظت‌شده است. سیم‌کشی دستی روی هر مسیر یعنی یک
 * فراموشی کافی است تا یک راه نوشتنِ بی‌محافظ باز بماند.
 *
 * requireAdminCsrf خودش GET/HEAD/OPTIONS را رد می‌کند و می‌گذارد رد شوند،
 * پس اعمال آن روی کل مسیریاب، صفحه‌های خواندنی را خراب نمی‌کند.
 *
 * --------------------------------------------------------------------------
 * احراز هویت و CSRF اینجا *بازنویسی نمی‌شوند*. همان دو تابعی که
 * createAdminAuthMiddleware ساخته از والد تزریق می‌شوند. یک پیاده‌سازی،
 * یک نمونه، یک رفتار — دو نسخهٔ موازی از منطق امنیتی، خودش یک آسیب‌پذیری است.
 *
 * توکن CSRFِ عمومی و بدون‌حالتِ صفحهٔ ورود اینجا پذیرفته نمی‌شود؛
 * requireAdminCsrf فقط توکن گره‌خورده به همین نشست را می‌پذیرد.
 * ==========================================================================*/
import express from 'express';
import { createAdminCatalogController } from '../controllers/adminCatalogController.js';

/* موجودیت‌هایی که شکل مسیرهایشان یکسان است. */
const ENTITIES = ['products', 'categories', 'brands'];

/**
 * مسیریاب مدیریت کاتالوگ.
 *
 * @param {object} deps
 * @param {object} deps.repositories مخزن‌های کاتالوگ، از همان مسیر تزریق
 *   وابستگیِ موجود (createApp → createAdminRouter → اینجا). در این گام
 *   هنوز استفاده نمی‌شوند، ولی حضورشان همین‌جا بررسی می‌شود تا خطای
 *   سیم‌کشی هنگام بالا آمدن برنامه معلوم شود، نه وسط اولین درخواست کاربر.
 * @param {Function} deps.requireAdminAuth از createAdminAuthMiddleware والد
 * @param {Function} deps.requireAdminCsrf از createAdminAuthMiddleware والد
 */
export function createAdminCatalogRouter({
  repositories = {}, audit = null, requireAdminAuth, requireAdminCsrf,
} = {}) {
  if (typeof requireAdminAuth !== 'function' || typeof requireAdminCsrf !== 'function') {
    throw new Error('adminCatalog: میان‌افزار احراز هویت باید از والد تزریق شود');
  }
  for (const name of ENTITIES) {
    if (!repositories[name]) {
      throw new Error(`adminCatalog: مخزن «${name}» تزریق نشده است`);
    }
  }

  const router = express.Router();
  const c = createAdminCatalogController({ repositories, audit });

  /* --- قفل، پیش از هر مسیری --- */
  router.use(requireAdminAuth);
  router.use(requireAdminCsrf);

  /* --- از اینجا به بعد: فقط مدیرِ واردشده با توکن معتبرِ همین نشست --- */

  router.get('/', (req, res) => res.redirect(302, '/admin/catalogue/products'));

  /* محصول‌ها */
  router.get('/products', c.productIndex);
  router.get('/products/new', c.productNew);
  router.post('/products', c.productCreate);
  router.get('/products/:id/edit', c.productEdit);
  router.post('/products/:id', c.productUpdate);
  router.post('/products/:id/delete', c.productDelete);
  router.post('/products/:id/active', c.productSetActive);
  /* ویرایش سریع موجودی — فقط برای محصول معنا دارد. */
  router.post('/products/:id/stock', c.productStock);

  /* دسته‌ها */
  router.get('/categories', c.categoryIndex);
  router.get('/categories/new', c.categoryNew);
  router.post('/categories', c.categoryCreate);
  router.get('/categories/:id/edit', c.categoryEdit);
  router.post('/categories/:id', c.categoryUpdate);
  router.post('/categories/:id/delete', c.categoryDelete);
  router.post('/categories/:id/active', c.categorySetActive);

  /* برندها */
  router.get('/brands', c.brandIndex);
  router.get('/brands/new', c.brandNew);
  router.post('/brands', c.brandCreate);
  router.get('/brands/:id/edit', c.brandEdit);
  router.post('/brands/:id', c.brandUpdate);
  router.post('/brands/:id/delete', c.brandDelete);
  router.post('/brands/:id/active', c.brandSetActive);

  return router;
}
