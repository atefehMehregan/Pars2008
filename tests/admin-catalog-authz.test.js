/* ============================================================================
 * tests/admin-catalog-authz.test.js — مرز اجازهٔ دسترسی مدیریت کاتالوگ
 * ----------------------------------------------------------------------------
 * این آزمون عمدا *پیش از* ساخته شدن فرم‌ها و رفتار واقعی CRUD نوشته شده
 * است. قفل باید پیش از چیزی که قفل می‌کند وجود داشته باشد، وگرنه بازه‌ای
 * می‌ماند که مسیر نوشتن باز است.
 *
 * هر مسیر مدیریت کاتالوگ در برابر همهٔ حالت‌ها سنجیده می‌شود — نه یک
 * نمونهٔ منتخب. اگر فردا مسیری اضافه شود و به این فهرست‌ها اضافه نشود،
 * آزمونِ «فهرست کامل است» آن را لو می‌دهد.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* NODE_ENV باید پیش از بار شدن config تنظیم شود — وگرنه محدودکنندهٔ نرخ
   روشن می‌ماند و پاسخ‌ها ۴۲۹ می‌شوند. همان الگوی admin-routes.test.js. */
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

/* متدهایی که داده را عوض می‌کنند. هیچ‌کدام نباید در درخواست بی‌اجازه
   اجرا شوند — «۴۰۱ گرفتم» کافی نیست اگر نوشتن قبلش اتفاق افتاده باشد. */
const WRITE_METHODS = ['create', 'update', 'remove', 'setActive', 'adjustStock'];

let db, server, BASE, adminUsers, writeLog;

/** مخزن‌های واقعی، با شمارندهٔ فراخوانیِ متدهای نویسنده. */
function countingRepositories(database) {
  const repos = {
    products: createProductRepository(database),
    categories: createCategoryRepository(database),
    brands: createBrandRepository(database),
  };
  const log = { calls: [] };
  for (const [name, repo] of Object.entries(repos)) {
    for (const method of WRITE_METHODS) {
      if (typeof repo[method] !== 'function') continue;
      const original = repo[method];
      repo[method] = async (...args) => {
        log.calls.push(`${name}.${method}`);
        return original(...args);
      };
    }
  }
  return { repos, log };
}

before(async () => {
  db = await createTestDb();
  adminUsers = createAdminUserRepository(db);

  const { repos, log } = countingRepositories(db);
  writeLog = log;

  const { createApp } = await import('../src/app.js');
  const app = createApp({ db, repositories: repos });
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
  writeLog.calls.length = 0;
});

/* ----------------------------------------------------------- کمکی‌ها */

function parseCookies(res) {
  const out = {};
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i).trim()] = { value: pair.slice(i + 1).trim(), raw };
  }
  return out;
}

const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function openLoginPage() {
  const res = await fetch(`${BASE}/admin/login`);
  const html = await res.text();
  const cookies = parseCookies(res);
  const match = html.match(/name="_csrf" value="([^"]*)"/);
  return {
    csrfToken: match ? match[1] : '',
    jar: { [config.cookie.csrfName]: cookies[config.cookie.csrfName]?.value || '' },
  };
}

/** ورود کامل — همان الگوی کمکیِ admin-routes.test.js. */
async function login({ email = EMAIL, password = PASSWORD } = {}) {
  const page = await openLoginPage();
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(page.jar) },
    body: new URLSearchParams({ email, password, _csrf: page.csrfToken }),
    redirect: 'manual',
  });
  const jar = { ...page.jar };
  for (const [k, v] of Object.entries(parseCookies(res))) jar[k] = v.value;
  return { res, jar, publicCsrf: page.csrfToken };
}

/** توکن CSRFِ گره‌خورده به نشست، از فرم خروجِ پیشخان. */
async function sessionCsrf(jar) {
  const res = await fetch(`${BASE}/admin`, { headers: { Cookie: cookieHeader(jar) } });
  const html = await res.text();
  return html.match(/name="_csrf" value="([^"]*)"/)[1];
}

