/* ============================================================================
 * routes/admin.js — مسیرهای بخش مدیر
 * ----------------------------------------------------------------------------
 * ترتیب میان‌افزارها اینجا یک تصمیم امنیتی است، نه سلیقه:
 *
 *   GET  /admin/login   بدون نیاز به نشست (ولی نشست خوانده می‌شود تا اگر
 *                       کسی از قبل وارد است به پیشخان هدایت شود)
 *   POST /admin/login   CSRF *عمومی و بدون‌حالت* + محدودکنندهٔ نرخ ورود.
 *                       CSRF گره‌خورده به نشست اینجا بی‌معنی است چون هنوز
 *                       نشستی وجود ندارد.
 *   GET  /admin         requireAdminAuth
 *   POST /admin/logout  requireAdminAuth → سپس requireAdminCsrf
 *
 * requireAdminCsrf هرگز پیش از requireAdminAuth نمی‌آید.
 * ==========================================================================*/
import express from 'express';
import { requireCsrf } from '../middleware/security.js';
import { adminNoStore, createAdminAuthMiddleware } from '../middleware/adminAuth.js';
import { createAdminAuthController } from '../controllers/adminAuthController.js';
import { createAdminCatalogRouter } from './adminCatalog.js';
import { createAdminProductImagesRouter } from './adminProductImages.js';

export function createAdminRouter({
  authService, audit, loginLimiter, uploadLimiter, repositories = {}, storage = null,
}) {
  const router = express.Router();
  const { loadAdminSession, requireAdminAuth, requireAdminCsrf } =
    createAdminAuthMiddleware(authService);
  const c = createAdminAuthController({ authService, audit, repositories });

  /* هر پاسخ این بخش: بدون کش، بدون نمایه‌سازی. */
  router.use(adminNoStore);
  /* نشست همیشه خوانده می‌شود؛ تصمیم با میان‌افزار بعدی است. */
  router.use(loadAdminSession);

  /* --- ورود: هنوز نشستی در کار نیست --- */
  router.get('/login', c.showLogin);
  router.post('/login', loginLimiter, requireCsrf, c.submitLogin);

  /* --- از اینجا به بعد، فقط مدیر واردشده --- */
  router.get('/', requireAdminAuth, c.dashboard);
  router.post('/logout', requireAdminAuth, requireAdminCsrf, c.submitLogout);

  /* مدیریت تصویر محصول — پیش از مسیریاب کاتالوگ سوار می‌شود تا
     /products/:id/images زودتر تطبیق بخورد؛ بقیهٔ مسیرها دست‌نخورده
     به مسیریاب بعدی می‌رسند.

     فقط وقتی سوار می‌شود که وابستگی‌هایش واقعا تزریق شده باشند. در
     تولید همیشه هستند (repositories/index.js و لایهٔ ذخیره‌سازی).
     آزمونی که مجموعهٔ ناقصی از مخزن‌ها می‌دهد، این مسیرها را اصلا
     نمی‌گیرد — یعنی ۴۰۴، نه مسیرِ بی‌محافظ. */
  if (repositories.productImages && storage) {
    router.use('/catalogue', createAdminProductImagesRouter({
      repositories,
      storage,
      audit,
      requireAdminAuth,
      requireAdminCsrf,
      uploadLimiter,
    }));
  }

  /* مدیریت کاتالوگ. همان دو میان‌افزارِ ساخته‌شده در بالا پایین داده
     می‌شوند — نه ساخته‌شدن دوباره. یک پیاده‌سازی و یک نمونه، تا رفتار
     مرز در همه‌جای بخش مدیر دقیقا یکی باشد. */
  router.use('/catalogue', createAdminCatalogRouter({
    repositories,
    audit,
    storage,
    requireAdminAuth,
    requireAdminCsrf,
  }));

  return router;
}
