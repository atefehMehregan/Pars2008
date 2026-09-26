/* ============================================================================
 * tests/catalog-routes.test.js — آزمون مسیرهای عمومی کاتالوگ
 * ----------------------------------------------------------------------------
 * برنامهٔ واقعی Express بالا می‌آید و مخزن‌های متصل به PGlite به آن تزریق
 * می‌شوند — همان الگوی تزریق فاز ۱الف. پس رندر قالب، هدرهای امنیتی،
 * صفحه‌بندی و ۴۰۴ همگی روی مسیر واقعی HTTP آزموده می‌شوند.
 *
 * داده‌ها ساختگی و فقط داخل همین فایل‌اند و پیش از هر آزمون پاک می‌شوند.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, insertCategory, insertBrand, insertVehicle, insertProduct,
} from './helpers/testDb.js';
import { createProductRepository } from '../src/db/repositories/products.js';
import { createCategoryRepository } from '../src/db/repositories/categories.js';
import { createBrandRepository } from '../src/db/repositories/brands.js';
import { createVehicleRepository } from '../src/db/repositories/vehicles.js';

process.env.NODE_ENV = 'test';

let db, server, BASE;

before(async () => {
  db = await createTestDb();
  const { createApp } = await import('../src/app.js');
  const app = createApp({
    repositories: {
      products: createProductRepository(db),
      categories: createCategoryRepository(db),
      brands: createBrandRepository(db),
      vehicles: createVehicleRepository(db),
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
  await db.exec(`TRUNCATE product_images, product_vehicle, products, vehicles, brands, categories
                 RESTART IDENTITY CASCADE`);
});

const get = (path) => fetch(BASE + path);
const text = async (path) => (await get(path)).text();

/* ------------------------------------------- کاتالوگ خالی (حالت اولیه) */

test('/products با کاتالوگ خالی ۲۰۰ و حالت خالی می‌دهد، نه خطا', async () => {
  const res = await get('/products');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /هنوز محصولی ثبت نشده است/);
  assert.ok(!/at .*\.js:\d+/.test(html), 'نباید ردپای پشته باشد');
});

test('نوار کناری با کاتالوگ خالی پیام مناسب می‌دهد', async () => {
  const html = await text('/products');
  assert.match(html, /هنوز دسته‌بندی‌ای ثبت نشده است/);
  assert.match(html, /هنوز برندی ثبت نشده است/);
});

test('/search بدون عبارت، راهنما نشان می‌دهد نه خطا', async () => {
  const res = await get('/search');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /چه قطعه‌ای لازم دارید/);
});

/* ------------------------------------------------------ فهرست محصول */

test('/products محصول‌ها را با قیمت فارسی نشان می‌دهد', async () => {
  const catId = await insertCategory(db, { name: 'فیلتر', slug: 'فیلتر' });
  await insertProduct(db, {
    categoryId: catId, name: 'فیلتر روغن موتور', slug: 'فیلتر-روغن-موتور',
    sku: 'S1', priceToman: 12500000,
  });

  const html = await text('/products');
  assert.match(html, /فیلتر روغن موتور/);
  assert.ok(html.includes('۱۲٬۵۰۰٬۰۰۰ تومان'), 'قیمت باید با رقم فارسی و واحد تومان بیاید');
  assert.ok(!html.includes('12,500,000'), 'نباید رقم انگلیسی خام نمایش داده شود');
});

test('شماره فنی داخل bdi می‌آید تا جهتش در متن فارسی درست بماند', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1', oemNumber: '9678191580' });
  const html = await text('/products');
  assert.match(html, /<bdi class="part-number">9678191580<\/bdi>/);
});

test('قیمت حراج با قیمت خط‌خوردهٔ قبلی نشان داده می‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, slug: 'p1', sku: 'S1',
    priceToman: 2000000, salePriceToman: 1500000,
  });
  const html = await text('/products');
  assert.ok(html.includes('۱٬۵۰۰٬۰۰۰ تومان'), 'قیمت حراج');
  assert.match(html, /<del class="price__old num">۲٬۰۰۰٬۰۰۰<\/del>/);
});

