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

/* موجودیت‌هایی که *همیشه* باید تزریق شده باشند. */
const ENTITIES = ['products', 'categories', 'brands'];

/* موجودیت‌هایی که مسیر دارند — برای نگهبان شناسه. خودرو اینجا هست ولی
   در فهرست بالا نیست: مثل مسیریاب تصویر، فقط وقتی سوار می‌شود که مخزنش
   تزریق شده باشد، پس آزمونی که مجموعهٔ ناقصی می‌دهد ۴۰۴ می‌گیرد نه خطا. */
const ROUTE_ENTITIES = [...ENTITIES, 'vehicles'];

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
  repositories = {}, audit = null, storage = null, requireAdminAuth, requireAdminCsrf,
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
  const c = createAdminCatalogController({ repositories, audit, storage });

  /* --- قفل، پیش از هر مسیری --- */
  router.use(requireAdminAuth);
  router.use(requireAdminCsrf);

  /**
   * نگهبان شناسه.
   *
   * ستون id از نوع BIGINT است. اگر مقدار خام نشانی مستقیم به کوئری
   * برسد، «abc» یا عددی بزرگ‌تر از بازه، خطای 22P02 پایگاه داده می‌دهد
   * و کاربر صفحهٔ «خطای سرور» می‌بیند — برای نشانیِ بد، پاسخ درستی
   * نیست. شناسهٔ ناموجود از قبل رفتار درستی داشت؛ شناسهٔ *بدشکل* نه.
   *
   * یک بار روی مسیریاب، نه روی تک‌تک مسیرها: هر مسیر تازه‌ای که
   * :id بگیرد از همین لحظه محافظت‌شده است.
   *
   * سقف ۱۵ رقم عمدی است — بزرگ‌ترین مقدار ممکن از
   * Number.MAX_SAFE_INTEGER کوچک‌تر می‌ماند، پس هیچ شناسه‌ای در
   * رفت‌وبرگشت به عدد جاوااسکریپت دقتش را از دست نمی‌دهد.
   *
   * این نگهبان *پس از* requireAdminAuth و requireAdminCsrf اجرا
   * می‌شود (آن دو با router.use پیش از مسیرها ثبت شده‌اند)، پس چیزی
   * دربارهٔ وجود یا نبودِ ردیف به کاربر واردنشده نمی‌گوید.
   */
  router.param('id', (req, res, next, raw) => {
    const value = String(raw);
    if (/^\d{1,15}$/.test(value) && Number(value) > 0) return next();

    /* همان رفتار «پیدا نشد» که برای شناسهٔ معتبرِ ناموجود وجود دارد. */
    const entity = req.path.split('/')[1];
    const list = ROUTE_ENTITIES.includes(entity) ? entity : 'products';
    return res.redirect(303, `${req.baseUrl}/${list}?error=not_found`);
  });

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

  /* خودروها — فاز ۶. همان شکل مسیرهای برند، و فقط وقتی مخزنش هست. */
  if (repositories.vehicles) {
    router.get('/vehicles', c.vehicleIndex);
    router.get('/vehicles/new', c.vehicleNew);
    router.post('/vehicles', c.vehicleCreate);
    router.get('/vehicles/:id/edit', c.vehicleEdit);
    router.post('/vehicles/:id', c.vehicleUpdate);
    router.post('/vehicles/:id/delete', c.vehicleDelete);
    router.post('/vehicles/:id/active', c.vehicleSetActive);
  }

  return router;
}
