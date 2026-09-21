/* ============================================================================
 * tests/catalog-repositories.test.js — آزمون لایهٔ مخزن
 * ----------------------------------------------------------------------------
 * یک پایگاه دادهٔ PGlite برای کل فایل ساخته می‌شود و پیش از هر آزمون
 * جدول‌ها TRUNCATE می‌شوند. جداسازی حفظ می‌شود ولی هزینهٔ ساخت دوبارهٔ
 * نمونهٔ WASM (چند ثانیه) یک بار پرداخت می‌شود، نه به ازای هر آزمون.
 *
 * همهٔ داده‌ها ساختگی و فقط داخل همین فایل‌اند؛ هیچ‌کدام در مهاجرت یا
 * دادهٔ تولید نمی‌روند.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, insertCategory, insertBrand, insertVehicle, insertProduct,
} from './helpers/testDb.js';
import { createProductRepository } from '../src/db/repositories/products.js';
import { createCategoryRepository } from '../src/db/repositories/categories.js';
import { createBrandRepository } from '../src/db/repositories/brands.js';

process.env.NODE_ENV = 'test';

let db, productRepo, categoryRepo, brandRepo;

before(async () => {
  db = await createTestDb();
  productRepo = createProductRepository(db);
  categoryRepo = createCategoryRepository(db);
  brandRepo = createBrandRepository(db);
});

after(async () => { if (db) await db.close(); });

/* نظافت پیش از هر آزمون — هیچ آزمونی داده‌ای برای بعدی جا نمی‌گذارد. */
beforeEach(async () => {
  await db.exec(`TRUNCATE product_images, product_vehicle, products, vehicles, brands, categories
                 RESTART IDENTITY CASCADE`);
});

/* ------------------------------------------------------------ دسته‌ها */

test('دسته‌های فعال برگردانده می‌شوند و غیرفعال‌ها نه', async () => {
  await insertCategory(db, { name: 'ترمز', slug: 'ترمز', sortOrder: 1 });
  await insertCategory(db, { name: 'فیلتر', slug: 'فیلتر', sortOrder: 2 });
  await insertCategory(db, { name: 'بایگانی', slug: 'بایگانی', isActive: false });

  const list = await categoryRepo.listActive();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => c.slug), ['ترمز', 'فیلتر']);
});

test('دسته با نشانی فارسی پیدا می‌شود؛ نشانی ناشناس null می‌دهد', async () => {
  await insertCategory(db, { name: 'لوازم ترمز', slug: 'لوازم-ترمز' });
  const found = await categoryRepo.findBySlug('لوازم-ترمز');
  assert.ok(found, 'دسته باید با نشانی فارسی پیدا شود');
  assert.equal(found.name, 'لوازم ترمز');
  assert.equal(await categoryRepo.findBySlug('وجود-ندارد'), null);
  assert.equal(await categoryRepo.findBySlug(''), null);
});

test('شمارش محصول هر دسته درست است و دستهٔ خالی با صفر می‌آید', async () => {
  const withProducts = await insertCategory(db, { name: 'ترمز', slug: 'ترمز', sortOrder: 1 });
  await insertCategory(db, { name: 'خالی', slug: 'خالی', sortOrder: 2 });
  await insertProduct(db, { categoryId: withProducts, slug: 'p1', sku: 'S1' });
  await insertProduct(db, { categoryId: withProducts, slug: 'p2', sku: 'S2' });
  await insertProduct(db, { categoryId: withProducts, slug: 'p3', sku: 'S3', isActive: false });

  const counts = await categoryRepo.listWithCounts();
  const byslug = Object.fromEntries(counts.map((c) => [c.slug, c.product_count]));
  assert.equal(byslug['ترمز'], 2, 'محصول غیرفعال نباید شمرده شود');
  assert.equal(byslug['خالی'], 0, 'دستهٔ خالی باید با صفر بیاید');
});

/* -------------------------------------------------------------- برندها */

