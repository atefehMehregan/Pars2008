/* ============================================================================
 * tests/catalog-schema.test.js — آزمون اسکیمای کاتالوگ
 * ----------------------------------------------------------------------------
 * روی PGlite (PostgreSQL 18، WASM) اجرا می‌شود، پس قیدها و ایندکس‌ها واقعا
 * ساخته و واقعا آزموده می‌شوند.
 *
 * هر آزمون پایگاه دادهٔ خودش را می‌سازد و می‌بندد؛ هیچ حالتی بین آزمون‌ها
 * مشترک نیست و چیزی برای نظافت باقی نمی‌ماند.
 * ==========================================================================*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertCategory, insertBrand, insertProduct } from './helpers/testDb.js';

process.env.NODE_ENV = 'test';

/* ------------------------------------------------- ساخته شدن جدول‌ها */

test('همهٔ مهاجرت‌ها اعمال می‌شوند و شش جدول کاتالوگ ساخته می‌شود', async () => {
  const db = await createTestDb();
  try {
    assert.deepEqual(db.appliedMigrations, ['001_extensions.sql', '002_catalog.sql']);

    const res = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const names = res.rows.map((r) => r.table_name);
    for (const t of ['brands', 'categories', 'product_images', 'product_vehicle', 'products', 'vehicles']) {
      assert.ok(names.includes(t), `جدول ${t} باید ساخته شود — موجود: ${names.join(', ')}`);
    }
  } finally { await db.close(); }
});

test('افزونهٔ pg_trgm در دسترس است', async () => {
  const db = await createTestDb();
  try {
    const res = await db.query("SELECT similarity('فیلتر روغن', 'فیلتر روغن موتور') AS s");
    assert.ok(res.rows[0].s > 0, 'similarity باید مقدار مثبت بدهد');
  } finally { await db.close(); }
});

test('اجرای دوبارهٔ مهاجرت‌ها بی‌خطر است (idempotent)', async () => {
  const db = await createTestDb();
  try {
    const before = await db.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"
    );
    /* همان فایل‌ها دوباره — همهٔ دستورها IF NOT EXISTS دارند. */
    const { default: fs } = await import('node:fs');
    const { default: path } = await import('node:path');
    const { listMigrationFiles } = await import('../src/db/migrate.js');
    const { ROOT } = await import('../src/config/index.js');
    for (const f of listMigrationFiles(path.join(ROOT, 'migrations'))) {
      await db.exec(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
    }
    const after = await db.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'"
    );
    assert.equal(after.rows[0].n, before.rows[0].n);
  } finally { await db.close(); }
});

/* ------------------------------------------------------- نوع ستون‌ها */

test('مبلغ‌ها bigint‌اند، نه اعشار شناور', async () => {
  const db = await createTestDb();
  try {
    const res = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='products' AND column_name IN ('price_toman','sale_price_toman')
       ORDER BY column_name`
    );
    const types = Object.fromEntries(res.rows.map((r) => [r.column_name, r.data_type]));
    assert.equal(types.price_toman, 'bigint');
    assert.equal(types.sale_price_toman, 'bigint');
  } finally { await db.close(); }
});

test('زمان‌ها timestamptz‌اند و specs از نوع jsonb است', async () => {
  const db = await createTestDb();
  try {
    const res = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='products' AND column_name IN ('created_at','updated_at','specs')`
    );
    const types = Object.fromEntries(res.rows.map((r) => [r.column_name, r.data_type]));
    assert.ok(types.created_at.startsWith('timestamp with'), types.created_at);
    assert.ok(types.updated_at.startsWith('timestamp with'), types.updated_at);
    assert.equal(types.specs, 'jsonb');
  } finally { await db.close(); }
});

/* ------------------------------------------------------------- قیدها */

test('قیمت منفی رد می‌شود', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, priceToman: -1 }),
      /products_price_non_negative|violates check/i
    );
  } finally { await db.close(); }
});

test('قیمت حراج باید کمتر از قیمت اصلی باشد', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, priceToman: 100000, salePriceToman: 100000 }),
      /products_sale_below_price|violates check/i
    );
    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, slug: 'x2', sku: 'X2', priceToman: 100000, salePriceToman: 200000 }),
      /products_sale_below_price|violates check/i
    );
  } finally { await db.close(); }
});

test('وضعیت موجودی ناشناخته رد می‌شود', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, availability: 'maybe' }),
      /products_availability_known|violates check/i
    );
  } finally { await db.close(); }
});

test('موجودی منفی و نام خالی رد می‌شوند', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await assert.rejects(() => insertProduct(db, { categoryId: catId, stockQty: -1 }), /violates check/i);
    await assert.rejects(() => insertProduct(db, { categoryId: catId, name: '   ' }), /violates check/i);
  } finally { await db.close(); }
});

/* ------------------------------------------------------------ یکتایی */