const get = (path, jar) =>
  fetch(`${BASE}${path}`, {
    headers: jar ? { Cookie: cookieHeader(jar) } : {},
    redirect: 'manual',
  });

const post = (path, { jar, csrf } = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(jar ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: new URLSearchParams(csrf === undefined ? {} : { _csrf: csrf }),
    redirect: 'manual',
  });

/* ------------------------------------------------------- فهرست مسیرها */

const GET_PAGES = [
  '/admin/catalogue/products',
  '/admin/catalogue/products/new',
  '/admin/catalogue/products/1/edit',
  '/admin/catalogue/categories',
  '/admin/catalogue/categories/new',
  '/admin/catalogue/categories/1/edit',
  '/admin/catalogue/brands',
  '/admin/catalogue/brands/new',
  '/admin/catalogue/brands/1/edit',
];

const POST_ROUTES = [
  '/admin/catalogue/products',
  '/admin/catalogue/products/1',
  '/admin/catalogue/products/1/delete',
  '/admin/catalogue/products/1/active',
  '/admin/catalogue/products/1/stock',
  '/admin/catalogue/categories',
  '/admin/catalogue/categories/1',
  '/admin/catalogue/categories/1/delete',
  '/admin/catalogue/categories/1/active',
  '/admin/catalogue/brands',
  '/admin/catalogue/brands/1',
  '/admin/catalogue/brands/1/delete',
  '/admin/catalogue/brands/1/active',
];

/* ======================================== ۱. دسترسی مدیرِ واردشده ==== */

test('مدیر واردشده به همهٔ صفحه‌های کاتالوگ دسترسی دارد', async () => {
  const { jar } = await login();
  for (const path of GET_PAGES) {
    const res = await get(path, jar);
    assert.equal(res.status, 200, `${path} باید ۲۰۰ بدهد`);
  }
});

test('ریشهٔ کاتالوگ مدیر را به فهرست محصول‌ها می‌فرستد', async () => {
  const { jar } = await login();
  const res = await get('/admin/catalogue', jar);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/catalogue/products',
    'هدایت باید به فهرست محصول باشد، نه به صفحهٔ ورود');
});

test('مدیر واردشده با توکن معتبرِ همین نشست می‌تواند POST کند', async () => {
  const { jar } = await login();
  const csrf = await sessionCsrf(jar);
  for (const path of POST_ROUTES) {
    const res = await post(path, { jar, csrf });
    assert.equal(res.status, 200, `${path} با توکن معتبر باید بگذرد`);
  }
});

/* ============================================ ۲. کاربر واردنشده ===== */

test('GET بدون ورود به صفحهٔ ورود هدایت می‌شود', async () => {
  for (const path of [...GET_PAGES, '/admin/catalogue']) {
    const res = await get(path);
    assert.equal(res.status, 302, `${path} باید هدایت شود`);
    assert.equal(res.headers.get('location'), '/admin/login',
      `${path} باید به صفحهٔ ورود برود`);
  }
});

test('POST بدون ورود با ۴۰۱ رد می‌شود، نه با هدایت', async () => {
  for (const path of POST_ROUTES) {
    const res = await post(path, { csrf: 'anything' });
    assert.equal(res.status, 401, `${path} باید ۴۰۱ بدهد`);
    const body = await res.json();
    assert.equal(body.code, 'unauthenticated');
  }
});

test('درخواست بی‌اجازه هیچ متد نویسنده‌ای را اجرا نمی‌کند', async () => {
  /* گرفتن ۴۰۱ کافی نیست اگر نوشتن پیش از آن اتفاق افتاده باشد. */
  for (const path of POST_ROUTES) await post(path, { csrf: 'anything' });
  for (const path of GET_PAGES) await get(path);

  const { jar } = await login();
  for (const path of POST_ROUTES) await post(path, { jar });          // بدون CSRF
  for (const path of POST_ROUTES) await post(path, { jar, csrf: 'wrong' });

  assert.deepEqual(writeLog.calls, [],
    `هیچ نوشتنی نباید رخ می‌داد، ولی این‌ها اجرا شدند: ${writeLog.calls.join(', ')}`);
});