test('برندها با شمارش محصول فعال برگردانده می‌شوند', async () => {
  const catId = await insertCategory(db);
  const brandId = await insertBrand(db, { name: 'برند الف', slug: 'برند-الف' });
  await insertBrand(db, { name: 'برند ب', slug: 'برند-ب' });
  await insertProduct(db, { categoryId: catId, brandId, slug: 'p1', sku: 'S1' });

  const brands = await brandRepo.listWithCounts();
  const byslug = Object.fromEntries(brands.map((b) => [b.slug, b.product_count]));
  assert.equal(byslug['برند-الف'], 1);
  assert.equal(byslug['برند-ب'], 0);
  assert.ok(await brandRepo.findBySlug('برند-الف'));
  assert.equal(await brandRepo.findBySlug('ناشناس'), null);
});

/* ------------------------------------------------------ فهرست محصول */

test('فقط محصول فعال در فهرست می‌آید', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1' });
  await insertProduct(db, { categoryId: catId, slug: 'p2', sku: 'S2', isActive: false });

  const res = await productRepo.list();
  assert.equal(res.total, 1);
  assert.equal(res.items[0].slug, 'p1');
});

test('محصول دستهٔ غیرفعال نمایش داده نمی‌شود', async () => {
  const hidden = await insertCategory(db, { slug: 'پنهان', isActive: false });
  await insertProduct(db, { categoryId: hidden, slug: 'p1', sku: 'S1' });
  const res = await productRepo.list();
  assert.equal(res.total, 0, 'دستهٔ غیرفعال باید محصولاتش را هم پنهان کند');
});

test('صفحه‌بندی: تعداد کل، تعداد صفحه و جابه‌جایی درست است', async () => {
  const catId = await insertCategory(db);
  for (let i = 1; i <= 7; i++) {
    await insertProduct(db, { categoryId: catId, slug: `p${i}`, sku: `S${i}`, name: `قطعه ${i}` });
  }
  const page1 = await productRepo.list({ perPage: 3, page: 1 });
  assert.equal(page1.total, 7);
  assert.equal(page1.pageCount, 3);
  assert.equal(page1.items.length, 3);

  const page3 = await productRepo.list({ perPage: 3, page: 3 });
  assert.equal(page3.items.length, 1, 'صفحهٔ آخر یک قلم دارد');

  const beyond = await productRepo.list({ perPage: 3, page: 99 });
  assert.equal(beyond.items.length, 0, 'صفحهٔ فراتر از پایان باید خالی باشد، نه خطا');
});

test('اندازهٔ صفحه به سقف محدود می‌شود و مقدار بی‌معنی پیش‌فرض می‌گیرد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId });
  assert.equal((await productRepo.list({ perPage: 5000 })).perPage, 60);
  assert.equal((await productRepo.list({ perPage: -3 })).perPage, 12);
  assert.equal((await productRepo.list({ page: -2 })).page, 1);
  assert.equal((await productRepo.list({ perPage: 'abc' })).perPage, 12);
});

test('ترتیب قیمت، قیمت حراج را در نظر می‌گیرد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'ارزان', sku: 'A', priceToman: 300000 });
  await insertProduct(db, { categoryId: catId, slug: 'گران', sku: 'B', priceToman: 500000 });
  /* قیمت پایه بالاست ولی با حراج ارزان‌ترین می‌شود. */
  await insertProduct(db, { categoryId: catId, slug: 'حراجی', sku: 'C', priceToman: 900000, salePriceToman: 100000 });

  const asc = await productRepo.list({ sort: 'price-asc' });
  assert.deepEqual(asc.items.map((p) => p.slug), ['حراجی', 'ارزان', 'گران']);
  const desc = await productRepo.list({ sort: 'price-desc' });
  assert.equal(desc.items[0].slug, 'گران');
});

test('کلید ترتیب ناشناخته بی‌خطر به پیش‌فرض برمی‌گردد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId });
  const evil = await productRepo.list({ sort: "'; DROP TABLE products; --" });
  assert.equal(evil.items.length, 1, 'باید نتیجهٔ عادی بدهد');
  const still = await db.query('SELECT COUNT(*)::int AS n FROM products');
  assert.equal(still.rows[0].n, 1, 'جدول باید سالم بماند');
});

