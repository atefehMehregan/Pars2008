/* ============================================================================
 * tests/admin-vehicle-routes.test.js — مسیرهای مدیریت خودرو (فاز ۶)
 * ----------------------------------------------------------------------------
 * برنامهٔ واقعی Express با PGlite. مرز اجازهٔ دسترسی، CSRF، اعتبارسنجی و
 * نگهبانِ «پاک نشدن ناخواستهٔ سازگاری» همگی روی HTTP واقعی سنجیده می‌شوند.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertProduct } = await import('./helpers/testDb.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createCategoryRepository } = await import('../src/db/repositories/categories.js');
const { createBrandRepository } = await import('../src/db/repositories/brands.js');
const { createVehicleRepository } = await import('../src/db/repositories/vehicles.js');
const { createAdminUserRepository } = await import('../src/db/repositories/adminUsers.js');
const { hashPassword } = await import('../src/services/password.js');

const EMAIL = 'vehicles@example.test';
const PASSWORD = 'correct-horse-9-battery';
const BASE_PATH = '/admin/catalogue/vehicles';

let db, server, BASE, vehicles, products, adminUsers;

function parseCookies(res) {
  const out = {};
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function login() {
  const page = await fetch(`${BASE}/admin/login`);
  const html = await page.text();
  const jar = { ...parseCookies(page) };
  const token = (html.match(/name="_csrf" value="([^"]*)"/) || [])[1] || '';
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, _csrf: token }),
    redirect: 'manual',
  });
  Object.assign(jar, parseCookies(res));
  return jar;
}

async function csrfFrom(jar, path) {
  const html = await (await fetch(`${BASE}${path}`, { headers: { Cookie: cookieHeader(jar) } })).text();
  return (html.match(/name="_csrf" value="([^"]*)"/) || [])[1] || '';
}

const post = (jar, path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
  body: new URLSearchParams(body),
  redirect: 'manual',
});

const validForm = (over = {}) => ({
  make: 'سازندهٔ نمونه', model: 'مدل نمونه',
  displayName: 'خودروی نمونه', slug: '', isActive: 'on', ...over,
});

before(async () => {
  db = await createTestDb();
  vehicles = createVehicleRepository(db);
  products = createProductRepository(db);
  adminUsers = createAdminUserRepository(db);

  const { createApp } = await import('../src/app.js');
  const app = createApp({
    db,
    repositories: {
      products,
      categories: createCategoryRepository(db),
      brands: createBrandRepository(db),
      vehicles,
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
  await db.exec(`TRUNCATE product_vehicle, products, vehicles, categories,
                 admin_audit_log, admin_sessions, login_attempts, admin_users
                 RESTART IDENTITY CASCADE`);
  await adminUsers.create({ email: EMAIL, passwordHash: await hashPassword(PASSWORD) });
});

/* ═══════════════════════════ ۱. مرز اجازهٔ دسترسی */

