/* ============================================================================
 * tests/admin-catalog-routes.test.js — رفتار واقعی مدیریت کاتالوگ
 * ----------------------------------------------------------------------------
 * برنامهٔ کامل Express روی PGlite بالا می‌آید و همه‌چیز از راه HTTP سنجیده
 * می‌شود: فرم، هدایت، کد وضعیت، و آنچه واقعا در پایگاه داده نشست.
 *
 * مرز اجازهٔ دسترسی اینجا دوباره آزموده نمی‌شود — آن کار
 * admin-catalog-authz.test.js است. اینجا فرض بر این است که مدیر وارد
 * شده و توکن درست دارد؛ موضوع، درستیِ خودِ رفتار است.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertBrand } = await import('./helpers/testDb.js');
const { createAdminUserRepository } = await import('../src/db/repositories/adminUsers.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createCategoryRepository } = await import('../src/db/repositories/categories.js');
const { createBrandRepository } = await import('../src/db/repositories/brands.js');
const { hashPassword } = await import('../src/services/password.js');
const { config } = await import('../src/config/index.js');
const { faDigits } = await import('../src/services/format.js');

const EMAIL = 'admin@example.test';
const PASSWORD = 'correct-horse-9-battery';
const BASE_PATH = '/admin/catalogue';

let db, server, BASE, adminUsers, products, categories, brands;
let jar, csrf;

before(async () => {
  db = await createTestDb();
  adminUsers = createAdminUserRepository(db);
  products = createProductRepository(db);
  categories = createCategoryRepository(db);
  brands = createBrandRepository(db);

  const { createApp } = await import('../src/app.js');
  const app = createApp({ db, repositories: { products, categories, brands } });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

beforeEach(async () => {
  await db.exec(`TRUNCATE product_images, product_vehicle, products, vehicles, brands, categories,
                          admin_audit_log, admin_sessions, login_attempts, admin_users
                 RESTART IDENTITY CASCADE`);
  await adminUsers.create({
    email: EMAIL, passwordHash: await hashPassword(PASSWORD), displayName: 'مدیر آزمون',
  });
  ({ jar, csrf } = await login());
});

/* ----------------------------------------------------------- کمکی‌ها */

function parseCookies(res) {
  const out = {};
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}
const cookieHeader = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
const tokenIn = (html) => html.match(/name="_csrf" value="([^"]*)"/)[1];

async function login() {
  const page = await fetch(`${BASE}/admin/login`);
  const publicCsrf = tokenIn(await page.text());
  const pageJar = parseCookies(page);
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(pageJar) },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, _csrf: publicCsrf }),
    redirect: 'manual',
  });
  const nextJar = { ...pageJar, ...parseCookies(res) };
  const dash = await fetch(`${BASE}/admin`, { headers: { Cookie: cookieHeader(nextJar) } });
  return { jar: nextJar, csrf: tokenIn(await dash.text()) };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookieHeader(jar) }, redirect: 'manual',
  });
  return { res, html: await res.text() };
}

async function post(path, fields) {
  const body = new URLSearchParams();
  body.set('_csrf', csrf);
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => body.append(k, x));
    else if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body,
    redirect: 'manual',
  });
  return { res, html: await res.text(), location: res.headers.get('location') };
}

const auditRows = async () =>
  (await db.query('SELECT action, entity, entity_id, detail FROM admin_audit_log ORDER BY id')).rows;