test('نشانی و کد کالای تکراری رد می‌شوند', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await insertProduct(db, { categoryId: catId, slug: 'قطعه-یک', sku: 'SKU-1' });

    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, slug: 'قطعه-یک', sku: 'SKU-2' }),
      /duplicate key|unique/i, 'نشانی تکراری باید رد شود'
    );
    await assert.rejects(
      () => insertProduct(db, { categoryId: catId, slug: 'قطعه-دو', sku: 'SKU-1' }),
      /duplicate key|unique/i, 'کد کالای تکراری باید رد شود'
    );
  } finally { await db.close(); }
});

test('نشانی تکراری دسته و برند رد می‌شود', async () => {
  const db = await createTestDb();
  try {
    await insertCategory(db, { slug: 'ترمز' });
    await assert.rejects(() => insertCategory(db, { slug: 'ترمز' }), /duplicate key|unique/i);
    await insertBrand(db, { slug: 'برند-الف' });
    await assert.rejects(() => insertBrand(db, { slug: 'برند-الف' }), /duplicate key|unique/i);
  } finally { await db.close(); }
});

/* ------------------------------------------------- کلیدهای خارجی */

test('حذف دسته‌ای که محصول دارد ممنوع است (RESTRICT)', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    await insertProduct(db, { categoryId: catId });
    await assert.rejects(
      () => db.query('DELETE FROM categories WHERE id = $1', [catId]),
      /foreign key|violates/i, 'دسته با محصول نباید حذف شود'
    );
  } finally { await db.close(); }
});

test('حذف محصول، تصویرهایش را هم می‌برد (CASCADE)', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    const pid = await insertProduct(db, { categoryId: catId });
    await db.query(
      `INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1,$2,TRUE)`,
      [pid, 'test-image-id']
    );
    await db.query('DELETE FROM products WHERE id = $1', [pid]);
    const left = await db.query('SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1', [pid]);
    assert.equal(left.rows[0].n, 0);
  } finally { await db.close(); }
});

test('محصول بدون دستهٔ معتبر ساخته نمی‌شود', async () => {
  const db = await createTestDb();
  try {
    await assert.rejects(
      () => insertProduct(db, { categoryId: 999999 }),
      /foreign key|violates/i
    );
  } finally { await db.close(); }
});

test('دسته نمی‌تواند والد خودش باشد', async () => {
  const db = await createTestDb();
  try {
    const id = await insertCategory(db);
    await assert.rejects(
      () => db.query('UPDATE categories SET parent_id = $1 WHERE id = $1', [id]),
      /categories_not_own_parent|violates check/i
    );
  } finally { await db.close(); }
});

test('هر محصول حداکثر یک تصویر اصلی دارد', async () => {
  const db = await createTestDb();
  try {
    const catId = await insertCategory(db);
    const pid = await insertProduct(db, { categoryId: catId });
    await db.query(`INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1,'a',TRUE)`, [pid]);
    await assert.rejects(
      () => db.query(`INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1,'b',TRUE)`, [pid]),
      /duplicate key|unique/i
    );
    /* تصویر غیراصلی محدودیتی ندارد */
    await db.query(`INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1,'c',FALSE)`, [pid]);
    const n = await db.query('SELECT COUNT(*)::int AS n FROM product_images WHERE product_id=$1', [pid]);
    assert.equal(n.rows[0].n, 2);
  } finally { await db.close(); }
});

test('بازهٔ سال خودرو نمی‌تواند معکوس باشد', async () => {
  const db = await createTestDb();
  try {
    await assert.rejects(
      () => db.query(
        `INSERT INTO vehicles (make, model, slug, display_name, year_from, year_to)
         VALUES ('م','م','v','خ',2020,2018)`),
      /vehicles_year_range|violates check/i
    );
  } finally { await db.close(); }
});

/* --------------------------------------------------------- ایندکس‌ها */

test('ایندکس‌های لازم ساخته شده‌اند، از جمله ایندکس سه‌نویسه‌ای جست‌وجو', async () => {
  const db = await createTestDb();
  try {
    const res = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`
    );
    const idx = res.rows.map((r) => r.indexname);
    for (const expected of [
      'idx_products_slug', 'idx_products_sku', 'idx_products_oem',
      'idx_products_category', 'idx_products_brand', 'idx_products_active_new',
      'idx_products_search_trgm', 'idx_categories_slug', 'idx_brands_slug',
      'idx_vehicles_slug', 'idx_product_images_one_primary',
    ]) {
      assert.ok(idx.includes(expected), `ایندکس ${expected} باید وجود داشته باشد`);
    }
  } finally { await db.close(); }
});

test('هیچ دادهٔ نمونه‌ای در مهاجرت‌ها نیست', async () => {
  const db = await createTestDb();
  try {
    for (const t of ['categories', 'brands', 'vehicles', 'products', 'product_images', 'product_vehicle']) {
      const r = await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      assert.equal(r.rows[0].n, 0, `جدول ${t} باید پس از مهاجرت خالی باشد`);
    }
  } finally { await db.close(); }
});
