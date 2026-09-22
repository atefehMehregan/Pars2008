/* ============================================================================
 * config/index.js — تنظیمات برنامه
 * ----------------------------------------------------------------------------
 * همه پیکربندی از متغیرهای محیطی خوانده می‌شود. هیچ راز، رمز یا کلیدی
 * داخل کد نیست و نباید باشد.
 *
 * قاعده: در حالت production نبودِ مقدارهای حیاتی باید زود و پرصدا خطا بدهد،
 * نه اینکه برنامه با مقدار پیش‌فرض ناامن بالا بیاید.
 * ==========================================================================*/
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

/** مقدار الزامی؛ نبودنش در تولید خطاست. */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`متغیر محیطی ${name} تعریف نشده است.`);
  }
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`متغیر محیطی ${name} باید عدد صحیح باشد.`);
  return n;
}

function bool(name, fallback) {
  const raw = (process.env[name] || '').toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/* ------------------------------------------------------------ پایگاه داده */
/* تنها راننده پشتیبانی‌شده PostgreSQL است. SQLite عمدا پشتیبانی نمی‌شود. */

const databaseUrl = process.env.DATABASE_URL || '';

/**
 * تنظیم SSL برای اتصال به PostgreSQL.
 * پیش‌فرض تولید: روشن با بررسی گواهی. خاموش‌کردن بررسی فقط با تنظیم صریح،
 * چون جلوی حمله مرد-میانی را باز می‌گذارد.
 */
function sslSetting() {
  const mode = (process.env.DATABASE_SSL || '').toLowerCase();
  if (['off', 'false', 'disable'].includes(mode)) return false;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  if (['on', 'true', 'require'].includes(mode)) return { rejectUnauthorized: true };
  if (/[?&]sslmode=/i.test(databaseUrl)) return undefined; // به pg سپرده می‌شود
  return isProd ? { rejectUnauthorized: true } : false;
}

export const config = {
  env,
  isProd,
  isTest,
  port: int('PORT', 3000),
  host: process.env.HOST || '127.0.0.1',

  database: {
    url: databaseUrl,
    ssl: sslSetting(),
    poolMax: int('DATABASE_POOL_MAX', 10),
    connectionTimeoutMs: int('DATABASE_CONNECT_TIMEOUT_MS', 10_000),
    idleTimeoutMs: int('DATABASE_IDLE_TIMEOUT_MS', 30_000),
  },

  /* کوکی نشست — پیاده‌سازی کامل نشست در فاز بعد. */
  cookie: {
    sessionName: process.env.SESSION_COOKIE_NAME || 'pars_session',
    csrfName: process.env.CSRF_COOKIE_NAME || 'pars_csrf',
    /* در تولید حتما Secure. SameSite=Lax چون فرانت و بک‌اند هم‌دامنه‌اند. */
    secure: isProd,
    sameSite: 'lax',
    maxAgeDays: int('SESSION_DAYS', 30),
  },

  /* ---------------------------------------------------------- مدیر --
     نشست مدیر عمدا از نشست مشتری جداست: کوکی جدا، نام جدا، و عمر بسیار
     کوتاه‌تر. SESSION_DAYS (۳۰ روز) برای حساب مشتری است و هرگز نباید
     ورود مدیر را اداره کند. */
  admin: {
    cookieName: process.env.ADMIN_COOKIE_NAME || 'pars_admin_session',
    csrfCookieName: process.env.ADMIN_CSRF_COOKIE_NAME || 'pars_admin_csrf',
    /* کوکی مدیر فقط زیر /admin فرستاده می‌شود، پس روی صفحه‌های عمومی
       کاتالوگ اصلا روی سیم نمی‌رود. */
    cookiePath: '/admin',
    absoluteHours: int('ADMIN_SESSION_ABSOLUTE_HOURS', 12),
    idleMinutes: int('ADMIN_SESSION_IDLE_MINUTES', 60),
    lockout: {
      maxPerIdentifier: int('ADMIN_LOGIN_MAX_PER_IDENTIFIER', 5),
      maxPerIp: int('ADMIN_LOGIN_MAX_PER_IP', 20),
      windowMinutes: int('ADMIN_LOGIN_WINDOW_MINUTES', 15),
    },
  },

  /* پارامترهای Argon2id — مطابق راهنمای OWASP. */
  argon: {
    memoryCost: int('ARGON_MEMORY_KIB', 19_456), // 19 MiB
    timeCost: int('ARGON_TIME', 2),
    parallelism: int('ARGON_PARALLELISM', 1),
  },

  /* مسیرهای ذخیره‌سازی.
     originals و receipts هرگز به‌صورت استاتیک سرو نمی‌شوند؛
     products (مشتقات واترمارک‌خورده) عمدا عمومی است. */
  storage: {
    root: process.env.STORAGE_ROOT || path.join(ROOT, 'storage'),
    get originals() { return path.join(this.root, 'originals'); },
    get products() { return path.join(this.root, 'products'); },
    get receipts() { return path.join(this.root, 'receipts'); },
  },

  uploads: {
    maxImageBytes: int('UPLOAD_MAX_IMAGE_BYTES', 5 * 1024 * 1024),   // ۵ مگابایت
    maxReceiptBytes: int('UPLOAD_MAX_RECEIPT_BYTES', 5 * 1024 * 1024),
    maxReceiptsPerOrder: int('UPLOAD_MAX_RECEIPTS_PER_ORDER', 5),
    /* فقط همین نوع‌ها پذیرفته می‌شوند و تشخیص از روی بایت‌های ابتدایی فایل
       انجام می‌شود، نه پسوند نام فایل. */
    allowedImageMime: ['image/jpeg', 'image/png', 'image/webp'],
  },

  images: {
    watermarkEnabled: bool('WATERMARK_ENABLED', true),
    /* اندازه‌های مشتق — مربع ۱:۱، چون قطعات نسبت ابعادی بسیار متفاوتی دارند. */
    sizes: [
      { name: 'thumb', width: 160 },
      { name: 'card', width: 400 },
      { name: 'detail', width: 800 },
      { name: 'zoom', width: 1600 },
    ],
    webpQuality: int('IMAGE_WEBP_QUALITY', 82),
    jpegQuality: int('IMAGE_JPEG_QUALITY', 84),
  },

  rateLimit: {
    windowMinutes: int('RATE_LIMIT_WINDOW_MINUTES', 15),
    generalMax: int('RATE_LIMIT_GENERAL_MAX', 300),
    loginMax: int('RATE_LIMIT_LOGIN_MAX', 5),
    uploadMax: int('RATE_LIMIT_UPLOAD_MAX', 10),
  },

  /* پیامک — ارائه‌دهنده هنوز انتخاب نشده است (فاز بعد). */
  sms: {
    provider: process.env.SMS_PROVIDER || '',
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || '',
    managerMobile: process.env.SMS_MANAGER_MOBILE || '',
  },
};

/* در تولید، نبود این‌ها باید همان لحظه راه‌اندازی خطا بدهد.
   SESSION_SECRET اینجا نیست و لازم نیست: نشست مدیر با توکن تصادفیِ
   مات کار می‌کند که فقط هش SHA-256 آن ذخیره می‌شود. چیزی امضا نمی‌شود،
   پس رازی برای امضا کردن هم لازم نیست. */
if (isProd) {
  required('DATABASE_URL');
}

/* بیرون از تولید هم بدون رشته اتصال نمی‌شود به پایگاه داده وصل شد.
   در حالت آزمون این خطا داده نمی‌شود تا آزمون‌های بدون پایگاه داده اجرا شوند. */
export function assertDatabaseConfigured() {
  if (!config.database.url) {
    throw new Error(
      'DATABASE_URL تعریف نشده است. یک رشته اتصال PostgreSQL در فایل .env بگذارید. ' +
      'نمونه: postgresql://user:password@127.0.0.1:5432/pars2008'
    );
  }
  return true;
}

export default config;