const countProducts = async () =>
  (await db.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n;

/** دادهٔ معتبر یک محصول برای فرم. */
function productFields(categoryId, over = {}) {
  return {
    name: 'لنت ترمز جلو', slug: '', sku: 'BRK-100', oemNumber: '9678-191-580',
    categoryId, brandId: '', priceToman: '250000', salePriceToman: '',
    stockQty: '4', availability: 'in_stock', weightGrams: '',
    shortDescription: '', description: '', compatibilityNote: '',
    isActive: 'on', ...over,
  };
}

async function seedCatalog() {
  const categoryId = await insertCategory(db, { name: 'ترمز', slug: 'ترمز' });
  const brandId = await insertBrand(db, { name: 'والئو', slug: 'والئو' });
  return { categoryId, brandId };
}

/* ======================================================= محصول: فهرست */

test('فهرست محصول‌ها اطلاعات شناسایی را نشان می‌دهد', async () => {
  const { categoryId, brandId } = await seedCatalog();
  await products.create({
    name: 'لنت ترمز جلو', slug: 'لنت-ترمز-جلو', sku: 'BRK-100', oemNumber: '9678191580',
    categoryId, brandId, priceToman: 250000, salePriceToman: 200000,
    stockQty: 3, availability: 'in_stock', specs: {},
  });

  const { res, html } = await get(`${BASE_PATH}/products`);
  assert.equal(res.status, 200);
  for (const needle of ['لنت ترمز جلو', 'BRK-100', '9678191580', 'والئو', 'ترمز']) {
    assert.ok(html.includes(needle), `فهرست باید «${needle}» را نشان بدهد`);
  }
  assert.ok(html.includes('غیرفعال کردن'), 'کار بازگشت‌پذیر باید در فهرست باشد');
  assert.ok(html.includes('حذف…'), 'حذف باید جدا و کم‌رنگ‌تر باشد');
});

test('فهرست محصول‌ها با جست‌وجو، دسته، برند و وضعیت فیلتر می‌شود', async () => {
  const { categoryId, brandId } = await seedCatalog();
  const other = await insertCategory(db, { name: 'فیلتر', slug: 'فیلتر' });
  await products.create({ name: 'لنت ترمز', slug: 'لنت', sku: 'BRK-1', categoryId, brandId,
    priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {} });
  const hidden = await products.create({ name: 'فیلتر روغن', slug: 'فیلتر-روغن', sku: 'OIL-9',
    categoryId: other, priceToman: 2000, stockQty: 1, availability: 'in_stock', specs: {} });
  await products.setActive(hidden, false);

  assert.ok((await get(`${BASE_PATH}/products?q=OIL-9`)).html.includes('فیلتر روغن'));
  assert.ok(!(await get(`${BASE_PATH}/products?q=OIL-9`)).html.includes('لنت ترمز'));
  assert.ok((await get(`${BASE_PATH}/products?category=${other}`)).html.includes('فیلتر روغن'));
  assert.ok((await get(`${BASE_PATH}/products?brand=${brandId}`)).html.includes('لنت ترمز'));

  const inactive = await get(`${BASE_PATH}/products?active=no`);
  assert.ok(inactive.html.includes('فیلتر روغن'), 'فیلتر غیرفعال باید غیرفعال‌ها را بیاورد');
  assert.ok(!inactive.html.includes('لنت ترمز'), 'و فعال‌ها را نیاورد');
});

test('فهرست محصول صفحه‌بندی می‌شود', async () => {
  const { categoryId } = await seedCatalog();
  for (let i = 0; i < 23; i++) {
    await products.create({
      name: `قطعه ${i}`, slug: `قطعه-${i}`, sku: `SKU-${i}`, categoryId,
      priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {},
    });
  }
  const first = await get(`${BASE_PATH}/products`);
  assert.ok(first.html.includes('pagination'), 'نوار صفحه‌بندی باید باشد');
  const second = await get(`${BASE_PATH}/products?page=2`);
  assert.equal(second.res.status, 200);
  assert.ok(second.html.includes('قطعه 22') || second.html.includes('قطعه 0'),
    'صفحهٔ دوم باید ردیف‌های دیگری داشته باشد');
});

/* ======================================================= محصول: ساخت */

test('ساخت محصول با داده درست انجام می‌شود و رقم فارسی پذیرفته است', async () => {
  const { categoryId } = await seedCatalog();
  const { res, location } = await post(`${BASE_PATH}/products`,
    productFields(categoryId, { priceToman: '۲۵۰۰۰۰', stockQty: '۴' }));

  assert.equal(res.status, 303);
  assert.match(location, /\/admin\/catalogue\/products\/\d+\/edit\?flash=created/);

  const row = (await db.query('SELECT * FROM products')).rows[0];
  assert.equal(row.name, 'لنت ترمز جلو');
  assert.equal(String(row.price_toman), '250000', 'رقم فارسی باید به عدد تبدیل شده باشد');
  assert.equal(row.stock_qty, 4);
  assert.equal(row.slug, 'لنت-ترمز-جلو', 'نشانی باید از روی نام ساخته شود');
  assert.equal(row.oem_number_normalized, '9678191580');
  assert.ok(row.search_text.includes('9678191580'));

  const flash = await get(location);
  assert.ok(flash.html.includes('با موفقیت ثبت شد'), 'پیام موفقیت باید دیده شود');
});

test('مشخصات فنی از ردیف‌های کلید/مقدار ساخته می‌شود', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, {
    ...productFields(categoryId),
    specKey: ['جنس', '', 'ابعاد'],
    specValue: ['فولاد', 'دور ریخته شود', '۱۰ سانتی‌متر'],
  });
  const row = (await db.query('SELECT specs FROM products')).rows[0];
  assert.deepEqual(row.specs, { 'جنس': 'فولاد', 'ابعاد': '۱۰ سانتی‌متر' },
    'ردیف با کلید خالی باید حذف شود');
});