test('وضعیت موجودی به فارسی نمایش داده می‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1', availability: 'on_order' });
  assert.match(await text('/products'), /قابل سفارش/);
});

/* ------------------------------------------------ نشانی‌های فارسی */

test('دسته با نشانی فارسیِ percent-encode شده باز می‌شود', async () => {
  const catId = await insertCategory(db, { name: 'لوازم ترمز', slug: 'لوازم-ترمز' });
  await insertProduct(db, { categoryId: catId, name: 'لنت ترمز جلو', slug: 'لنت-ترمز-جلو', sku: 'S1' });

  /* همان چیزی که مرورگر می‌فرستد: نشانی درصد-رمزگذاری‌شده. */
  const encoded = '/category/' + encodeURIComponent('لوازم-ترمز');
  assert.ok(encoded.includes('%D9%84'), 'نشانی آزمون باید واقعا encode شده باشد');

  const res = await get(encoded);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /لوازم ترمز/);
  assert.match(html, /لنت ترمز جلو/);
});

test('نشانی دسته با ی/ک عربی هم به همان دسته می‌رسد', async () => {
  await insertCategory(db, { name: 'کلید و برق', slug: 'کلید-و-برق' });
  /* «كليد» با کاف و یای عربی — کاربر اغلب از صفحه‌کلید عربی می‌نویسد. */
  const res = await get('/category/' + encodeURIComponent('كليد-و-برق'));
  assert.equal(res.status, 200, 'نرمال‌سازی باید ی/ک عربی را به همان دسته برساند');
  assert.match(await res.text(), /کلید و برق/);
});

test('محصول با نشانی فارسی باز می‌شود', async () => {
  const catId = await insertCategory(db, { slug: 'فیلتر' });
  await insertProduct(db, {
    categoryId: catId, name: 'فیلتر هوای موتور', slug: 'فیلتر-هوای-موتور', sku: 'S1',
  });
  const res = await get('/product/' + encodeURIComponent('فیلتر-هوای-موتور'));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /فیلتر هوای موتور/);
});

test('پیوندهای تولیدشده در HTML درصد-رمزگذاری‌شده‌اند', async () => {
  const catId = await insertCategory(db, { name: 'ترمز', slug: 'ترمز' });
  await insertProduct(db, { categoryId: catId, name: 'لنت', slug: 'لنت-ترمز', sku: 'S1' });
  const html = await text('/products');
  assert.match(html, /href="\/product\/%D9%84%D9%86%D8%AA/,
    'نشانی محصول باید در HTML encode شده باشد');
  assert.match(html, /href="\/category\/%D8%AA%D8%B1%D9%85%D8%B2"/);
});

/* -------------------------------------------------------------- ۴۰۴ */

test('دستهٔ ناشناس ۴۰۴ فارسی می‌دهد', async () => {
  const res = await get('/category/' + encodeURIComponent('وجود-ندارد'));
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /صفحه پیدا نشد/);
  assert.ok(!/at .*\.js:\d+/.test(html), 'نباید ردپای پشته باشد');
});

test('محصول و برند ناشناس ۴۰۴ می‌دهند', async () => {
  assert.equal((await get('/product/' + encodeURIComponent('نیست'))).status, 404);
  assert.equal((await get('/brand/' + encodeURIComponent('نیست'))).status, 404);
});

test('محصول غیرفعال ۴۰۴ می‌دهد، نه صفحهٔ خالی', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'مخفی', sku: 'S1', isActive: false });
  assert.equal((await get('/product/' + encodeURIComponent('مخفی'))).status, 404);
});

