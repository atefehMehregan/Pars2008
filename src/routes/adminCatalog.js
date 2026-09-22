/* ============================================================================
 * routes/adminCatalog.js — مرز دسترسی بخش مدیریت کاتالوگ
 * ----------------------------------------------------------------------------
 * این فایل در این مرحله عمدا *فقط* مرز است. هیچ فرم، کنترلر یا عملیات
 * واقعی CRUD اینجا نیست؛ آن‌ها در گام بعد می‌آیند. دلیلش ساده است: اگر
 * اول رفتار را بسازیم و بعد قفل را، بازه‌ای وجود دارد که مسیر نوشتن باز
 * است. برعکسش چنین بازه‌ای ندارد.
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

/* موجودیت‌هایی که شکل مسیرهایشان یکسان است. */
const ENTITIES = ['products', 'categories', 'brands'];

/**
 * پاسخ موقت این گام.
 * فقط اثبات می‌کند که درخواست از مرز اجازهٔ دسترسی رد شده است. در گام
 * بعد جایش را کنترلر و قالب واقعی می‌گیرد.
 */
function placeholder(name) {
  return function handlePlaceholder(req, res) {
    res.status(200).json({ ok: true, placeholder: name });
  };
}

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

  /* --- قفل، پیش از هر مسیری --- */
  router.use(requireAdminAuth);
  router.use(requireAdminCsrf);

  /* --- از اینجا به بعد: فقط مدیرِ واردشده با توکن معتبرِ همین نشست --- */

  router.get('/', (req, res) => res.redirect(302, '/admin/catalogue/products'));

  for (const entity of ENTITIES) {
    router.get(`/${entity}`, placeholder(`${entity}.index`));
    router.get(`/${entity}/new`, placeholder(`${entity}.new`));
    router.post(`/${entity}`, placeholder(`${entity}.create`));
    router.get(`/${entity}/:id/edit`, placeholder(`${entity}.edit`));
    router.post(`/${entity}/:id`, placeholder(`${entity}.update`));
    router.post(`/${entity}/:id/delete`, placeholder(`${entity}.delete`));
    router.post(`/${entity}/:id/active`, placeholder(`${entity}.active`));
  }

  /* ویرایش سریع موجودی — فقط برای محصول معنا دارد. */
  router.post('/products/:id/stock', placeholder('products.stock'));

  return router;
}