test('ساخت محصول نامعتبر ۴۲۲ می‌دهد و مقدارها را نگه می‌دارد', async () => {
  const { categoryId } = await seedCatalog();
  const { res, html } = await post(`${BASE_PATH}/products`, productFields(categoryId, {
    name: 'ل', priceToman: '-5', availability: 'flying', salePriceToman: '999999',
    sku: 'KEEP-ME',
  }));

  assert.equal(res.status, 422);
  assert.equal(await countProducts(), 0, 'هیچ ردیفی نباید ساخته شود');
  assert.ok(html.includes('field__error'), 'خطای فیلد باید نشان داده شود');
  assert.ok(html.includes('KEEP-ME'), 'مقدار درستِ فرستاده‌شده نباید گم شود');
  assert.ok(html.includes('فرم ذخیره نشد'), 'خلاصهٔ خطا باید دیده شود');
});

test('قیمت ویژهٔ بزرگ‌تر یا مساویِ قیمت اصلی رد می‌شود', async () => {
  const { categoryId } = await seedCatalog();
  const { res, html } = await post(`${BASE_PATH}/products`,
    productFields(categoryId, { priceToman: '100000', salePriceToman: '100000' }));
  assert.equal(res.status, 422);
  assert.ok(html.includes('کمتر از قیمت اصلی'), 'پیام باید روشن باشد');
  assert.equal(await countProducts(), 0);
});

test('کد کالای تکراری پیام فارسی می‌دهد، نه خطای پایگاه داده', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const { res, html } = await post(`${BASE_PATH}/products`,
    productFields(categoryId, { name: 'قطعهٔ دیگر' }));

  assert.equal(res.status, 422);
  assert.ok(html.includes('این کد کالا قبلا ثبت شده است'), 'پیام فارسی باید بیاید');
  assert.ok(!html.includes('duplicate key'), 'متن خام PostgreSQL نباید درز کند');
  assert.ok(!html.includes('idx_products_sku'), 'نام قید نباید به کاربر برسد');
  assert.equal(await countProducts(), 1);
});

test('نشانی تکراری پیام فارسی می‌دهد', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const { res, html } = await post(`${BASE_PATH}/products`,
    productFields(categoryId, { sku: 'BRK-200', slug: 'لنت-ترمز-جلو' }));
  assert.equal(res.status, 422);
  assert.ok(html.includes('این نشانی قبلا استفاده شده است'));
});

test('ناسازگاری موجودی و وضعیت فقط هشدار است و جلوی ذخیره را نمی‌گیرد', async () => {
  const { categoryId } = await seedCatalog();
  const { res } = await post(`${BASE_PATH}/products`,
    productFields(categoryId, { stockQty: '0', availability: 'in_stock' }));
  assert.equal(res.status, 303, 'باید ذخیره شود');
  assert.equal(await countProducts(), 1);
});

/* ==================================================== محصول: ویرایش */

test('صفحهٔ ویرایش مقدارهای فعلی را نشان می‌دهد', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { res, html } = await get(`${BASE_PATH}/products/${id}/edit`);
  assert.equal(res.status, 200);
  assert.ok(html.includes('value="لنت ترمز جلو"'));
  assert.ok(html.includes('value="BRK-100"'));
  assert.ok(html.includes('حذف دائمی'), 'ناحیهٔ حذف باید در صفحهٔ ویرایش باشد');
});

test('به‌روزرسانی محصول ذخیره می‌شود و updated_at جلو می‌رود', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  await db.query(`UPDATE products SET updated_at = now() - interval '1 day' WHERE id = $1`, [id]);

  const { res, location } = await post(`${BASE_PATH}/products/${id}`,
    productFields(categoryId, { name: 'لنت ترمز عقب', priceToman: '300000' }));

  assert.equal(res.status, 303);
  assert.match(location, /flash=updated/);
  const row = (await db.query('SELECT * FROM products WHERE id = $1', [id])).rows[0];
  assert.equal(row.name, 'لنت ترمز عقب');
  assert.equal(String(row.price_toman), '300000');
  assert.ok(row.search_text.includes('لنت ترمز عقب'), 'متن جست‌وجو باید از نو ساخته شود');
  assert.ok(Date.now() - new Date(row.updated_at).getTime() < 60_000, 'updated_at باید تازه باشد');
});

test('به‌روزرسانی نامعتبر ۴۲۲ می‌دهد و ردیف را دست‌نخورده می‌گذارد', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { res } = await post(`${BASE_PATH}/products/${id}`,
    productFields(categoryId, { name: '', priceToman: 'ده هزار' }));
  assert.equal(res.status, 422);

  const row = (await db.query('SELECT name FROM products WHERE id = $1', [id])).rows[0];
  assert.equal(row.name, 'لنت ترمز جلو', 'ردیف نباید عوض شده باشد');
});

/* ============================================ محصول: انتشار و موجودی */