test('فیلتر دسته، برند، موجودی و خودرو کار می‌کند', async () => {
  const c1 = await insertCategory(db, { slug: 'c1' });
  const c2 = await insertCategory(db, { slug: 'c2' });
  const b1 = await insertBrand(db, { slug: 'b1' });
  const vehicleId = await insertVehicle(db, { slug: 'v1' });

  const p1 = await insertProduct(db, { categoryId: c1, brandId: b1, slug: 'p1', sku: 'S1' });
  await insertProduct(db, { categoryId: c2, slug: 'p2', sku: 'S2', availability: 'on_order' });
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1,$2)', [p1, vehicleId]);

  assert.equal((await productRepo.list({ filters: { categoryId: c1 } })).total, 1);
  assert.equal((await productRepo.list({ filters: { brandId: b1 } })).total, 1);
  assert.equal((await productRepo.list({ filters: { availability: 'on_order' } })).total, 1);
  assert.equal((await productRepo.list({ filters: { availability: 'in_stock' } })).total, 1);
  assert.equal((await productRepo.list({ filters: { vehicleId } })).total, 1);
  assert.equal((await productRepo.list({ filters: { vehicleId: 999 } })).total, 0);
});

test('فیلتر موجودی نامعتبر نادیده گرفته می‌شود، نه اینکه خطا بدهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId });
  const res = await productRepo.list({ filters: { availability: "in_stock'; DROP TABLE products; --" } });
  assert.equal(res.total, 1, 'فیلتر ناشناخته باید کنار گذاشته شود');
});

/* --------------------------------------------------- جزئیات محصول */

test('محصول با نشانی فارسی پیدا می‌شود و برند و دسته را همراه دارد', async () => {
  const catId = await insertCategory(db, { name: 'فیلتر', slug: 'فیلتر' });
  const brandId = await insertBrand(db, { name: 'برند الف', slug: 'برند-الف' });
  await insertProduct(db, {
    categoryId: catId, brandId, name: 'فیلتر روغن موتور',
    slug: 'فیلتر-روغن-موتور', sku: 'S1', priceToman: 250000,
  });

  const p = await productRepo.findBySlug('فیلتر-روغن-موتور');
  assert.ok(p);
  assert.equal(p.name, 'فیلتر روغن موتور');
  assert.equal(p.category_slug, 'فیلتر');
  assert.equal(p.brand_name, 'برند الف');
  assert.equal(typeof p.price_toman, 'number', 'مبلغ باید عدد باشد نه رشته');
  assert.equal(p.price_toman, 250000);
});

test('محصول غیرفعال یا ناشناس null می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'مخفی', sku: 'S1', isActive: false });
  assert.equal(await productRepo.findBySlug('مخفی'), null);
  assert.equal(await productRepo.findBySlug('هرگز'), null);
  assert.equal(await productRepo.findBySlug(null), null);
});

test('تصویر اصلی و خودروهای سازگار برگردانده می‌شوند', async () => {
  const catId = await insertCategory(db);
  const vehicleId = await insertVehicle(db, { displayName: 'خودروی آزمون' });
  const pid = await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1' });
  await db.query(`INSERT INTO product_images (product_id,image_id,is_primary,sort_order) VALUES ($1,'img-b',FALSE,2)`, [pid]);
  await db.query(`INSERT INTO product_images (product_id,image_id,is_primary,sort_order) VALUES ($1,'img-a',TRUE,1)`, [pid]);
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id, note) VALUES ($1,$2,$3)', [pid, vehicleId, 'یادداشت']);

  const p = await productRepo.findBySlug('p1');
  assert.equal(p.primary_image_id, 'img-a', 'تصویر اصلی باید اول بیاید');
  const images = await productRepo.imagesFor(pid);
  assert.equal(images.length, 2);
  const vehicles = await productRepo.vehiclesFor(pid);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].display_name, 'خودروی آزمون');
});

/* ------------------------------------------------------------ جست‌وجو */

test('جست‌وجو با شمارهٔ فنی دقیق، همان قطعه را می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'قطعهٔ الف', slug: 'a', sku: 'S1', oemNumber: '9678191580' });
  await insertProduct(db, { categoryId: catId, name: 'قطعهٔ ب', slug: 'b', sku: 'S2', oemNumber: '1234567890' });

  const res = await productRepo.search({ term: '9678191580' });
  assert.equal(res.matchedBy, 'part_number');
  assert.equal(res.total, 1);
  assert.equal(res.items[0].slug, 'a');
});