test('دستهٔ موجود ولی خالی ۲۰۰ می‌دهد — نه ۴۰۴', async () => {
  await insertCategory(db, { name: 'دستهٔ خالی', slug: 'خالی' });
  const res = await get('/category/' + encodeURIComponent('خالی'));
  assert.equal(res.status, 200, '«خالی» با «وجود ندارد» فرق دارد');
  assert.match(await res.text(), /این دسته هنوز محصولی ندارد/);
});

/* ---------------------------------------------------------- برند */

test('/brand/:slug فقط محصول همان برند را نشان می‌دهد', async () => {
  const catId = await insertCategory(db);
  const b1 = await insertBrand(db, { name: 'برند الف', slug: 'برند-الف' });
  await insertBrand(db, { name: 'برند ب', slug: 'برند-ب' });
  await insertProduct(db, { categoryId: catId, brandId: b1, name: 'قطعهٔ الف', slug: 'a', sku: 'S1' });
  await insertProduct(db, { categoryId: catId, name: 'قطعهٔ بی‌برند', slug: 'b', sku: 'S2' });

  const html = await text('/brand/' + encodeURIComponent('برند-الف'));
  assert.match(html, /قطعهٔ الف/);
  assert.ok(!html.includes('قطعهٔ بی‌برند'), 'محصول برند دیگر نباید بیاید');
});

/* ------------------------------------------------------- جست‌وجو */

test('جست‌وجو با شمارهٔ فنی، همان قطعه و برچسب مناسب را می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'واشر سرسیلندر', slug: 'a', sku: 'S1', oemNumber: '9678191580',
  });
  const html = await text('/search?q=9678191580');
  assert.match(html, /واشر سرسیلندر/);
  assert.match(html, /بر اساس شماره فنی/);
});

test('جست‌وجوی نام فارسی ناقص نتیجه می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'فیلتر روغن موتور', slug: 'a', sku: 'S1' });
  const html = await text('/search?q=' + encodeURIComponent('فیلتر روغن'));
  assert.match(html, /فیلتر روغن موتور/);
});

test('جست‌وجوی بی‌نتیجه، حالت خالی می‌دهد نه خطا', async () => {
  const res = await get('/search?q=' + encodeURIComponent('زززززز'));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /چیزی پیدا نشد/);
});

/* ------------------------------------------- پارامترهای غیرمجاز */

test('پارامتر ترتیب مخرب بی‌اثر است و جدول سالم می‌ماند', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1', name: 'قطعهٔ آزمون' });

  const res = await get('/products?sort=' + encodeURIComponent("'; DROP TABLE products; --"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /قطعهٔ آزمون/);

  const still = await db.query('SELECT COUNT(*)::int AS n FROM products');
  assert.equal(still.rows[0].n, 1, 'جدول باید سالم بماند');
});

test('پارامترهای ناشناخته نادیده گرفته می‌شوند', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1', name: 'قطعهٔ آزمون' });
  const res = await get('/products?color=red&limit=9999&admin=true&availability=bogus');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /قطعهٔ آزمون/);
});

test('شمارهٔ صفحهٔ بی‌معنی به صفحهٔ یک برمی‌گردد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1', name: 'قطعهٔ آزمون' });
  for (const p of ['-5', 'abc', '0', '9999999999']) {
    const res = await get(`/products?page=${encodeURIComponent(p)}`);
    assert.equal(res.status, 200, `page=${p} نباید خطا بدهد`);
  }
});

test('جست‌وجوی مخرب بی‌خطر است', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1' });
  const res = await get('/search?q=' + encodeURIComponent("'; DROP TABLE products; --"));
  assert.equal(res.status, 200);
  const still = await db.query('SELECT COUNT(*)::int AS n FROM products');
  assert.equal(still.rows[0].n, 1);
});

/* --------------------------------------------------------- صفحه‌بندی */