test('GET بدون ورود به صفحهٔ ورود هدایت می‌شود', async () => {
  const res = await fetch(`${BASE}${BASE_PATH}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('همهٔ مسیرهای نوشتن بدون نشست ۴۰۱ می‌دهند', async () => {
  for (const path of [BASE_PATH, `${BASE_PATH}/1`, `${BASE_PATH}/1/delete`, `${BASE_PATH}/1/active`]) {
    const res = await post({}, path, { _csrf: 'x' });
    assert.equal(res.status, 401, path);
  }
  assert.equal((await vehicles.adminList()).length, 0);
});

test('ساخت بدون توکن CSRF رد می‌شود و چیزی ثبت نمی‌شود', async () => {
  const jar = await login();
  const res = await post(jar, BASE_PATH, validForm({ _csrf: 'wrong' }));
  assert.equal(res.status, 403);
  assert.equal((await vehicles.adminList()).length, 0);
});

test('صفحه‌های خودرو کش و نمایه نمی‌شوند', async () => {
  const jar = await login();
  const res = await fetch(`${BASE}${BASE_PATH}`, { headers: { Cookie: cookieHeader(jar) } });
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

/* ═══════════════════════════════════ ۲. CRUD */

test('ساخت خودرو با داده درست انجام می‌شود', async () => {
  const jar = await login();
  const res = await post(jar, BASE_PATH,
    validForm({ _csrf: await csrfFrom(jar, `${BASE_PATH}/new`) }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /flash=created/);

  const rows = await vehicles.adminList();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, 'خودروی نمونه');
  assert.equal(rows[0].generation, null, 'دادهٔ توصیفی ساخته نمی‌شود');
});

test('نشانی از نام نمایشی ساخته می‌شود وقتی خالی باشد', async () => {
  const jar = await login();
  await post(jar, BASE_PATH, validForm({ _csrf: await csrfFrom(jar, `${BASE_PATH}/new`) }));
  const [row] = await vehicles.adminList();
  assert.ok(row.slug.length > 0);
  assert.ok(!row.slug.includes(' '), 'نشانی نباید فاصله داشته باشد');
});

test('فرم نامعتبر ۴۲۲ می‌دهد و مقدارها را نگه می‌دارد', async () => {
  const jar = await login();
  const res = await post(jar, BASE_PATH, validForm({
    _csrf: await csrfFrom(jar, `${BASE_PATH}/new`), make: '', displayName: 'نگه‌داشته‌شده',
  }));
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /نگه‌داشته‌شده/, 'مقدار واردشده نباید گم شود');
  assert.equal((await vehicles.adminList()).length, 0);
});

test('بازهٔ سال معکوس با پیام فارسی روی فیلد «تا سال» رد می‌شود', async () => {
  const jar = await login();
  const res = await post(jar, BASE_PATH, validForm({
    _csrf: await csrfFrom(jar, `${BASE_PATH}/new`), yearFrom: '2020', yearTo: '2015',
  }));
  assert.equal(res.status, 422);
  assert.match(await res.text(), /نباید کوچک‌تر از «از سال» باشد/);
  assert.equal((await vehicles.adminList()).length, 0, 'به پایگاه داده نمی‌رسد');
});

test('رقم فارسی در سال پذیرفته می‌شود', async () => {
  const jar = await login();
  const res = await post(jar, BASE_PATH, validForm({
    _csrf: await csrfFrom(jar, `${BASE_PATH}/new`), yearFrom: '۲۰۱۵', yearTo: '۲۰۲۰',
  }));
  assert.equal(res.status, 303);
  const [row] = await vehicles.adminList();
  assert.equal(row.year_from, 2015);
  assert.equal(row.year_to, 2020);
});

test('نشانی تکراری پیام فارسی می‌دهد، نه خطای پایگاه داده', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'تکراری' }));
  const res = await post(jar, BASE_PATH,
    validForm({ _csrf: csrf, slug: 'تکراری', displayName: 'دیگری' }));
  assert.equal(res.status, 422);
  assert.match(await res.text(), /این نشانی قبلا استفاده شده است/);
});

test('ویرایش و فعال/غیرفعال کردن کار می‌کند', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf }));
  const [row] = await vehicles.adminList();

  const upd = await post(jar, `${BASE_PATH}/${row.id}`,
    validForm({ _csrf: csrf, displayName: 'نام تازه', slug: row.slug }));
  assert.equal(upd.status, 303);
  assert.equal((await vehicles.findById(row.id)).display_name, 'نام تازه');

  await post(jar, `${BASE_PATH}/${row.id}/active`, { _csrf: csrf, isActive: 'no' });
  assert.equal((await vehicles.findById(row.id)).is_active, false);
});

test('حذف بدون تأیید صریح انجام نمی‌شود', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf }));
  const [row] = await vehicles.adminList();

  const res = await post(jar, `${BASE_PATH}/${row.id}/delete`, { _csrf: csrf });
  assert.equal(res.status, 422);
  assert.ok(await vehicles.findById(row.id), 'باید سر جایش بماند');
});

test('حذف خودروی دارای محصول پیام فارسی می‌دهد، نه ۵۰۰', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf }));
  const [row] = await vehicles.adminList();

  const cat = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: cat, slug: 'p1', sku: 'S1' });
  await products.setVehicles(pid, [row.id]);

  const res = await post(jar, `${BASE_PATH}/${row.id}/delete`, { _csrf: csrf, confirm: 'yes' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /error=vehicle_has_products/);
  assert.ok(await vehicles.findById(row.id));

  const list = await (await fetch(`${BASE}${BASE_PATH}?error=vehicle_has_products`,
    { headers: { Cookie: cookieHeader(jar) } })).text();
  assert.match(list, /این خودرو به محصول‌هایی وصل است/);
});

test('حذف خودروی بدون پیوند انجام می‌شود', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf }));
  const [row] = await vehicles.adminList();

  const res = await post(jar, `${BASE_PATH}/${row.id}/delete`, { _csrf: csrf, confirm: 'yes' });
  assert.equal(res.status, 303);
  assert.equal(await vehicles.findById(row.id), null);
});

test('شناسهٔ بدشکل به فهرست خودروها برمی‌گردد', async () => {
  const jar = await login();
  const res = await fetch(`${BASE}${BASE_PATH}/abc/edit`,
    { headers: { Cookie: cookieHeader(jar) }, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /vehicles\?error=not_found/);
});

test('نام خودرو در HTML فرار داده می‌شود', async () => {
  const jar = await login();
  await post(jar, BASE_PATH, validForm({
    _csrf: await csrfFrom(jar, `${BASE_PATH}/new`), displayName: '<script>alert(1)</script>',
  }));
  const html = await (await fetch(`${BASE}${BASE_PATH}`,
    { headers: { Cookie: cookieHeader(jar) } })).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('ساخت و حذف خودرو در رد پا ثبت می‌شوند', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf }));
  const [row] = await vehicles.adminList();
  await post(jar, `${BASE_PATH}/${row.id}/delete`, { _csrf: csrf, confirm: 'yes' });

  const actions = (await db.query('SELECT action FROM admin_audit_log ORDER BY id')).rows
    .map((r) => r.action);
  assert.ok(actions.includes('catalog.vehicle.created'));
  assert.ok(actions.includes('catalog.vehicle.deleted'));
});

/* ═══════════════ ۳. پیوند از فرم محصول — و نگهبانِ پاک نشدن */

const productForm = (over = {}) => ({
  name: 'قطعهٔ نمونه', slug: 'قطعه-نمونه', sku: 'SAMPLE-1',
  categoryId: '', priceToman: '100000', stockQty: '1', availability: 'in_stock', ...over,
});

test('انتخاب خودرو از فرم محصول ذخیره می‌شود و پیاپی عوض می‌شود', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  const mk = async (n) => {
    await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: `v-${n}`, displayName: `خودروی ${n}` }));
    return (await vehicles.adminList()).find((v) => v.slug === `v-${n}`).id;
  };
  const v1 = await mk(1); const v2 = await mk(2);
  const catId = await insertCategory(db);

  const create = await post(jar, '/admin/catalogue/products', productForm({
    _csrf: csrf, categoryId: String(catId), vehiclesSubmitted: '1', vehicles: String(v1),
  }));
  assert.equal(create.status, 303);
  const [prod] = (await products.adminList()).items;
  assert.deepEqual(await products.vehicleIdsFor(prod.id), [v1]);

  /* بار دوم — همان جایی که الگوی فاز ۵ می‌شکست. */
  const body = new URLSearchParams(productForm({
    _csrf: csrf, slug: prod.slug, sku: prod.sku, categoryId: String(catId), vehiclesSubmitted: '1',
  }));
  body.append('vehicles', String(v1));
  body.append('vehicles', String(v2));
  const upd = await fetch(`${BASE}/admin/catalogue/products/${prod.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body, redirect: 'manual',
  });
  assert.equal(upd.status, 303);
  assert.deepEqual((await products.vehicleIdsFor(prod.id)).sort((a, b) => a - b),
    [v1, v2].sort((a, b) => a - b));
});