/* =================================================== ۳. CSRF ======== */

test('POST بدون توکن CSRF با ۴۰۳ رد می‌شود', async () => {
  const { jar } = await login();
  for (const path of POST_ROUTES) {
    const res = await post(path, { jar });
    assert.equal(res.status, 403, `${path} بدون توکن باید ۴۰۳ بدهد`);
    assert.equal((await res.json()).code, 'csrf_invalid');
  }
});

test('POST با توکن CSRF غلط با ۴۰۳ رد می‌شود', async () => {
  const { jar } = await login();
  for (const path of POST_ROUTES) {
    const res = await post(path, { jar, csrf: 'not-the-right-token' });
    assert.equal(res.status, 403, `${path} با توکن غلط باید ۴۰۳ بدهد`);
    assert.equal((await res.json()).code, 'csrf_invalid');
  }
});

test('توکن CSRF عمومیِ صفحهٔ ورود برای تغییرات کاتالوگ پذیرفته نمی‌شود', async () => {
  /* این تمایز، تصمیم آگاهانهٔ فاز ۲ است: توکن بدون‌حالتِ ورود هرگز
     جای توکن گره‌خورده به نشست را نمی‌گیرد. */
  const { jar, publicCsrf } = await login();
  assert.ok(publicCsrf.length > 10, 'توکن عمومی باید وجود داشته باشد');

  for (const path of POST_ROUTES) {
    const res = await post(path, { jar, csrf: publicCsrf });
    assert.equal(res.status, 403, `${path} نباید توکن عمومی را بپذیرد`);
    assert.equal((await res.json()).code, 'csrf_invalid');
  }
});

test('توکن CSRF نشستِ دیگر پذیرفته نمی‌شود', async () => {
  const first = await login();
  const firstCsrf = await sessionCsrf(first.jar);

  /* ورود دوم نشست تازه می‌سازد و نشست قبلی را باطل می‌کند. */
  const second = await login();
  const secondCsrf = await sessionCsrf(second.jar);
  assert.notEqual(firstCsrf, secondCsrf, 'دو نشست باید دو توکن متفاوت داشته باشند');

  const res = await post('/admin/catalogue/products', { jar: second.jar, csrf: firstCsrf });
  assert.equal(res.status, 403, 'توکن نشست دیگر باید رد شود');
  assert.equal((await res.json()).code, 'csrf_invalid');
});

test('توکن درست با ظرف کوکیِ واردنشده کار نمی‌کند', async () => {
  const { jar } = await login();
  const csrf = await sessionCsrf(jar);
  const res = await post('/admin/catalogue/products', { csrf });   // بدون کوکی نشست
  assert.equal(res.status, 401, 'بدون نشست باید ۴۰۱ بدهد، نه ۴۰۳');
});

/* ============================================ ۴. هدرها و کش ======== */

test('هدرهای no-store بخش مدیر روی مسیرهای کاتالوگ هم هستند', async () => {
  const { jar } = await login();
  const res = await get('/admin/catalogue/products', jar);
  assert.match(res.headers.get('cache-control'), /no-store/,
    'صفحهٔ مدیر نباید در کش بماند');
  assert.match(res.headers.get('x-robots-tag'), /noindex/,
    'بخش مدیر هرگز نباید نمایه شود');
});

test('هدرهای no-store روی پاسخ ردشده هم هستند', async () => {
  /* پاسخ ۴۰۱ و ۳۰۲ هم از همان میان‌افزار رد می‌شوند. */
  const res = await get('/admin/catalogue/products');
  assert.match(res.headers.get('cache-control'), /no-store/);
});

