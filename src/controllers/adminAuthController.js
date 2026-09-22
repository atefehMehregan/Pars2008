/* ============================================================================
 * controllers/adminAuthController.js — ورود و خروج مدیر
 * ----------------------------------------------------------------------------
 * کنترلر فقط HTTP می‌داند: پارامتر می‌خواند، سرویس را صدا می‌زند، کوکی
 * می‌گذارد و قالب رندر می‌کند. هیچ منطق امنیتی‌ای اینجا تکرار نمی‌شود.
 * ==========================================================================*/
import { config } from '../config/index.js';
import { adminCookieOptions, adminCsrfCookieOptions } from '../middleware/adminAuth.js';

export function createAdminAuthController({ authService, audit }) {
  /* ------------------------------------------- GET /admin/login */

  function showLogin(req, res) {
    /* اگر از قبل وارد است، دوباره فرم ورود نشانش نمی‌دهیم. */
    if (req.adminSession) return res.redirect(302, '/admin');

    res.render('pages/admin/login', {
      title: 'ورود مدیر',
      error: null,
      email: '',
    });
  }

  /* ------------------------------------------ POST /admin/login */

  async function submitLogin(req, res, next) {
    try {
      const email = String(req.body?.email ?? '');
      const password = String(req.body?.password ?? '');

      const result = await authService.login({
        email,
        password,
        ip: req.clientIp,
        userAgent: req.headers['user-agent'] || '',
      });

      if (!result.ok) {
        /* ۴۰۱ و همان فرم، با پیام عمومی. هیچ اشاره‌ای به اینکه کدام‌یک
           از ایمیل یا رمز غلط بوده. */
        return res.status(401).render('pages/admin/login', {
          title: 'ورود مدیر',
          error: result.message,
          /* ایمیل برمی‌گردد تا کاربر دوباره تایپ نکند؛ رمز هرگز. */
          email,
        });
      }

      /* کوکی نشست، و کوکی CSRF که سرور بعدا داخل فرم‌ها می‌گذارد.
         هر دو httpOnly و هر دو محدود به مسیر /admin. */
      res.cookie(config.admin.cookieName, result.token, adminCookieOptions());
      res.cookie(config.admin.csrfCookieName, result.csrfToken, adminCsrfCookieOptions());
      return res.redirect(302, '/admin');
    } catch (err) {
      next(err);
    }
  }

  /* ----------------------------------------- POST /admin/logout */

  async function submitLogout(req, res, next) {
    try {
      const token = req.cookies?.[config.admin.cookieName];
      await authService.logout(token, { adminId: req.admin?.id, ip: req.clientIp });

      /* پاک کردن کوکی با همان گزینه‌ها — مسیر باید یکی باشد وگرنه
         مرورگر کوکی دیگری را پاک می‌کند و این یکی می‌ماند. */
      const clearOpts = { ...adminCookieOptions(), maxAge: undefined };
      res.clearCookie(config.admin.cookieName, clearOpts);
      res.clearCookie(config.admin.csrfCookieName, clearOpts);
      return res.redirect(302, '/admin/login');
    } catch (err) {
      next(err);
    }
  }

  /* ------------------------------------------------ GET /admin */

  async function dashboard(req, res, next) {
    try {
      const recent = await audit.recent({ limit: 10 });
      res.render('pages/admin/dashboard', {
        title: 'پیشخان مدیریت',
        recentActivity: recent,
      });
    } catch (err) {
      next(err);
    }
  }

  return { showLogin, submitLogin, submitLogout, dashboard };
}