test('فرمِ بدون فیلد نگهبان، سازگاری موجود را پاک نمی‌کند', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'v-keep', displayName: 'ماندنی' }));
  const vid = (await vehicles.adminList())[0].id;

  const catId = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: catId, slug: 'p-keep', sku: 'K1' });
  await products.setVehicles(pid, [vid]);

  /* ویرایش سریع موجودی — این فرم vehiclesSubmitted ندارد. */
  const quick = await post(jar, `/admin/catalogue/products/${pid}/stock`,
    { _csrf: csrf, stockQty: '7' });
  assert.equal(quick.status, 303);
  assert.deepEqual(await products.vehicleIdsFor(pid), [vid], 'پیوند نباید پاک شود');

  /* فعال/غیرفعال کردن — این هم ندارد. */
  await post(jar, `/admin/catalogue/products/${pid}/active`, { _csrf: csrf, isActive: 'no' });
  assert.deepEqual(await products.vehicleIdsFor(pid), [vid], 'پیوند نباید پاک شود');
});

test('فیلد نگهبان بدون هیچ انتخابی، همهٔ پیوندها را برمی‌دارد', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'v-clr', displayName: 'پاک‌شدنی' }));
  const vid = (await vehicles.adminList())[0].id;
  const catId = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: catId, slug: 'p-clr', sku: 'C1' });
  await products.setVehicles(pid, [vid]);

  const res = await post(jar, `/admin/catalogue/products/${pid}`, productForm({
    _csrf: csrf, slug: 'p-clr', sku: 'C1', categoryId: String(catId), vehiclesSubmitted: '1',
  }));
  assert.equal(res.status, 303);
  assert.deepEqual(await products.vehicleIdsFor(pid), [], 'انتخاب خالی یعنی پاک کردن');
});