/* ==================================== ۵. مرز، نه فقط نمونه‌ها ======= */

test('فهرست مسیرهای این آزمون با مسیرهای واقعی مسیریاب یکی است', async () => {
  /* اگر فردا مسیری اضافه شود و اینجا نیاید، بی‌آزمون می‌ماند. این
     آزمون همان لحظه شکست می‌خورد. */
  const { createAdminCatalogRouter } = await import('../src/routes/adminCatalog.js');
  const router = createAdminCatalogRouter({
    repositories: { products: {}, categories: {}, brands: {} },
    requireAdminAuth: (req, res, next) => next(),
    requireAdminCsrf: (req, res, next) => next(),
  });

  const declared = { GET: [], POST: [] };
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    for (const method of Object.keys(layer.route.methods)) {
      declared[method.toUpperCase()]?.push(path);
    }
  }

  const strip = (p) => p.replace('/admin/catalogue', '') || '/';
  const asParam = (p) => strip(p).replace(/\/1(\/|$)/, '/:id$1');

  const expectedGet = ['/', ...GET_PAGES.map(asParam)].sort();
  const expectedPost = POST_ROUTES.map(asParam).sort();

  assert.deepEqual(declared.GET.sort(), expectedGet, 'مسیرهای GET باید کامل پوشش داده شوند');
  assert.deepEqual(declared.POST.sort(), expectedPost, 'مسیرهای POST باید کامل پوشش داده شوند');
});

test('ترتیب requireAdminAuth → requireAdminCsrf در مسیریاب حفظ شده است', async () => {
  /* چرا ساختاری و نه رفتاری؟ چون جابه‌جا کردن این دو از بیرون دیده
     نمی‌شود: requireAdminCsrf خودش نبودِ نشست را با ۴۰۱ رد می‌کند، پس
     کدهای وضعیت در هر دو ترتیب یکی می‌مانند. تنها راه تضمین این ثابت،
     سنجیدن خودِ سیم‌کشی است.

     اگر این آزمون نبود، ترتیب می‌توانست برعکس شود بی‌آنکه هیچ آزمونی
     شکست بخورد — و مسیری می‌ماند که محافظت‌شده به نظر می‌رسد. */
  const { createAdminCatalogRouter } = await import('../src/routes/adminCatalog.js');

  const requireAdminAuth = (req, res, next) => next();
  const requireAdminCsrf = (req, res, next) => next();
  const router = createAdminCatalogRouter({
    repositories: { products: {}, categories: {}, brands: {} },
    requireAdminAuth,
    requireAdminCsrf,
  });

  const authIndex = router.stack.findIndex((l) => l.handle === requireAdminAuth);
  const csrfIndex = router.stack.findIndex((l) => l.handle === requireAdminCsrf);
  const firstRouteIndex = router.stack.findIndex((l) => l.route);

  assert.ok(authIndex >= 0, 'requireAdminAuth باید سیم‌کشی شده باشد');
  assert.ok(csrfIndex >= 0, 'requireAdminCsrf باید سیم‌کشی شده باشد');
  assert.ok(authIndex < csrfIndex,
    'requireAdminAuth باید پیش از requireAdminCsrf بیاید — این ثابت هرگز برعکس نمی‌شود');
  assert.ok(csrfIndex < firstRouteIndex,
    'هر دو میان‌افزار باید پیش از همهٔ مسیرها باشند، نه مسیر به مسیر');
});

test('مسیریاب بدون میان‌افزار یا بدون مخزن ساخته نمی‌شود', async () => {
  const { createAdminCatalogRouter } = await import('../src/routes/adminCatalog.js');
  assert.throws(() => createAdminCatalogRouter({}), /میان‌افزار/);
  assert.throws(
    () => createAdminCatalogRouter({
      requireAdminAuth: () => {}, requireAdminCsrf: () => {},
    }),
    /مخزن/
  );
});