test('غیرفعال و دوباره فعال کردن محصول کار می‌کند و بازگشت‌پذیر است', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  let r = await post(`${BASE_PATH}/products/${id}/active`, { isActive: 'no' });
  assert.equal(r.res.status, 303);
  assert.match(r.location, /flash=deactivated/);
  assert.equal((await products.findById(id)).is_active, false);
  assert.equal((await products.list()).total, 0, 'از سایت عمومی برداشته می‌شود');

  r = await post(`${BASE_PATH}/products/${id}/active`, { isActive: 'yes' });
  assert.match(r.location, /flash=activated/);
  assert.equal((await products.list()).total, 1, 'و کامل برمی‌گردد');
});

test('غیرفعال کردن، فیلترهای فهرست را حفظ می‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { location } = await post(`${BASE_PATH}/products/${id}/active`,
    { isActive: 'no', q: 'لنت', category: String(categoryId), page: '1' });
  assert.match(location, /q=/, 'جست‌وجوی جاری باید حفظ شود');
  assert.match(location, /flash=deactivated/);
});

test('ویرایش سریع موجودی فقط موجودی و وضعیت را عوض می‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { res, location } = await post(`${BASE_PATH}/products/${id}/stock`,
    { stockQty: '۰', availability: 'out_of_stock' });
  assert.equal(res.status, 303);
  assert.match(location, /flash=stock/);

  const row = await products.findById(id);
  assert.equal(row.stock_qty, 0);
  assert.equal(row.availability, 'out_of_stock');
  assert.equal(row.name, 'لنت ترمز جلو', 'بقیهٔ ستون‌ها نباید دست بخورند');
});

test('موجودی نامعتبر چیزی را ذخیره نمی‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { location } = await post(`${BASE_PATH}/products/${id}/stock`, { stockQty: '-3' });
  assert.match(location, /error=bad_stock/);
  assert.equal((await products.findById(id)).stock_qty, 4, 'موجودی نباید عوض شده باشد');
});

/* =================================================== محصول: حذف دائمی */

test('حذف بدون تأیید صریح انجام نمی‌شود', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  const { res, html } = await post(`${BASE_PATH}/products/${id}/delete`, {});
  assert.equal(res.status, 422, 'بدون تأیید باید رد شود');
  assert.ok(html.includes('کادر تأیید'), 'دلیلش باید گفته شود');
  assert.equal(await countProducts(), 1, 'محصول باید سر جایش بماند');
});

test('تأییدِ غلط هم حذف نمی‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  const { res } = await post(`${BASE_PATH}/products/${id}/delete`, { confirm: 'maybe' });
  assert.equal(res.status, 422);
  assert.equal(await countProducts(), 1);
});

test('حذف با تأیید صریح انجام می‌شود و تصویرها را هم می‌برد', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  await db.query(`INSERT INTO product_images (product_id, image_id) VALUES ($1, 'img-1')`, [id]);

  const { res, location } = await post(`${BASE_PATH}/products/${id}/delete`, { confirm: 'yes' });
  assert.equal(res.status, 303);
  assert.match(location, /flash=deleted/);
  assert.equal(await countProducts(), 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM product_images')).rows[0].n, 0);
});

test('ذخیرهٔ معمولی هرگز حذف نمی‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  /* حتی اگر confirm هم در بدنهٔ ذخیره باشد، مسیر ذخیره حذف نمی‌کند. */
  await post(`${BASE_PATH}/products/${id}`, productFields(categoryId, { confirm: 'yes' }));
  assert.equal(await countProducts(), 1);
});

/* ============================================================ دسته‌ها */

test('فهرست دسته‌ها با شمار محصول و زیردسته نشان داده می‌شود', async () => {
  const { categoryId } = await seedCatalog();
  await products.create({ name: 'ق', slug: 'ق', sku: 'S1', categoryId,
    priceToman: 1, stockQty: 0, availability: 'in_stock', specs: {} });
  const { res, html } = await get(`${BASE_PATH}/categories`);
  assert.equal(res.status, 200);
  assert.ok(html.includes('ترمز'));
});

test('ساخت و ویرایش دسته کار می‌کند', async () => {
  const created = await post(`${BASE_PATH}/categories`,
    { name: 'لوازم ترمز', slug: '', sortOrder: '۵', isActive: 'on' });
  assert.equal(created.res.status, 303);
  assert.match(created.location, /flash=created/);

  const row = (await db.query('SELECT * FROM categories')).rows[0];
  assert.equal(row.slug, 'لوازم-ترمز');
  assert.equal(row.sort_order, 5);

  const updated = await post(`${BASE_PATH}/categories/${row.id}`,
    { name: 'لوازم ترمز و کلاچ', slug: row.slug, sortOrder: '5', isActive: 'on' });
  assert.match(updated.location, /flash=updated/);
  assert.equal((await categories.findById(row.id)).name, 'لوازم ترمز و کلاچ');
});

test('نام خالی دسته ۴۲۲ می‌دهد', async () => {
  const { res, html } = await post(`${BASE_PATH}/categories`, { name: '', isActive: 'on' });
  assert.equal(res.status, 422);
  assert.ok(html.includes('field__error'));
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM categories')).rows[0].n, 0);
});