/* ═══════════════════ ۴. ترتیب فهرست محصول مدیر */

test('فهرست محصول مدیر ترتیب را از نشانی می‌پذیرد', async () => {
  const jar = await login();
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'ارزان', slug: 'a', sku: 'A', priceToman: 1000 });
  await insertProduct(db, { categoryId: catId, name: 'گران', slug: 'b', sku: 'B', priceToman: 9000 });

  /* فقط نام محصول‌ها داخل جدول شمرده می‌شود — نه برچسب‌های گزینهٔ
     ترتیب که همان واژه‌ها را دارند («ارزان‌ترین»، «گران‌ترین»). */
  const namesIn = (html) => [...html.matchAll(/class="admin-table__name"[^>]*>([^<]+)</g)]
    .map((m) => m[1].trim());

  const asc = await (await fetch(`${BASE}/admin/catalogue/products?sort=price-asc`,
    { headers: { Cookie: cookieHeader(jar) } })).text();
  const desc = await (await fetch(`${BASE}/admin/catalogue/products?sort=price-desc`,
    { headers: { Cookie: cookieHeader(jar) } })).text();

  assert.deepEqual(namesIn(asc), ['ارزان', 'گران'], 'ارزان‌ترین اول');
  assert.deepEqual(namesIn(desc), ['گران', 'ارزان'], 'گران‌ترین اول');
  assert.match(asc, /name="sort"/, 'کنترل ترتیب باید در فرم باشد');
});

test('کلید ترتیب ناشناخته بی‌خطر به پیش‌فرض برمی‌گردد', async () => {
  const jar = await login();
  const res = await fetch(`${BASE}/admin/catalogue/products?sort=${encodeURIComponent("'; DROP TABLE products; --")}`,
    { headers: { Cookie: cookieHeader(jar) } });
  assert.equal(res.status, 200);
  const still = await db.query("SELECT to_regclass('public.products') AS t");
  assert.ok(still.rows[0].t, 'جدول باید سالم باشد');
});

/* ═══════ ۵. انتخاب کهنهٔ خودرو — خطای فرم، نه ۵۰۰ (رفع OBS-1) */