test('با محصول بیش از یک صفحه، نوار صفحه‌بندی با شمارهٔ فارسی می‌آید', async () => {
  const catId = await insertCategory(db);
  for (let i = 1; i <= 15; i++) {
    await insertProduct(db, { categoryId: catId, name: `قطعه ${i}`, slug: `p${i}`, sku: `S${i}` });
  }
  const html = await text('/products');
  assert.match(html, /class="pagination"/);
  assert.match(html, /صفحهٔ <span class="num">۱<\/span>/);
  assert.match(html, /href="\/products\?page=2"/);
});

test('صفحهٔ دوم، اقلام متفاوتی می‌دهد', async () => {
  const catId = await insertCategory(db);
  for (let i = 1; i <= 15; i++) {
    await insertProduct(db, { categoryId: catId, name: `قطعه ${i}`, slug: `p${i}`, sku: `S${i}` });
  }
  const p1 = await text('/products?page=1');
  const p2 = await text('/products?page=2');
  assert.notEqual(p1, p2, 'صفحهٔ دوم باید محتوای متفاوت داشته باشد');
  assert.match(p2, /صفحهٔ <span class="num">۲<\/span>/);
});

test('با یک صفحه، نوار صفحه‌بندی نمایش داده نمی‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1' });
  assert.ok(!(await text('/products')).includes('class="pagination"'));
});

/* -------------------------------------------------- جزئیات محصول */

test('صفحهٔ محصول مشخصات، سازگاری و کد کالا را نشان می‌دهد', async () => {
  const catId = await insertCategory(db, { name: 'موتور', slug: 'موتور' });
  const brandId = await insertBrand(db, { name: 'برند الف', slug: 'برند-الف' });
  const vehicleId = await insertVehicle(db, { displayName: 'خودروی آزمون', slug: 'v1' });
  const pid = await insertProduct(db, {
    categoryId: catId, brandId, name: 'واشر سرسیلندر', slug: 'واشر-سرسیلندر',
    sku: 'ABC-1', oemNumber: '0209.T9', priceToman: 4300000,
    shortDescription: 'توضیح کوتاه آزمون',
  });
  await db.query('UPDATE products SET compatibility_note=$1, specs=$2 WHERE id=$3',
    ['مناسب برای خودروی آزمون', JSON.stringify({ 'جنس': 'فلز' }), pid]);
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1,$2)', [pid, vehicleId]);

  const html = await text('/product/' + encodeURIComponent('واشر-سرسیلندر'));
  assert.match(html, /واشر سرسیلندر/);
  assert.match(html, /<bdi class="part-number">ABC-1<\/bdi>/);
  assert.match(html, /<bdi class="part-number">0209\.T9<\/bdi>/);
  assert.ok(html.includes('۴٬۳۰۰٬۰۰۰ تومان'));
  assert.match(html, /مناسب برای خودروی آزمون/);
  assert.match(html, /خودروی آزمون/);
  assert.match(html, /جنس/);
  assert.match(html, /توضیح کوتاه آزمون/);
});

test('محصول بدون تصویر، جای تصویر و توضیح صادقانه می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1' });
  const html = await text('/product/a');
  assert.match(html, /تصویر این محصول هنوز بارگذاری نشده است/);
});

test('محصول با تصویر، picture با webp و jpg می‌دهد', async () => {
  const catId = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1' });
  await db.query(
    `INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1,'abc123',TRUE)`, [pid]);
  const html = await text('/product/a');
  assert.match(html, /\/media\/products\/abc123\/detail\.webp/);
  assert.match(html, /\/media\/products\/abc123\/detail\.jpg/);
});

/* ------------------------------------------------- امنیت و پایه */

test('هدرهای امنیتی روی مسیرهای کاتالوگ هم فعالند', async () => {
  for (const path of ['/products', '/search?q=x']) {
    const res = await get(path);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
    assert.ok(res.headers.get('content-security-policy'), `CSP روی ${path}`);
    assert.equal(res.headers.get('x-powered-by'), null, `${path} نباید Express را لو بدهد`);
  }
});