test('دسته نمی‌تواند والد خودش باشد', async () => {
  const id = await insertCategory(db, { name: 'الف', slug: 'الف' });
  const { res, html } = await post(`${BASE_PATH}/categories/${id}`,
    { name: 'الف', slug: 'الف', parentId: String(id), isActive: 'on' });
  assert.equal(res.status, 422);
  assert.ok(html.includes('والد خودش'), 'پیام باید روشن باشد');
  assert.equal((await categories.findById(id)).parent_id, null);
});

test('حلقهٔ دسته رد می‌شود', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  const b = await categories.create({ name: 'ب', slug: 'ب', parentId: a });

  const { res, html } = await post(`${BASE_PATH}/categories/${a}`,
    { name: 'الف', slug: 'الف', parentId: String(b), isActive: 'on' });
  assert.equal(res.status, 422);
  assert.ok(html.includes('حلقه'), 'باید بگوید چرا');
  assert.equal((await categories.findById(a)).parent_id, null, 'رابطه نباید ساخته شود');
});

test('فعال/غیرفعال کردن دسته کار می‌کند', async () => {
  const id = await insertCategory(db, { name: 'الف', slug: 'الف' });
  const r = await post(`${BASE_PATH}/categories/${id}/active`, { isActive: 'no' });
  assert.match(r.location, /flash=deactivated/);
  assert.equal((await categories.findById(id)).is_active, false);
});

test('حذف دستهٔ دارای محصول پیام فارسی می‌دهد، نه خطای ۵۰۰', async () => {
  const { categoryId } = await seedCatalog();
  await products.create({ name: 'ق', slug: 'ق', sku: 'S1', categoryId,
    priceToman: 1, stockQty: 0, availability: 'in_stock', specs: {} });

  const { res, location } = await post(`${BASE_PATH}/categories/${categoryId}/delete`,
    { confirm: 'yes' });
  assert.equal(res.status, 303, 'نباید ۵۰۰ بدهد');
  assert.match(location, /error=cat_has_products/);

  const page = await get(location);
  assert.ok(page.html.includes('این دسته محصول دارد'), 'پیام فارسی باید دیده شود');
  assert.ok(await categories.findById(categoryId), 'دسته باید بماند');
});

test('حذف دستهٔ دارای زیردسته پیام فارسی می‌دهد', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  await categories.create({ name: 'ب', slug: 'ب', parentId: a });

  const { location } = await post(`${BASE_PATH}/categories/${a}/delete`, { confirm: 'yes' });
  assert.match(location, /error=cat_has_children/);
  const page = await get(location);
  assert.ok(page.html.includes('زیردسته دارد'));
});

test('حذف دستهٔ بدون وابستگی انجام می‌شود', async () => {
  const id = await insertCategory(db, { name: 'الف', slug: 'الف' });
  const { location } = await post(`${BASE_PATH}/categories/${id}/delete`, { confirm: 'yes' });
  assert.match(location, /flash=deleted/);
  assert.equal(await categories.findById(id), null);
});

/* ============================================================= برندها */

test('ساخت، ویرایش و فعال/غیرفعال کردن برند کار می‌کند', async () => {
  const created = await post(`${BASE_PATH}/brands`,
    { name: 'والئو', slug: '', country: 'فرانسه', isActive: 'on' });
  assert.match(created.location, /flash=created/);
  const id = (await db.query('SELECT id FROM brands')).rows[0].id;

  const updated = await post(`${BASE_PATH}/brands/${id}`,
    { name: 'والئو فرانسه', slug: 'والئو', country: 'فرانسه', isActive: 'on' });
  assert.match(updated.location, /flash=updated/);
  assert.equal((await brands.findById(id)).name, 'والئو فرانسه');

  const toggled = await post(`${BASE_PATH}/brands/${id}/active`, { isActive: 'no' });
  assert.match(toggled.location, /flash=deactivated/);
  assert.equal((await brands.findById(id)).is_active, false);
});

test('نام خالی برند ۴۲۲ می‌دهد', async () => {
  const { res } = await post(`${BASE_PATH}/brands`, { name: '', isActive: 'on' });
  assert.equal(res.status, 422);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM brands')).rows[0].n, 0);
});

test('حذف برند دارای محصول پیام فارسی می‌دهد', async () => {
  const { categoryId, brandId } = await seedCatalog();
  await products.create({ name: 'ق', slug: 'ق', sku: 'S1', categoryId, brandId,
    priceToman: 1, stockQty: 0, availability: 'in_stock', specs: {} });

  const { res, location } = await post(`${BASE_PATH}/brands/${brandId}/delete`, { confirm: 'yes' });
  assert.equal(res.status, 303);
  assert.match(location, /error=brand_has_products/);
  const page = await get(location);
  assert.ok(page.html.includes('این برند محصول دارد'));
  assert.ok(await brands.findById(brandId), 'برند باید بماند');
});