test('ساخت محصول با خودروی ناموجود: خطای فرم، و هیچ محصولی ساخته نمی‌شود', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'v-live', displayName: 'زنده' }));
  const live = (await vehicles.adminList())[0].id;
  const catId = await insertCategory(db);

  /* شناسهٔ ۹۹۹۹۹۹ هرگز ساخته نشده — همان چیزی که یک فرم کهنه می‌فرستد. */
  const body = new URLSearchParams(productForm({
    _csrf: csrf, categoryId: String(catId), vehiclesSubmitted: '1',
  }));
  body.append('vehicles', String(live));
  body.append('vehicles', '999999');
  const res = await fetch(`${BASE}/admin/catalogue/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body, redirect: 'manual',
  });

  assert.equal(res.status, 422, 'باید خطای فرم باشد، نه ۵۰۰ و نه ۳۰۳');
  const html = await res.text();
  assert.match(html, /دیگر وجود ندارد/, 'پیام فارسی باید دیده شود');
  assert.ok(!/23503|fk_missing|product_vehicle/.test(html), 'جزئیات خام پایگاه داده نباید بیرون بیاید');

  /* مهم‌ترین بخش: هیچ ردیف نیمه‌ساخته‌ای نمانده باشد. */
  assert.equal((await products.adminList()).total, 0, 'محصول نباید ساخته شده باشد');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM product_vehicle')).rows[0].n, 0);
});

test('ساخت با خودروی ناموجود، مقدارهای فرم و انتخاب معتبر را نگه می‌دارد', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'v-keep2', displayName: 'ماندنی دو' }));
  const live = (await vehicles.adminList())[0].id;
  const catId = await insertCategory(db);

  const body = new URLSearchParams(productForm({
    _csrf: csrf, name: 'نامِ فرستاده‌شده', sku: 'KEEP-9',
    categoryId: String(catId), vehiclesSubmitted: '1',
  }));
  body.append('vehicles', String(live));
  body.append('vehicles', '999999');
  const html = await (await fetch(`${BASE}/admin/catalogue/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body, redirect: 'manual',
  })).text();

  assert.match(html, /نامِ فرستاده‌شده/, 'مقدار فرستاده‌شده باید بماند');
  assert.match(html, /KEEP-9/);
  /* خودروی معتبرِ انتخاب‌شده باید همچنان selected باشد. برچسب <option>
     چندخطی رندر می‌شود، پس تا نخستین «<» بعدش را نگاه می‌کنیم. */
  const at = html.indexOf(`<option value="${live}"`);
  assert.ok(at !== -1, 'گزینهٔ خودروی معتبر باید در فرم باشد');
  const tag = html.slice(at, html.indexOf('<', at + 1));
  assert.match(tag, /selected/, 'انتخاب معتبر باید حفظ شود');
});

test('به‌روزرسانی با خودروی ناموجود: محصول و پیوندهایش دست‌نخورده می‌مانند', async () => {
  const jar = await login();
  const csrf = await csrfFrom(jar, `${BASE_PATH}/new`);
  await post(jar, BASE_PATH, validForm({ _csrf: csrf, slug: 'v-upd', displayName: 'به‌روز' }));
  const vid = (await vehicles.adminList())[0].id;

  const catId = await insertCategory(db);
  const pid = await insertProduct(db, {
    categoryId: catId, name: 'نام اصلی', slug: 'p-upd', sku: 'U9', priceToman: 5000,
  });
  await products.setVehicles(pid, [vid]);

  const body = new URLSearchParams(productForm({
    _csrf: csrf, name: 'نام عوض‌شده', slug: 'p-upd', sku: 'U9',
    categoryId: String(catId), priceToman: '7777', vehiclesSubmitted: '1',
  }));
  body.append('vehicles', '999999');
  const res = await fetch(`${BASE}/admin/catalogue/products/${pid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body, redirect: 'manual',
  });

  assert.equal(res.status, 422, 'باید خطای فرم باشد، نه ۵۰۰');
  assert.match(await res.text(), /دیگر وجود ندارد/);

  /* محصول نباید نیم‌بند عوض شده باشد. */
  const row = await products.findById(pid);
  assert.equal(row.name, 'نام اصلی', 'نام نباید عوض شده باشد');
  assert.equal(Number(row.price_toman), 5000, 'قیمت نباید عوض شده باشد');
  /* و پیوند قبلی نباید قربانی شود. */
  assert.deepEqual(await products.vehicleIdsFor(pid), [vid], 'پیوند موجود باید بماند');
});
