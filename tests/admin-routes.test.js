/* ============================================================================
 * tests/admin-routes.test.js — آزمون مسیرهای بخش مدیر (فاز ۲ب)
 * ----------------------------------------------------------------------------
 * برنامهٔ واقعی Express با پایگاه دادهٔ PGlite تزریق‌شده بالا می‌آید، پس
 * کوکی‌ها، هدایت‌ها، هدرها و مرز اجازهٔ دسترسی روی مسیر واقعی HTTP
 * آزموده می‌شوند.
 *
 * تمرکز ویژه روی تمایزی که در تأیید فاز ۲ آمده است:
 *   POST /admin/login  → CSRF عمومی و بدون‌حالت (هنوز نشستی نیست)
 *   POST /admin/logout → requireAdminAuth، سپس CSRF گره‌خورده به نشست
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* NODE_ENV باید *پیش از* بار شدن config تنظیم شود. دستور import در ESM
   بالاتر از هر عبارت دیگری اجرا می‌شود، پس import ایستا از ماژول‌های
   پروژه، config را با NODE_ENV اشتباه می‌سازد و محدودکنندهٔ نرخ ورود در
   آزمون روشن می‌ماند (نتیجه: ۴۲۹ به‌جای پاسخ واقعی). به همین دلیل
   ماژول‌های پروژه پویا import می‌شوند — همان الگوی foundation.test.js. */
process.env.NODE_ENV = 'test';

const { createTestDb } = await import('./helpers/testDb.js');
const { createAdminUserRepository } = await import('../src/db/repositories/adminUsers.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createCategoryRepository } = await import('../src/db/repositories/categories.js');
const { createBrandRepository } = await import('../src/db/repositories/brands.js');
const { hashPassword } = await import('../src/services/password.js');
const { config } = await import('../src/config/index.js');

const EMAIL = 'admin@example.test';
const PASSWORD = 'correct-horse-9-battery';

let db, server, BASE, adminUsers;

before(async () => {
  db = await createTestDb();
  adminUsers = createAdminUserRepository(db);

  const { createApp } = await import('../src/app.js');
  const app = createApp({
    db,
    repositories: {
      products: createProductRepository(db),
      categories: createCategoryRepository(db),
      brands: createBrandRepository(db),
    },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

beforeEach(async () => {
  await db.exec(`TRUNCATE admin_audit_log, admin_sessions, login_attempts, admin_users
                 RESTART IDENTITY CASCADE`);
  await adminUsers.create({
    email: EMAIL, passwordHash: await hashPassword(PASSWORD), displayName: 'مدیر آزمون',
  });
});

/* ----------------------------------------------------------- کمکی‌ها */

/** کوکی‌های Set-Cookie را به شکل نام→مقدار در می‌آورد. */
function parseCookies(res) {
  const out = {};
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i).trim()] = { value: pair.slice(i + 1).trim(), raw };
  }
  return out;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** گرفتن توکن CSRF عمومی از صفحهٔ ورود، همان‌طور که مرورگر می‌کند. */
async function openLoginPage() {
  const res = await fetch(`${BASE}/admin/login`);
  const html = await res.text();
  const cookies = parseCookies(res);
  const match = html.match(/name="_csrf" value="([^"]*)"/);
  return {
    res, html,
    csrfToken: match ? match[1] : '',
    jar: { [config.cookie.csrfName]: cookies[config.cookie.csrfName]?.value || '' },
  };
}

/** ورود کامل؛ ظرف کوکی و توکن‌ها را برمی‌گرداند. */
async function login({ email = EMAIL, password = PASSWORD } = {}) {
  const page = await openLoginPage();
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(page.jar) },
    body: new URLSearchParams({ email, password, _csrf: page.csrfToken }),
    redirect: 'manual',
  });
  const set = parseCookies(res);
  const jar = { ...page.jar };
  for (const [k, v] of Object.entries(set)) jar[k] = v.value;
  return { res, jar, setCookies: set, publicCsrf: page.csrfToken };
}