test('تغییر نام برند از راه فرم، متن جست‌وجوی محصول‌ها را تازه می‌کند', async () => {
  /* رگرسیون: پیش از این، نام قدیمیِ برند در search_text می‌ماند و محصول
     با نام تازه پیدا نمی‌شد ولی با نام قدیمی هنوز پیدا می‌شد. */
  const { categoryId, brandId } = await seedCatalog();
  await products.create({ name: 'لنت', slug: 'لنت', sku: 'S1', categoryId, brandId,
    priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {} });

  assert.ok((await db.query('SELECT search_text FROM products')).rows[0].search_text.includes('والئو'));

  const { res } = await post(`${BASE_PATH}/brands/${brandId}`,
    { name: 'بوش', slug: 'والئو', isActive: 'on' });
  assert.equal(res.status, 303);

  const after = (await db.query('SELECT search_text FROM products')).rows[0].search_text;
  assert.ok(!after.includes('والئو'), 'نام قدیمی نباید بماند');
  assert.ok(after.includes('بوش'), 'نام تازه باید وارد شود');

  assert.equal((await products.search({ term: 'بوش' })).total, 1, 'با نام تازه پیدا می‌شود');
  assert.equal((await products.search({ term: 'والئو' })).total, 0, 'با نام قدیمی دیگر نه');
});

test('تغییری که نام برند را عوض نمی‌کند، متن جست‌وجو را دست نمی‌زند', async () => {
  const { categoryId, brandId } = await seedCatalog();
  await products.create({ name: 'لنت', slug: 'لنت', sku: 'S1', categoryId, brandId,
    priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {} });
  const before = (await db.query('SELECT search_text FROM products')).rows[0].search_text;

  await post(`${BASE_PATH}/brands/${brandId}`,
    { name: 'والئو', slug: 'والئو', country: 'فرانسه', isActive: 'on' });

  const after = (await db.query('SELECT search_text FROM products')).rows[0].search_text;
  assert.equal(after, before);
});

/* ============================================================ رد پا */

test('ساخت، ویرایش، تغییر انتشار و حذف در رد پا ثبت می‌شوند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  await post(`${BASE_PATH}/products/${id}`, productFields(categoryId, { name: 'نام تازه' }));
  await post(`${BASE_PATH}/products/${id}/active`, { isActive: 'no' });
  await post(`${BASE_PATH}/products/${id}/delete`, { confirm: 'yes' });

  const actions = (await auditRows()).map((r) => r.action);
  for (const expected of [
    'catalog.product.created', 'catalog.product.updated',
    'catalog.product.active', 'catalog.product.deleted',
  ]) {
    assert.ok(actions.includes(expected), `${expected} باید ثبت شده باشد`);
  }
});

test('رد پا فقط نام فیلدها را نگه می‌دارد، نه مقدارها', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  /* نشانی همان قبلی فرستاده می‌شود — همان کاری که فرمِ پرشده می‌کند.
     (نشانیِ خالی عمدا از روی نام تازه ساخته می‌شود، پس اینجا هم
     تغییرکرده حساب می‌شد و موضوع آزمون را گم می‌کرد.) */
  await post(`${BASE_PATH}/products/${id}`,
    productFields(categoryId, {
      name: 'نام محرمانه', priceToman: '987654', slug: 'لنت-ترمز-جلو',
    }));

  const updated = (await auditRows()).find((r) => r.action === 'catalog.product.updated');
  assert.ok(updated, 'رویداد به‌روزرسانی باید باشد');
  assert.deepEqual(updated.detail.fields, ['name', 'priceToman'],
    'فقط نام فیلدهای تغییرکرده');

  const asText = JSON.stringify(updated.detail);
  assert.ok(!asText.includes('نام محرمانه'), 'مقدار نباید در رد پا باشد');
  assert.ok(!asText.includes('987654'), 'قیمت نباید در رد پا باشد');
});

test('رد پای دسته و برند هم ثبت می‌شود', async () => {
  await post(`${BASE_PATH}/categories`, { name: 'دستهٔ نو', isActive: 'on' });
  await post(`${BASE_PATH}/brands`, { name: 'برند نو', isActive: 'on' });
  const actions = (await auditRows()).map((r) => r.action);
  assert.ok(actions.includes('catalog.category.created'));
  assert.ok(actions.includes('catalog.brand.created'));
});

/* ================================================ رفتار عمومی سایت */

