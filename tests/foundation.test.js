/* ============================================================================
 * tests/foundation.test.js — آزمون‌های پایه فاز ۰
 * ----------------------------------------------------------------------------
 * فقط همان چیزی را می‌سنجد که فاز ۰ ادعا می‌کند:
 *   ۱. برنامه بالا می‌آید
 *   ۲. /health کار می‌کند
 *   ۳. پیکربندی PostgreSQL بی‌خطر خوانده می‌شود (بدون رمز داخل کد)
 *   ۴. ماژول اتصال، پیکربندی‌نشده را درست مدیریت می‌کند
 *   ۵. sharp بار می‌شود و تصویر پردازش می‌کند
 *   ۶. صفحه پایه راست‌به‌چپ رندر می‌شود
 *
 * آزمون‌ها به پایگاه داده زنده نیاز ندارند. اگر TEST_DATABASE_URL داده شود
 * یک آزمون اتصال واقعی هم اجرا می‌شود؛ وگرنه صریحا skip می‌شود — نه اینکه
 * بی‌سروصدا نادیده گرفته شود.
 * ==========================================================================*/
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.PORT = process.env.TEST_PORT || '3999';

const { createApp } = await import('../src/app.js');
const { config, assertDatabaseConfigured } = await import('../src/config/index.js');
const db = await import('../src/db/index.js');
const { faDigits, formatToman, normalizeMobile, normalizePersian, normalizePostalCode, toEnglishDigits }
  = await import('../src/services/format.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise((r) => server.close(r));
  await db.closeDb();
});

/* ------------------------------------------------------- ۱. برنامه بالاست */

test('برنامه ساخته و به پورت گوش می‌دهد', () => {
  assert.ok(server.listening, 'سرور باید در حال گوش دادن باشد');
});

/* ------------------------------------------------------------ ۲. /health */

test('GET /health وضعیت ۲۰۰ و بدنه ماشین‌خوان می‌دهد', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, '2008pars');
  assert.equal(body.env, 'test');
  assert.equal(typeof body.uptimeSeconds, 'number');
});

test('/health هیچ اطلاعات حساسی لو نمی‌دهد', async () => {
  const text = await (await fetch(`${BASE}/health`)).text();
  assert.ok(!/password|DATABASE_URL|postgresql:\/\//i.test(text), 'پاسخ نباید اعتبارنامه داشته باشد');
});

test('GET /health/db بدون پایگاه داده، ۵۰۳ و وضعیت می‌دهد — نه خطای ۵۰۰', async () => {
  const res = await fetch(`${BASE}/health/db`);
  assert.equal(res.status, 503, 'بدون پیکربندی باید ۵۰۳ باشد');
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(['not_configured', 'down'].includes(body.database.status), body.database.status);
  const text = JSON.stringify(body);
  assert.ok(!/password|postgresql:\/\//i.test(text), 'نباید رشته اتصال لو برود');
});

/* --------------------------------------- ۳. پیکربندی PostgreSQL بی‌خطر */

test('پیکربندی از محیط خوانده می‌شود و رمزی داخل کد نیست', () => {
  assert.equal(typeof config.database.poolMax, 'number');
  assert.equal(config.env, 'test');
  /* نه رمزی، نه رشته اتصالی داخل کد جاسازی نشده است. */
  assert.ok(config.database.url === '' || config.database.url === process.env.DATABASE_URL);
});

test('نبودِ DATABASE_URL خطای روشن فارسی می‌دهد', () => {
  const saved = config.database.url;
  config.database.url = '';
  assert.throws(() => assertDatabaseConfigured(), /DATABASE_URL/);
  config.database.url = saved;
});

test('رشته اتصال هنگام نمایش، رمز را پنهان می‌کند', () => {
  const red = db.redactConnectionString('postgresql://bob:supersecret@localhost:5432/pars');
  assert.ok(!red.includes('supersecret'), 'رمز نباید در خروجی باشد');
  assert.ok(red.includes('****'));
  assert.equal(db.redactConnectionString(''), '(تعریف‌نشده)');
  assert.equal(db.redactConnectionString('not a url'), '(رشته اتصال نامعتبر)');
});

/* -------------------------------- ۴. رفتار ماژول اتصال پایگاه داده */

test('import کردن ماژول db به‌تنهایی اتصال نمی‌سازد', () => {
  assert.equal(db.isPoolCreated(), false, 'استخر باید تنبل ساخته شود');
});

test('checkDatabaseHealth بدون پیکربندی not_configured می‌دهد', async () => {
  const saved = config.database.url;
  config.database.url = '';
  const health = await db.checkDatabaseHealth();
  assert.equal(health.status, 'not_configured');
  config.database.url = saved;
});

test('getPool بدون پیکربندی خطا می‌دهد، نه اتصال خاموش', () => {
  const saved = config.database.url;
  config.database.url = '';
  assert.throws(() => db.getPool(), /DATABASE_URL/);
  config.database.url = saved;
});

test('اتصال واقعی به PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  config.database.url = process.env.TEST_DATABASE_URL;
  const health = await db.checkDatabaseHealth();
  assert.equal(health.status, 'up', JSON.stringify(health));
  assert.equal(typeof health.latencyMs, 'number');
});

/* ------------------------------------------------------------- ۵. sharp */

test('sharp بار می‌شود و نسخه می‌دهد', async () => {
  const sharp = (await import('sharp')).default;
  assert.ok(sharp.versions.sharp, 'نسخه sharp باید موجود باشد');
  assert.ok(sharp.versions.vips, 'نسخه libvips باید موجود باشد');
});

test('sharp تصویر می‌سازد، تغییر اندازه می‌دهد و به WebP رمزگذاری می‌کند', async () => {
  const sharp = (await import('sharp')).default;
  const src = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 200, b: 200 } },
  }).png().toBuffer();

  const out = await sharp(src).resize(400, 400, { fit: 'contain' }).webp({ quality: 80 }).toBuffer();
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 400);
});

