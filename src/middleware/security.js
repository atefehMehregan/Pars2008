/* ============================================================================
 * middleware/security.js — پایه‌های امنیتی
 * ----------------------------------------------------------------------------
 * فاز ۰: زیرساخت آماده می‌شود، ولی احراز هویت و پرداخت هنوز پیاده نشده‌اند.
 *
 * نکته‌ای که بعدا حیاتی می‌شود: requireAuth باید *پیش از* requireCsrf اجرا
 * شود. requireCsrf وقتی نشستی در کار نباشد اجازه عبور می‌دهد (چون ورود و
 * ثبت‌نام هنوز نشست ندارند)، پس به‌تنهایی احراز هویت نیست.
 * ==========================================================================*/
import crypto from 'node:crypto';
import { config } from '../config/index.js';

/* -------------------------------------------------------------- کمکی‌ها */

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** مقایسه زمان‌ثابت، تا از روی زمان پاسخ نشود مقدار را حدس زد. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** نام فایل تصادفی؛ نام ارسالی کاربر هرگز روی دیسک استفاده نمی‌شود. */
export function randomFilename(extension) {
  const safeExt = String(extension || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return safeExt ? `${crypto.randomUUID()}.${safeExt}` : crypto.randomUUID();
}

/* --------------------------------------------------------- کوکی‌ها */

/** گزینه‌های کوکی نشست. در تولید حتما Secure. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    maxAge: config.cookie.maxAgeDays * 24 * 60 * 60 * 1000,
  };
}

/** کوکی CSRF عمدا httpOnly نیست؛ اسکریپت صفحه باید بتواند بخواندش.
    چون فرانت و بک‌اند هم‌دامنه‌اند، الگوی double-submit اینجا کار می‌کند. */
export function csrfCookieOptions() {
  return { ...sessionCookieOptions(), httpOnly: false };
}

/* ------------------------------------------------------------------ CSRF */

/**
 * توکن CSRF را در کوکی می‌گذارد و روی res.locals می‌آورد تا قالب‌ها
 * بتوانند آن را در فرم بگذارند.
 */
export function csrfToken(req, res, next) {
  let token = req.cookies?.[config.cookie.csrfName];
  if (!token) {
    token = randomToken(24);
    res.cookie(config.cookie.csrfName, token, csrfCookieOptions());
  }
  res.locals.csrfToken = token;
  next();
}

/**
 * بررسی توکن CSRF روی درخواست‌های تغییردهنده.
 * الگو: double-submit — مقدار کوکی باید با فیلد فرم یا هدر یکی باشد.
 */
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookieToken = req.cookies?.[config.cookie.csrfName];
  const sent = req.headers['x-csrf-token'] || req.body?._csrf;

  if (!cookieToken || !sent || !safeEqual(cookieToken, sent)) {
    return res.status(403).json({
      ok: false, code: 'csrf_invalid', message: 'درخواست معتبر نیست. صفحه را تازه کنید.',
    });
  }
  next();
}

/* ------------------------------------------------------- هدرهای امنیتی */

/**
 * هدرهایی که helmet پوشش نمی‌دهد یا باید برای این پروژه تنظیم شوند.
 * توجه: Content-Security-Policy در فاز ۰ عمدا سخت‌گیرانه است؛ وقتی
 * اسکریپت‌های واقعی اضافه شدند باید بازبینی شود.
 */
export function extraSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
}

/* ------------------------------------------------- اعتبارسنجی آپلود */

/**
 * تشخیص نوع فایل از روی بایت‌های ابتدایی (magic bytes)، نه پسوند نام فایل.
 * پسوند را کاربر تعیین می‌کند و قابل اعتماد نیست.
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null}
 */
export function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * بررسی یک فایل آپلودشده.
 * @returns {{ok:true, mime:string} | {ok:false, message:string}}
 */
export function validateUploadedImage(buffer, { maxBytes } = {}) {
  const limit = maxBytes ?? config.uploads.maxImageBytes;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, message: 'فایلی دریافت نشد.' };
  }
  if (buffer.length > limit) {
    const mb = Math.round(limit / (1024 * 1024));
    return { ok: false, message: `حجم فایل بیش از ${mb} مگابایت است.` };
  }
  const mime = sniffImageMime(buffer);
  if (!mime || !config.uploads.allowedImageMime.includes(mime)) {
    return { ok: false, message: 'فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.' };
  }
  return { ok: true, mime };
}

/* --------------------------------------------------- خطاهای عمومی */

/** ۴۰۴ — هم HTML و هم JSON. */
export function notFound(req, res) {
  if (req.accepts('html')) {
    return res.status(404).render('pages/404', { title: 'صفحه پیدا نشد' });
  }
  return res.status(404).json({ ok: false, message: 'این مسیر وجود ندارد.' });
}

/** جزئیات خطای داخلی هرگز به کاربر نمی‌رسد؛ فقط یک کد ارجاع. */
export function errorHandler(err, req, res, _next) {
  const ref = crypto.randomBytes(4).toString('hex');
  console.error(`[error ${ref}]`, err?.message, err?.stack?.split('\n')[1]?.trim() || '');
  if (res.headersSent) return;

  if (req.accepts('html')) {
    return res.status(500).render('pages/500', { title: 'خطای سرور', ref });
  }
  return res.status(500).json({
    ok: false, message: 'خطای داخلی سرور. بعدا دوباره تلاش کنید.', ref,
  });
}