test('صفحه‌های کاتالوگ راست‌به‌چپ و فارسی‌اند', async () => {
  const html = await text('/products');
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta charset="UTF-8"/i);
});

test('نام محصول در HTML فرار داده می‌شود (XSS)', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: '<script>alert(1)</script>', slug: 'xss-test', sku: 'S1',
  });
  const html = await text('/products');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'تگ خام نباید در خروجی باشد');
  assert.match(html, /&lt;script&gt;/, 'باید فرار داده شده باشد');
});

test('فرم جست‌وجو در هدر همهٔ صفحه‌ها هست', async () => {
  const html = await text('/products');
  assert.match(html, /action="\/search"/);
  assert.match(html, /name="q"/);
});

/* ------------------------------------------ پالایهٔ خودرو (فاز ۶) */

test('پالایهٔ خودرو فقط محصول‌های سازگار را نشان می‌دهد', async () => {
  const { createProductRepository: mkProducts } = await import('../src/db/repositories/products.js');
  const products = mkProducts(db);
  const catId = await insertCategory(db);
  const fit = await insertProduct(db, { categoryId: catId, name: 'قطعهٔ سازگار', slug: 'fit', sku: 'F1' });
  await insertProduct(db, { categoryId: catId, name: 'قطعهٔ ناسازگار', slug: 'unfit', sku: 'U1' });
  const vid = await insertVehicle(db, { slug: 'خودرو-پالایه', displayName: 'خودروی پالایه' });
  await products.setVehicles(fit, [vid]);

  const html = await text('/products?vehicle=' + encodeURIComponent('خودرو-پالایه'));
  assert.match(html, /قطعهٔ سازگار/);
  assert.ok(!html.includes('قطعهٔ ناسازگار'), 'محصول ناسازگار نباید بیاید');
});

test('نشانی خودروی ناشناس پالایه را نادیده می‌گیرد، نه ۴۰۴', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'قطعهٔ آزاد', slug: 'free', sku: 'X1' });

  const res = await get('/products?vehicle=' + encodeURIComponent('خودروی-ناموجود'));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /قطعهٔ آزاد/);
});

test('نوار کناری خودروها را با شمار محصول نشان می‌دهد', async () => {
  const { createProductRepository: mkProducts } = await import('../src/db/repositories/products.js');
  const products = mkProducts(db);
  const catId = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1' });
  const vid = await insertVehicle(db, { slug: 'خودرو-کناری', displayName: 'خودروی کناری' });
  await products.setVehicles(pid, [vid]);

  const html = await text('/products');
  assert.match(html, /سازگار با خودرو/);
  assert.match(html, /خودروی کناری/);
});

test('بدون خودرو، بخش سازگاری در نوار کناری نمی‌آید', async () => {
  const html = await text('/products');
  assert.ok(!html.includes('سازگار با خودرو'), 'بخش خالی نمایش داده نمی‌شود');
});

test('پالایهٔ خودرو در پیوندهای صفحه‌بندی حفظ می‌شود', async () => {
  const { createProductRepository: mkProducts } = await import('../src/db/repositories/products.js');
  const products = mkProducts(db);
  const catId = await insertCategory(db);
  const vid = await insertVehicle(db, { slug: 'خودرو-صفحه', displayName: 'خودروی صفحه' });
  for (let i = 1; i <= 15; i += 1) {
    const pid = await insertProduct(db, { categoryId: catId, name: `قطعه ${i}`, slug: `pv${i}`, sku: `PV${i}` });
    await products.setVehicles(pid, [vid]);
  }
  const html = await text('/products?vehicle=' + encodeURIComponent('خودرو-صفحه'));
  assert.match(html, /class="pagination"/);
  assert.match(html, /vehicle=/, 'پیوند صفحهٔ بعد باید پالایه را نگه دارد');
});
