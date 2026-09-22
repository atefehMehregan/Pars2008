/* ============================================================================
 * services/adminAuth.js — چرخهٔ عمر احراز هویت مدیر
 * ----------------------------------------------------------------------------
 * اینجا منطق ورود، خروج و اعتبارسنجی نشست است. کنترلر فقط HTTP را می‌شناسد
 * و این سرویس فقط دامنه را؛ هیچ‌کدام دیگری را نمی‌داند.
 *
 * تصمیم‌های امنیتی که اینجا اعمال می‌شوند:
 *
 *   ۱. توکن نشست، ۳۲ بایت تصادفی است و فقط sha256 آن ذخیره می‌شود.
 *   ۲. هنگام ورود موفق، *همهٔ* نشست‌های قبلی همان مدیر باطل می‌شوند و
 *      نشست تازه‌ای ساخته می‌شود — دفاع در برابر تثبیت نشست (fixation).
 *      نشست ناشناس هرگز ارتقا پیدا نمی‌کند.
 *   ۳. توکن CSRF هم در همان لحظه تازه ساخته و به نشست گره زده می‌شود.
 *   ۴. وقتی حساب پیدا نمی‌شود، باز هم یک سنجش ساختگی انجام می‌شود تا زمان
 *      پاسخ، وجود یا نبودِ حساب را لو ندهد.
 *   ۵. پیام شکست همیشه یکی است، هر دلیلی که داشته باشد.
 * ==========================================================================*/
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { randomToken, sha256 } from '../middleware/security.js';
import { verifyPassword, verifyDummy } from './password.js';
import { AUDIT_ACTIONS } from './audit.js';

/* یک پیام برای همهٔ شکست‌ها. تفکیک «حساب نیست» از «رمز غلط» یعنی هدیه
   دادن فهرست حساب‌ها به مهاجم. */
const GENERIC_FAILURE = 'ایمیل یا رمز عبور درست نیست.';
const BLOCKED_MESSAGE = 'تلاش‌های ناموفق زیاد بود. چند دقیقه صبر کنید و دوباره تلاش کنید.';

/** نرمال‌سازی ایمیل برای جست‌وجو و ثبت تلاش. */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 254);
}

export function createAdminAuthService({ adminUsers, adminSessions, loginAttempts, audit }) {
  /**
   * ورود.
   *
   * @returns {Promise<{ok:true, token:string, csrfToken:string, admin:object}
   *                  | {ok:false, message:string, reason:string}>}
   */
  async function login({ email, password, ip = 'unknown', userAgent = '' }) {
    const identifier = normalizeEmail(email);

    /* ---- لایهٔ بادوام محدودسازی، پیش از هر کار دیگر ---- */
    if (await loginAttempts.isBlocked(identifier, ip, config.admin.lockout)) {
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_BLOCKED, ip,
        detail: { identifier },
      });
      return { ok: false, message: BLOCKED_MESSAGE, reason: 'locked_out' };
    }

    if (!identifier || typeof password !== 'string' || password.length === 0) {
      /* ورودی ناقص هم یک تلاش ناموفق است، وگرنه می‌شود بی‌هزینه کاوید. */
      await verifyDummy(password);
      await loginAttempts.record(identifier, ip, false);
      return { ok: false, message: GENERIC_FAILURE, reason: 'missing_credentials' };
    }

    const account = await adminUsers.findForLogin(identifier);

    /* ---- حساب نیست: سنجش ساختگی، تا زمان پاسخ یکسان بماند ---- */
    if (!account) {
      await verifyDummy(password);
      await loginAttempts.record(identifier, ip, false);
      await audit.record({
        action: AUDIT_ACTIONS.LOGIN_FAILED, ip,
        detail: { identifier, reason: 'no_account' },
      });
      return { ok: false, message: GENERIC_FAILURE, reason: 'no_account' };
    }

    const passwordOk = await verifyPassword(account.password_hash, password);

    if (!passwordOk || !account.is_active) {
      await loginAttempts.record(identifier, ip, false);
      await audit.record({
        adminId: account.id, action: AUDIT_ACTIONS.LOGIN_FAILED, ip,
        detail: { identifier, reason: passwordOk ? 'inactive' : 'bad_password' },
      });
      return { ok: false, message: GENERIC_FAILURE, reason: passwordOk ? 'inactive' : 'bad_password' };
    }

    /* ---- موفق ---- */

    /* دفاع در برابر تثبیت نشست: هر نشست زندهٔ قبلی باطل می‌شود و توکن
       کاملا تازه‌ای ساخته می‌شود. هیچ توکنی که پیش از احراز هویت وجود
       داشته، بعد از آن معتبر نمی‌ماند. */
    await adminSessions.revokeAllForAdmin(account.id);

    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + config.admin.absoluteHours * 60 * 60 * 1000);

    const session = await adminSessions.create({
      id: crypto.randomUUID(),
      adminId: account.id,
      tokenHash: sha256(token),
      csrfHash: sha256(csrfToken),
      userAgent,
      ip,
      expiresAt,
    });

    await loginAttempts.record(identifier, ip, true);
    await adminUsers.markLoggedIn(account.id);
    await audit.record({
      adminId: account.id, action: AUDIT_ACTIONS.LOGIN_SUCCESS, ip,
      detail: { identifier, sessionId: session.id },
    });

    return {
      ok: true,
      token,
      csrfToken,
      expiresAt,
      admin: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
      },
    };
  }

  /**
   * خواندن نشست از روی توکن کوکی.
   * نبودِ نشست خطا نیست — میان‌افزار خودش تصمیم می‌گیرد.
   * @returns {Promise<object|null>}
   */
  async function loadSession(token) {
    if (!token) return null;
    const session = await adminSessions.findValid(sha256(token), config.admin.idleMinutes);
    if (!session) return null;

    /* ساعت بی‌کاری را عقب می‌برد. شکستش نباید جلوی پاسخ را بگیرد. */
    adminSessions.touch(session.id).catch((err) =>
      console.error('[adminAuth] last_seen_at:', err.message));

    return session;
  }

  /** خروج. نشست در پایگاه داده واقعا باطل می‌شود، نه فقط کوکی پاک. */
  async function logout(token, { adminId = null, ip = 'unknown' } = {}) {
    if (!token) return false;
    const revoked = await adminSessions.revokeByTokenHash(sha256(token));
    if (revoked) {
      await audit.record({ adminId, action: AUDIT_ACTIONS.LOGOUT, ip });
    }
    return revoked;
  }

  /**
   * سنجش توکن CSRF در برابر مقدار گره‌خورده به نشست.
   * مقایسه روی هش انجام می‌شود، نه روی خود توکن.
   */
  function csrfMatchesSession(session, submitted) {
    if (!session || typeof submitted !== 'string' || submitted.length === 0) return false;
    const expected = session.csrf_hash;
    if (typeof expected !== 'string' || expected.length === 0) return false;
    const a = Buffer.from(sha256(submitted));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  return { login, loadSession, logout, csrfMatchesSession };
}