const authed = (jar, init = {}) => fetch(`${BASE}${init.path}`, {
  ...init,
  headers: { ...(init.headers || {}), Cookie: cookieHeader(jar) },
  redirect: 'manual',
});

/* ═══════════════════════════════ ۱. صفحهٔ ورود (عمومی) */

test('GET /admin/login عمومی است و فرم می‌دهد', async () => {
  const { res, html } = await openLoginPage();
  assert.equal(res.status, 200);
  assert.match(html, /ورود به بخش مدیریت/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
});

test('صفحهٔ ورود توکن CSRF عمومی دارد — نه گره‌خورده به نشست', async () => {
  const { csrfToken } = await openLoginPage();
  assert.ok(csrfToken.length > 10, 'فرم باید توکن CSRF داشته باشد');
});

test('صفحهٔ مدیر هرگز کش یا نمایه نمی‌شود', async () => {
  const { res } = await openLoginPage();
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

/* ═════════════════════════ ۲. ورود با CSRF عمومی */

test('POST /admin/login با CSRF عمومی موفق می‌شود و به پیشخان می‌برد', async () => {
  const { res } = await login();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin');
});

test('POST /admin/login بدون توکن CSRF رد می‌شود', async () => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD }),
    redirect: 'manual',
  });
  assert.equal(res.status, 403, 'CSRF عمومی باید لازم باشد');
});

test('POST /admin/login با توکن CSRF غلط رد می‌شود', async () => {
  const page = await openLoginPage();
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(page.jar) },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, _csrf: 'wrong' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 403);
});

test('ورود ناموفق ۴۰۱ و پیام عمومی می‌دهد و رمز را برنمی‌گرداند', async () => {
  const { res } = await login({ password: 'wrong-password' });
  assert.equal(res.status, 401);
  const html = await res.text();
  assert.match(html, /ایمیل یا رمز عبور درست نیست/);
  assert.ok(!html.includes('wrong-password'), 'رمز نباید در HTML بازتاب داده شود');
  assert.ok(html.includes(EMAIL), 'ایمیل برمی‌گردد تا دوباره تایپ نشود');
});

test('حساب ناموجود و رمز غلط پاسخ یکسان می‌دهند', async () => {
  const a = await login({ password: 'wrong' });
  const b = await login({ email: 'ghost@example.test', password: 'wrong' });
  assert.equal(a.res.status, b.res.status);
  const [ha, hb] = [await a.res.text(), await b.res.text()];
  const strip = (h) => h.replace(/value="[^"]*"/g, '');
  assert.equal(strip(ha), strip(hb), 'صفحه‌ها باید یکسان باشند تا وجود حساب لو نرود');
});

/* ═══════════════════════════════════ ۳. کوکی‌ها */

test('کوکی نشست HttpOnly و محدود به /admin است', async () => {
  const { setCookies } = await login();
  const session = setCookies[config.admin.cookieName];
  assert.ok(session, 'کوکی نشست باید ست شود');
  assert.match(session.raw, /HttpOnly/i, 'باید HttpOnly باشد');
  assert.match(session.raw, /Path=\/admin/i, 'نباید روی صفحه‌های عمومی فرستاده شود');
  assert.match(session.raw, /SameSite=Lax/i);
});

test('کوکی CSRF مدیر هم HttpOnly است', async () => {
  const { setCookies } = await login();
  const csrf = setCookies[config.admin.csrfCookieName];
  assert.ok(csrf, 'کوکی CSRF مدیر باید ست شود');
  assert.match(csrf.raw, /HttpOnly/i,
    'سرور خودش آن را در فرم می‌گذارد، پس جاوااسکریپت لازم نیست بخواندش');
  assert.match(csrf.raw, /Path=\/admin/i);
});

test('کوکی نشست، خودِ توکن پایگاه داده نیست', async () => {
  const { setCookies } = await login();
  const token = setCookies[config.admin.cookieName].value;
  const rows = await db.query('SELECT token_hash FROM admin_sessions');
  assert.notEqual(rows.rows[0].token_hash, token, 'پایگاه داده باید هش را نگه دارد، نه توکن');
});