test('sharp ورودی غیرتصویری را رد می‌کند', async () => {
  const sharp = (await import('sharp')).default;
  await assert.rejects(() => sharp(Buffer.from('definitely not an image')).metadata());
});

/* ------------------------------------------- ۶. رندر صفحه راست‌به‌چپ */

test('صفحه اصلی با lang=fa و dir=rtl رندر می‌شود', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta charset="UTF-8"/i);
  assert.match(html, /viewport/);
});

test('صفحه اصلی مبلغ را با رقم فارسی و واحد تومان نشان می‌دهد', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.ok(html.includes('۱۲٬۵۰۰٬۰۰۰ تومان'), 'قالب‌بندی فارسی مبلغ باید در خروجی باشد');
});

test('شماره فنی داخل bdi قرار می‌گیرد تا جهتش به‌هم نریزد', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /<bdi class="part-number">9678191580<\/bdi>/);
});

test('۴۰۴ صفحه فارسی می‌دهد، نه ردپای پشته', async () => {
  const res = await fetch(`${BASE}/این-مسیر-وجود-ندارد`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /صفحه پیدا نشد/);
  assert.ok(!/at .*\.js:\d+/.test(html), 'نباید ردپای پشته نشان دهد');
});

test('هدرهای امنیتی روی پاسخ‌ها هستند', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null, 'نباید Express را لو بدهد');
  assert.ok(res.headers.get('content-security-policy'), 'CSP باید تنظیم شده باشد');
});

test('کوکی CSRF ساخته می‌شود و برای اسکریپت خواندنی است', async () => {
  const res = await fetch(`${BASE}/`);
  const setCookie = res.headers.getSetCookie?.() || [];
  const csrf = setCookie.find((c) => c.startsWith('pars_csrf='));
  assert.ok(csrf, 'کوکی CSRF باید ست شود');
  assert.ok(!/HttpOnly/i.test(csrf), 'کوکی CSRF نباید HttpOnly باشد');
});

/* -------------------------------------- کمکی‌های قالب‌بندی فارسی */

test('قالب‌بندی فارسی: رقم، مبلغ و نرمال‌سازی', () => {
  assert.equal(faDigits('1403'), '۱۴۰۳');
  assert.equal(toEnglishDigits('۱۴۰۳'), '1403');
  assert.equal(formatToman(12500000), '۱۲٬۵۰۰٬۰۰۰ تومان');
  assert.equal(formatToman(12500000, { withUnit: false }), '۱۲٬۵۰۰٬۰۰۰');
  assert.equal(formatToman('نه عدد'), '');
});

test('نرمال‌سازی فارسی: ی/ک عربی و نیم‌فاصله یکسان می‌شوند', () => {
  assert.equal(normalizePersian('كليد'), 'کلید');
  assert.equal(normalizePersian('مي‌شود'), 'می شود');
  assert.equal(normalizePersian('  فيلتر   روغن '), 'فیلتر روغن');
});

test('شماره موبایل ایران نرمال می‌شود', () => {
  assert.equal(normalizeMobile('09121234567'), '09121234567');
  assert.equal(normalizeMobile('+989121234567'), '09121234567');
  assert.equal(normalizeMobile('۰۹۱۲۱۲۳۴۵۶۷'), '09121234567');
  assert.equal(normalizeMobile('9121234567'), '09121234567');
  assert.equal(normalizeMobile('12345'), null);
});

test('کد پستی ده‌رقمی به‌صورت متن نگه داشته می‌شود', () => {
  assert.equal(normalizePostalCode('1234567890'), '1234567890');
  assert.equal(normalizePostalCode('0123456789'), '0123456789', 'صفر ابتدایی باید بماند');
  assert.equal(normalizePostalCode('123'), null);
});

/* -------------------------------------------- اعتبارسنجی آپلود */

test('تشخیص نوع فایل از روی بایت‌های ابتدایی، نه پسوند', async () => {
  const { sniffImageMime, validateUploadedImage } = await import('../src/middleware/security.js');
  const sharp = (await import('sharp')).default;

  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal(sniffImageMime(png), 'image/png');

  const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  assert.equal(sniffImageMime(jpg), 'image/jpeg');

  /* یک اسکریپت که خودش را .jpg جا می‌زند باید رد شود. */
  const evil = Buffer.from('<?php system($_GET["c"]); ?>');
  assert.equal(sniffImageMime(evil), null);
  assert.equal(validateUploadedImage(evil).ok, false);

  /* فایل بیش از حد بزرگ رد می‌شود. */
  const big = Buffer.alloc(6 * 1024 * 1024, 0);
  png.copy(big, 0);
  assert.equal(validateUploadedImage(big, { maxBytes: 5 * 1024 * 1024 }).ok, false);
});

test('نام فایل تصادفی است و نام ارسالی کاربر استفاده نمی‌شود', async () => {
  const { randomFilename } = await import('../src/middleware/security.js');
  const a = randomFilename('jpg');
  const b = randomFilename('jpg');
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}\.jpg$/);
  /* تلاش برای پیمایش مسیر باید بی‌اثر شود. */
  assert.ok(!randomFilename('../../etc/passwd').includes('/'));
});
