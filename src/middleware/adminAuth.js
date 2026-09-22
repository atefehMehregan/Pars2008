/* ============================================================================
 * middleware/adminAuth.js — مرز اجازهٔ دسترسی مدیر
 * ----------------------------------------------------------------------------
 * ترتیب این سه، یک ثابتِ امنیتی است و هرگز نباید جابه‌جا شود:
 *
 *     loadAdminSession → requireAdminAuth → requireAdminCsrf
 *
 * چرا؟ چون بررسی CSRF وقتی نشستی در کار نباشد چیزی برای مقایسه ندارد.
 * اگر ترتیب برعکس شود، مسیری می‌سازیم که محافظت‌شده به نظر می‌رسد و نیست.
 *
 * --------------------------------------------------------------------------
 * دو حالت CSRF، آگاهانه و متفاوت:
 *
 *   الف) POST /admin/login — هنوز نشست مدیری وجود ندارد، پس CSRFِ
 *        گره‌خورده به نشست بی‌معنی است. این مسیر با همان سازوکار
 *        بدون-حالتِ عمومی (requireCsrf در security.js) به‌اضافهٔ
 *        محدودکنندهٔ نرخ ورود محافظت می‌شود.
 *
 *   ب) هر درخواست تغییردهندهٔ *پس از* ورود — با requireAdminCsrf که
 *      مقدار فرستاده‌شده را با هشِ ذخیره‌شده روی خودِ نشست می‌سنجد.
 *      این از double-submit خالی قوی‌تر است: کسی که بتواند روی دامنه
 *      کوکی بنویسد، هر دو نیمه را در اختیار می‌گیرد؛ گره زدن به نشست
 *      این راه را می‌بندد.
 * ==========================================================================*/
import { config } from '../config/index.js';

/**
 * هدرهایی که هر پاسخ بخش مدیر باید داشته باشد.
 * no-store تا صفحهٔ مدیر در کش مرورگر یا پراکسی نماند، و noindex تا
 * هرگز در موتور جست‌وجو ظاهر نشود.
 */
export function adminNoStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}

/** گزینه‌های کوکی نشست مدیر — مسیر محدود به /admin. */
export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    /* کوکی مدیر روی صفحه‌های عمومی کاتالوگ اصلا فرستاده نمی‌شود. */
    path: config.admin.cookiePath,
    maxAge: config.admin.absoluteHours * 60 * 60 * 1000,
  };
}

/**
 * کوکی CSRF مدیر.
 *
 * برخلاف کوکی CSRF عمومی، این یکی *httpOnly* است: سرور خودش مقدار را
 * داخل فیلد پنهان فرم می‌گذارد، پس جاوااسکریپت صفحه هیچ‌وقت لازم نیست
 * آن را بخواند. یک سطح دسترسی کمتر برای مهاجم.
 *
 * کوکی فقط ناقل است؛ مرجع همان hash ذخیره‌شده روی سطر نشست است. کسی که
 * بتواند کوکی بنویسد هم نمی‌تواند آن را با نشست جور کند.
 */
export function adminCsrfCookieOptions() {
  return { ...adminCookieOptions(), httpOnly: true };
}

/**
 * ساخت میان‌افزارها با سرویس احراز هویت تزریق‌شده.
 * همان الگوی تزریق فازهای قبل، تا آزمون بتواند PGlite بدهد.
 */
export function createAdminAuthMiddleware(authService) {
  /**
   * نشست را از کوکی می‌خواند و روی req می‌گذارد.
   * نبودنش خطا نیست — تصمیم با میان‌افزار بعدی است.
   */
  async function loadAdminSession(req, res, next) {
    try {
      const token = req.cookies?.[config.admin.cookieName];
      req.adminSession = await authService.loadSession(token);
      req.admin = req.adminSession
        ? {
            id: req.adminSession.admin_id,
            email: req.adminSession.email,
            displayName: req.adminSession.display_name,
          }
        : null;
      /* برای قالب‌ها: مقدار خام از کوکی می‌آید و سرور آن را داخل فرم
         می‌گذارد. اعتبارسنجی بعدا در برابر hash نشست انجام می‌شود. */
      res.locals.admin = req.admin;
      res.locals.adminCsrfToken = req.adminSession
        ? (req.cookies?.[config.admin.csrfCookieName] || '')
        : '';
      next();
    } catch (err) {
      next(err);
    }
  }

  /**
   * نیاز به مدیرِ واردشده و فعال.
   *
   * GET → هدایت به صفحهٔ ورود (کاربر راهش را گم کرده).
   * غیر-GET → ۴۰۱ (یک درخواست برنامه‌ای است، نه مرور انسانی).
   */
  function requireAdminAuth(req, res, next) {
    if (req.adminSession) return next();

    if (req.method === 'GET') {
      return res.redirect(302, '/admin/login');
    }
    return res.status(401).json({
      ok: false, code: 'unauthenticated', message: 'برای این کار باید وارد شوید.',
    });
  }

  /**
   * CSRF گره‌خورده به نشست، برای درخواست‌های تغییردهندهٔ پس از ورود.
   *
   * حتما *پس از* requireAdminAuth. اگر به اینجا رسیدیم و نشستی نیست،
   * یعنی ترتیب میان‌افزارها اشتباه سیم‌کشی شده — که خطای برنامه‌نویسی
   * است، نه ورودی بد. پس صریح و پرصدا رد می‌شود.
   */
  function requireAdminCsrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    if (!req.adminSession) {
      console.error('[adminAuth] requireAdminCsrf بدون نشست صدا زده شد — ترتیب میان‌افزار اشتباه است');
      return res.status(401).json({
        ok: false, code: 'unauthenticated', message: 'برای این کار باید وارد شوید.',
      });
    }

    const submitted = req.headers['x-csrf-token'] || req.body?._csrf;
    if (!authService.csrfMatchesSession(req.adminSession, submitted)) {
      return res.status(403).json({
        ok: false, code: 'csrf_invalid', message: 'درخواست معتبر نیست. صفحه را تازه کنید.',
      });
    }
    next();
  }

  return { loadAdminSession, requireAdminAuth, requireAdminCsrf };
}
