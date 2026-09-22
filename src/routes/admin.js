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

export function createAdminRouter({ authService, audit, loginLimiter }) {
  const router = express.Router();
  const { loadAdminSession, requireAdminAuth, requireAdminCsrf } =
    createAdminAuthMiddleware(authService);
  const c = createAdminAuthController({ authService, audit });

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

  return router;
}