test('کاتالوگ عمومی همچنان فقط ردیف‌های فعال را نشان می‌دهد', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  let res = await fetch(`${BASE}/products`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('لنت ترمز جلو'), 'محصول فعال در سایت دیده می‌شود');

  await post(`${BASE_PATH}/products/${id}/active`, { isActive: 'no' });
  res = await fetch(`${BASE}/products`);
  assert.ok(!(await res.text()).includes('لنت ترمز جلو'), 'غیرفعال از سایت برداشته می‌شود');
});

/* ================================================ شناسهٔ بدشکل ====== */

/** شناسه‌هایی که هرگز نباید به پایگاه داده برسند. */
const BAD_IDS = [
  'abc',                      // اصلا عدد نیست
  '%D8%A7%D9%84%D9%81',       // حروف فارسی، رمزگذاری‌شده
  '99999999999999999999',     // بزرگ‌تر از بازهٔ امن
  '0',                        // هیچ ردیفی شناسهٔ صفر ندارد
  '-1',                       // منفی
  '1.5',                      // اعشاری
];

test('شناسهٔ بدشکل در GET به جای خطای ۵۰۰، به فهرست برمی‌گردد', async () => {
  /* رگرسیون: پیش از این، مقدار خام مستقیم وارد کوئری BIGINT می‌شد و
     PostgreSQL خطای 22P02 می‌داد که به صفحهٔ «خطای سرور» می‌رسید. */
  for (const entity of ['products', 'categories', 'brands']) {
    for (const bad of BAD_IDS) {
      const { res, html } = await get(`${BASE_PATH}/${entity}/${bad}/edit`);
      assert.equal(res.status, 303, `${entity}/${bad} نباید ۵۰۰ بدهد`);
      assert.equal(res.headers.get('location'), `${BASE_PATH}/${entity}?error=not_found`,
        `${entity}/${bad} باید به فهرست همان بخش برگردد`);
      assert.ok(!html.includes('خطای سرور'), 'صفحهٔ خطای سرور نباید دیده شود');
    }
  }
});

test('شناسهٔ بدشکل در POST هم ۵۰۰ نمی‌دهد', async () => {
  const routes = [
    `${BASE_PATH}/products/abc`,
    `${BASE_PATH}/products/abc/active`,
    `${BASE_PATH}/products/abc/stock`,
    `${BASE_PATH}/products/99999999999999999999/delete`,
    `${BASE_PATH}/categories/abc`,
    `${BASE_PATH}/categories/abc/delete`,
    `${BASE_PATH}/categories/abc/active`,
    `${BASE_PATH}/brands/abc`,
    `${BASE_PATH}/brands/abc/delete`,
    `${BASE_PATH}/brands/abc/active`,
  ];
  for (const path of routes) {
    const { res, html } = await post(path, { confirm: 'yes', isActive: 'no', stockQty: '1' });
    assert.equal(res.status, 303, `${path} نباید ۵۰۰ بدهد`);
    assert.match(res.headers.get('location'), /error=not_found$/, path);
    assert.ok(!html.includes('خطای سرور'));
  }
});

test('نگهبان شناسه چیزی را حذف یا عوض نمی‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const before = await countProducts();

  await post(`${BASE_PATH}/products/abc/delete`, { confirm: 'yes' });
  await post(`${BASE_PATH}/categories/abc/delete`, { confirm: 'yes' });
  await post(`${BASE_PATH}/brands/abc/delete`, { confirm: 'yes' });

  assert.equal(await countProducts(), before, 'هیچ ردیفی نباید حذف شده باشد');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM categories')).rows[0].n, 1);
});

test('شناسهٔ درستِ ناموجود همان رفتار قبلی را دارد', async () => {
  /* نگهبان نباید رفتار «معتبر ولی ناموجود» را عوض کند. */
  const { res } = await get(`${BASE_PATH}/products/999999/edit`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${BASE_PATH}/products?error=not_found`);
});

test('شناسهٔ درستِ موجود دست‌نخورده کار می‌کند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;
  const { res, html } = await get(`${BASE_PATH}/products/${id}/edit`);
  assert.equal(res.status, 200);
  assert.ok(html.includes('لنت ترمز جلو'));
});

test('نگهبان شناسه پیش از مرز اجازهٔ دسترسی حرف نمی‌زند', async () => {
  /* کاربر واردنشده باید همان پاسخ همیشگی مرز را بگیرد، نه هدایت به
     فهرست — وگرنه نگهبان داشت دربارهٔ ساختار پنل حرف می‌زد. */
  const g = await fetch(`${BASE}${BASE_PATH}/products/abc/edit`, { redirect: 'manual' });
  assert.equal(g.status, 302);
  assert.equal(g.headers.get('location'), '/admin/login');

  const p = await fetch(`${BASE}${BASE_PATH}/products/abc/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ confirm: 'yes' }),
    redirect: 'manual',
  });
  assert.equal(p.status, 401);
});

/* ================================================ شمارش پیشخان ==== */