test('کوکی Secure در تولید — گزینه‌ها از config می‌آیند', async () => {
  /* در آزمون NODE_ENV=test است پس Secure خاموش است؛ خود قاعده سنجیده می‌شود. */
  const { adminCookieOptions } = await import('../src/middleware/adminAuth.js');
  assert.equal(adminCookieOptions().secure, config.cookie.secure);
  assert.equal(adminCookieOptions().httpOnly, true);
  assert.equal(adminCookieOptions().path, '/admin');
  assert.equal(config.isProd, false, 'آزمون در حالت تولید اجرا نمی‌شود');
});

/* ═════════════════════════ ۴. مرز اجازهٔ دسترسی */

test('GET /admin بدون ورود به صفحهٔ ورود هدایت می‌شود', async () => {
  const res = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('درخواست تغییردهندهٔ بدون ورود ۴۰۱ می‌دهد — نه ۴۰۳', async () => {
  const res = await fetch(`${BASE}/admin/logout`, { method: 'POST', redirect: 'manual' });
  assert.equal(res.status, 401,
    'requireAdminAuth باید پیش از requireAdminCsrf اجرا شود؛ ۴۰۳ یعنی ترتیب برعکس است');
  const body = await res.json();
  assert.equal(body.code, 'unauthenticated');
});

test('نشست معتبر به پیشخان می‌رسد', async () => {
  const { jar } = await login();
  const res = await authed(jar, { path: '/admin' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /پیشخان/);
  assert.match(html, /مدیر آزمون/);
});

test('کوکی نشست جعلی پذیرفته نمی‌شود', async () => {
  const res = await authed({ [config.admin.cookieName]: 'made-up-token' }, { path: '/admin' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('مدیرِ واردشده از صفحهٔ ورود به پیشخان هدایت می‌شود', async () => {
  const { jar } = await login();
  const res = await authed(jar, { path: '/admin/login' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin');
});

test('صفحه‌های عمومی کاتالوگ دست‌نخورده می‌مانند', async () => {
  for (const path of ['/', '/products', '/health']) {
    const res = await fetch(`${BASE}${path}`);
    assert.equal(res.status, 200, `${path} نباید تحت تأثیر بخش مدیر باشد`);
  }
});

/* ═══════════════════ ۵. خروج: احراز هویت، سپس CSRF نشست */

test('خروج با توکن CSRF نشست موفق می‌شود', async () => {
  const { jar } = await login();

  /* توکن را از فرم پیشخان می‌خوانیم — همان کاری که مرورگر می‌کند. */
  const dash = await authed(jar, { path: '/admin' });
  const html = await dash.text();
  const token = html.match(/name="_csrf" value="([^"]*)"/)[1];
  assert.ok(token.length > 10, 'فرم خروج باید توکن داشته باشد');

  const res = await authed(jar, {
    path: '/admin/logout', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');

  /* نشست باید واقعا باطل شده باشد، نه فقط کوکی پاک. */
  const after = await authed(jar, { path: '/admin' });
  assert.equal(after.status, 302, 'نشست باید در پایگاه داده باطل شده باشد');
  const revoked = await db.query('SELECT revoked_at FROM admin_sessions');
  assert.ok(revoked.rows[0].revoked_at, 'revoked_at باید پر شده باشد');
});

test('خروج بدون توکن CSRF ۴۰۳ می‌دهد و نشست زنده می‌ماند', async () => {
  const { jar } = await login();
  const res = await authed(jar, {
    path: '/admin/logout', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({}),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'csrf_invalid');
  assert.equal((await authed(jar, { path: '/admin' })).status, 200, 'نشست باید زنده بماند');
});

test('خروج با توکن CSRF عمومی (نه نشستی) رد می‌شود', async () => {
  const { jar, publicCsrf } = await login();
  const res = await authed(jar, {
    path: '/admin/logout', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: publicCsrf }),
  });
  assert.equal(res.status, 403,
    'توکن عمومی نباید برای عمل تغییردهندهٔ احراز هویت‌شده کافی باشد');
});

test('توکن CSRF نشست دیگر روی این نشست کار نمی‌کند', async () => {
  await adminUsers.create({
    email: 'other@example.test', passwordHash: await hashPassword(PASSWORD),
  });
  const other = await login({ email: 'other@example.test' });
  const otherDash = await authed(other.jar, { path: '/admin' });
  const otherToken = (await otherDash.text()).match(/name="_csrf" value="([^"]*)"/)[1];

  const mine = await login();
  const res = await authed(mine.jar, {
    path: '/admin/logout', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: otherToken }),
  });
  assert.equal(res.status, 403, 'توکن نشست دیگر باید رد شود');
});

test('خروج هر دو کوکی را پاک می‌کند', async () => {
  const { jar } = await login();
  const dash = await authed(jar, { path: '/admin' });
  const token = (await dash.text()).match(/name="_csrf" value="([^"]*)"/)[1];

  const res = await authed(jar, {
    path: '/admin/logout', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token }),
  });
  const cleared = parseCookies(res);
  assert.ok(cleared[config.admin.cookieName], 'کوکی نشست باید پاک شود');
  assert.ok(cleared[config.admin.csrfCookieName], 'کوکی CSRF هم باید پاک شود');
});

/* ══════════════════════ ۶. تثبیت نشست روی مسیر HTTP */

test('ورود دوباره، نشست قبلی را از کار می‌اندازد', async () => {
  const first = await login();
  assert.equal((await authed(first.jar, { path: '/admin' })).status, 200);

  const second = await login();
  assert.notEqual(
    second.setCookies[config.admin.cookieName].value,
    first.setCookies[config.admin.cookieName].value,
    'توکن باید چرخانده شود'
  );
  assert.equal((await authed(first.jar, { path: '/admin' })).status, 302,
    'نشست قبلی باید باطل شده باشد');
  assert.equal((await authed(second.jar, { path: '/admin' })).status, 200);
});

/* ══════════════════════════ ۷. محدودسازی و رد پا */

test('پس از تلاش‌های ناموفق، ورود قفل می‌شود', async () => {
  for (let i = 0; i < config.admin.lockout.maxPerIdentifier; i++) {
    await login({ password: 'bad' });
  }
  const locked = await login();
  const html = await locked.res.text();
  assert.equal(locked.res.status, 401);
  assert.match(html, /تلاش‌های ناموفق زیاد/, 'حتی با رمز درست باید قفل باشد');
});

test('پیشخان رد پای ورود را نشان می‌دهد', async () => {
  const { jar } = await login();
  const html = await (await authed(jar, { path: '/admin' })).text();
  assert.match(html, /admin\.login\.success/);
  assert.match(html, /آخرین فعالیت/);
});

/* ══════════════════════════════════ ۸. پایه و امنیت */

test('صفحه‌های مدیر راست‌به‌چپ و فارسی‌اند', async () => {
  const { jar } = await login();
  const html = await (await authed(jar, { path: '/admin' })).text();
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
});

test('هدرهای امنیتی روی بخش مدیر هم فعالند', async () => {
  const { jar } = await login();
  const res = await authed(jar, { path: '/admin' });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('مسیر ناشناس زیر /admin نشتی ندارد', async () => {
  const res = await fetch(`${BASE}/admin/does-not-exist`, { redirect: 'manual' });
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(!/at .*\.js:\d+/.test(html), 'نباید ردپای پشته بدهد');
});

test('ایمیل مدیر در HTML فرار داده می‌شود', async () => {
  await db.exec('TRUNCATE admin_sessions, admin_users RESTART IDENTITY CASCADE');
  await adminUsers.create({
    email: 'x@example.test', passwordHash: await hashPassword(PASSWORD),
    displayName: '<script>alert(1)</script>',
  });
  const { jar } = await login({ email: 'x@example.test' });
  const html = await (await authed(jar, { path: '/admin' })).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});