test('شمارهٔ فنی با خط تیره، فاصله یا رقم فارسی هم پیدا می‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1', oemNumber: '9678191580' });

  for (const variant of ['9678-191-580', '9678 191 580', '۹۶۷۸۱۹۱۵۸۰', '9678191580']) {
    const res = await productRepo.search({ term: variant });
    assert.equal(res.total, 1, `«${variant}» باید همان قطعه را پیدا کند`);
    assert.equal(res.items[0].slug, 'a');
  }
});

test('جست‌وجو با کد کالا (SKU) کار می‌کند', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'ABC1234' });
  const res = await productRepo.search({ term: 'abc1234' });
  assert.equal(res.total, 1, 'کد کالا نباید به بزرگی/کوچکی حرف حساس باشد');
});

test('جست‌وجوی نام فارسی، ناقص هم نتیجه می‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'فیلتر روغن موتور', slug: 'a', sku: 'S1' });
  await insertProduct(db, { categoryId: catId, name: 'لنت ترمز جلو', slug: 'b', sku: 'S2' });

  const res = await productRepo.search({ term: 'فیلتر روغن' });
  assert.equal(res.matchedBy, 'name');
  assert.ok(res.total >= 1);
  assert.equal(res.items[0].slug, 'a');
});

test('جست‌وجو به ی/ک عربی و رقم فارسی حساس نیست', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'کلید برق', slug: 'a', sku: 'S1' });

  /* «كليد» با کاف و یای عربی نوشته شده — باید همان را پیدا کند. */
  const arabic = await productRepo.search({ term: 'كليد' });
  assert.ok(arabic.total >= 1, 'ی/ک عربی باید نرمال شود');
  assert.equal(arabic.items[0].slug, 'a');
});

test('جست‌وجوی بی‌نتیجه، فهرست خالی می‌دهد نه خطا', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'فیلتر', slug: 'a', sku: 'S1' });
  const res = await productRepo.search({ term: 'زززززز' });
  assert.equal(res.total, 0);
  assert.deepEqual(res.items, []);
});

test('جست‌وجوی خالی بی‌خطر است', async () => {
  for (const term of ['', '   ', null, undefined]) {
    const res = await productRepo.search({ term });
    assert.equal(res.total, 0);
    assert.equal(res.matchedBy, 'none');
  }
});

test('جست‌وجو در برابر تزریق SQL امن است', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'a', sku: 'S1' });

  for (const evil of ["'; DROP TABLE products; --", "%' OR '1'='1", "\\'; DELETE FROM products; --"]) {
    const res = await productRepo.search({ term: evil });
    assert.ok(Array.isArray(res.items), 'باید نتیجهٔ عادی بدهد');
  }
  const still = await db.query('SELECT COUNT(*)::int AS n FROM products');
  assert.equal(still.rows[0].n, 1, 'جدول باید سالم بماند');
});

test('جست‌وجو صفحه‌بندی می‌شود', async () => {
  const catId = await insertCategory(db);
  for (let i = 1; i <= 5; i++) {
    await insertProduct(db, { categoryId: catId, name: `فیلتر شماره ${i}`, slug: `p${i}`, sku: `S${i}` });
  }
  const page1 = await productRepo.search({ term: 'فیلتر', perPage: 2, page: 1 });
  assert.equal(page1.items.length, 2);
  assert.equal(page1.pageCount, Math.ceil(page1.total / 2));
});

test('search_text هنگام درج ساخته می‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'فیلتر روغن', slug: 'a', sku: 'ABC1',
    oemNumber: '1111-2222', brandName: 'برند الف',
  });
  const r = await db.query('SELECT search_text, oem_number_normalized FROM products WHERE slug=$1', ['a']);
  const row = r.rows[0];
  assert.ok(row.search_text.includes('فیلتر روغن'));
  assert.ok(row.search_text.includes('abc1'));
  assert.ok(row.search_text.includes('برند الف'));
  assert.equal(row.oem_number_normalized, '11112222', 'شمارهٔ فنی باید بدون جداکننده ذخیره شود');
});