/** ردیف‌های جدول شمارش پیشخان: [برچسب، همه، فعال، غیرفعال]. */
async function dashboardCountRows() {
  const { html } = await get('/admin');
  const tbody = html.split('<tbody>')[1].split('</tbody>')[0];
  return tbody.split('<tr>').slice(1).map((chunk) => {
    const cells = chunk.split('</tr>')[0].match(/<td>([^<]*)<\/td>/g) || [];
    return cells.map((c) => c.replace(/<\/?td>/g, '').trim());
  });
}

test('پیشخان وقتی کاتالوگ خالی است صفر نشان می‌دهد و راهنمایی می‌کند', async () => {
  const rows = await dashboardCountRows();
  assert.deepEqual(rows, [
    ['محصول‌ها', faDigits(0), faDigits(0), faDigits(0)],
    ['دسته‌ها', faDigits(0), faDigits(0), faDigits(0)],
    ['برندها', faDigits(0), faDigits(0), faDigits(0)],
  ]);
  const { html } = await get('/admin');
  assert.ok(html.includes('کاتالوگ هنوز خالی است'), 'باید راه شروع را نشان بدهد');
});

test('پیشخان شمار درست محصول، دسته و برند را نشان می‌دهد', async () => {
  const { categoryId } = await seedCatalog();                       // ۱ دسته، ۱ برند
  await insertCategory(db, { name: 'فیلتر', slug: 'فیلتر' });        // ۲ دسته
  await insertBrand(db, { name: 'بوش', slug: 'بوش' });               // ۲ برند
  for (let i = 0; i < 3; i++) {
    await products.create({
      name: `قطعه ${i}`, slug: `قطعه-${i}`, sku: `SKU-${i}`, categoryId,
      priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {},
    });
  }

  const rows = await dashboardCountRows();
  assert.deepEqual(rows[0], ['محصول‌ها', faDigits(3), faDigits(3), faDigits(0)]);
  assert.deepEqual(rows[1], ['دسته‌ها', faDigits(2), faDigits(2), faDigits(0)]);
  assert.deepEqual(rows[2], ['برندها', faDigits(2), faDigits(2), faDigits(0)]);

  const { html } = await get('/admin');
  assert.ok(!html.includes('کاتالوگ هنوز خالی است'), 'پیام خالی نباید بماند');
});

test('پیشخان فعال و غیرفعال را جدا می‌شمارد', async () => {
  const { categoryId, brandId } = await seedCatalog();
  const inactiveCategory = await insertCategory(db, { name: 'بایگانی', slug: 'بایگانی' });
  const a = await products.create({ name: 'الف', slug: 'الف', sku: 'A', categoryId,
    priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {} });
  await products.create({ name: 'ب', slug: 'ب', sku: 'B', categoryId,
    priceToman: 1000, stockQty: 1, availability: 'in_stock', specs: {} });

  await products.setActive(a, false);
  await categories.setActive(inactiveCategory, false);
  await brands.setActive(brandId, false);

  const rows = await dashboardCountRows();
  assert.deepEqual(rows[0], ['محصول‌ها', faDigits(2), faDigits(1), faDigits(1)]);
  assert.deepEqual(rows[1], ['دسته‌ها', faDigits(2), faDigits(1), faDigits(1)]);
  assert.deepEqual(rows[2], ['برندها', faDigits(1), faDigits(0), faDigits(1)]);
});

test('شمارش پیشخان غیرفعال شدن از راه فرم را هم می‌بیند', async () => {
  const { categoryId } = await seedCatalog();
  await post(`${BASE_PATH}/products`, productFields(categoryId));
  const id = (await db.query('SELECT id FROM products')).rows[0].id;

  assert.deepEqual((await dashboardCountRows())[0],
    ['محصول‌ها', faDigits(1), faDigits(1), faDigits(0)]);

  await post(`${BASE_PATH}/products/${id}/active`, { isActive: 'no' });

  assert.deepEqual((await dashboardCountRows())[0],
    ['محصول‌ها', faDigits(1), faDigits(0), faDigits(1)]);
});

/* ============================================ زمان در رد پا ======= */

test('رد پای پیشخان ساعت را هم نشان می‌دهد، نه فقط تاریخ', async () => {
  /* رگرسیون: فیلتر «jalali(true)» بی‌اثر بود چون Nunjucks آرگومان را
     موضعی می‌دهد و formatJalali شیء گزینه‌ها می‌خواهد. نتیجه: ساعت
     هرگز نمایش داده نمی‌شد. */
  const { html } = await get('/admin');
  assert.ok(html.includes('admin.login.success'), 'رد پای ورود باید باشد');

  const activity = html.split('آخرین فعالیت')[1];
  assert.ok(/[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}/.test(activity), 'تاریخ شمسی باید باشد');
  assert.ok(/[۰-۹]{2}:[۰-۹]{2}/.test(activity), 'ساعت هم باید باشد');
});
