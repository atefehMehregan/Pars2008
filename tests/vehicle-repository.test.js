/* ============================================================================
 * tests/vehicle-repository.test.js — مخزن خودروها (فاز ۶)
 * ----------------------------------------------------------------------------
 * روی PGlite، یعنی PostgreSQL واقعی: قید بازهٔ سال، یکتایی نشانی و
 * RESTRICT همگی واقعا اعمال می‌شوند.
 *
 * هیچ دادهٔ واقعی خودرویی اینجا نیست — نام‌ها آشکارا ساختگی‌اند.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertProduct } = await import('./helpers/testDb.js');
const { createVehicleRepository } = await import('../src/db/repositories/vehicles.js');

let db, repo;

const sample = (over = {}) => ({
  make: 'سازندهٔ نمونه', model: 'مدل نمونه',
  slug: 'خودرو-نمونه', displayName: 'خودروی نمونه',
  sortOrder: 0, isActive: true, ...over,
});

before(async () => { db = await createTestDb(); repo = createVehicleRepository(db); });
after(async () => { if (db) await db.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE product_vehicle, products, vehicles, categories RESTART IDENTITY CASCADE');
});

/* ═════════════════════════════════════════════ ۱. ساخت */

test('ساخت خودرو با کمینهٔ فیلدهای لازم', async () => {
  const id = await repo.create(sample());
  const row = await repo.findById(id);
  assert.equal(row.make, 'سازندهٔ نمونه');
  assert.equal(row.display_name, 'خودروی نمونه');
  assert.equal(row.is_active, true);
  assert.equal(row.sort_order, 0);
});

test('ستون‌های توصیفی اختیاری‌اند و NULL می‌مانند', async () => {
  const id = await repo.create(sample());
  const row = await repo.findById(id);
  for (const col of ['generation', 'year_from', 'year_to', 'engine_code', 'engine_label']) {
    assert.equal(row[col], null, `${col} باید NULL بماند — دادهٔ کسب‌وکار ساخته نمی‌شود`);
  }
});

test('ستون‌های توصیفی وقتی داده شوند ذخیره می‌شوند', async () => {
  const id = await repo.create(sample({
    generation: 'نسل نمونه', yearFrom: 2015, yearTo: 2020,
    engineCode: 'SAMPLE-CODE', engineLabel: 'موتور نمونه',
  }));
  const row = await repo.findById(id);
  assert.equal(row.generation, 'نسل نمونه');
  assert.equal(row.year_from, 2015);
  assert.equal(row.year_to, 2020);
  assert.equal(row.engine_code, 'SAMPLE-CODE');
});

test('نشانی تکراری به خطای فیلد «slug» ترجمه می‌شود', async () => {
  await repo.create(sample());
  await assert.rejects(
    () => repo.create(sample({ displayName: 'دیگری' })),
    (err) => err.code === 'duplicate' && err.field === 'slug'
  );
});

test('بازهٔ سال معکوس را پایگاه داده رد می‌کند', async () => {
  await assert.rejects(
    () => repo.create(sample({ yearFrom: 2020, yearTo: 2015 })),
    (err) => err.code === 'check_failed'
  );
});

test('سال برابر مجاز است — خودروی یک‌ساله', async () => {
  const id = await repo.create(sample({ yearFrom: 2018, yearTo: 2018 }));
  assert.ok(id);
});

/* ═════════════════════════════════════════ ۲. خواندن */

test('listActive فقط خودروهای فعال را می‌دهد، به ترتیب نمایش', async () => {
  await repo.create(sample({ slug: 'v-b', displayName: 'ب', sortOrder: 2 }));
  await repo.create(sample({ slug: 'v-a', displayName: 'الف', sortOrder: 1 }));
  await repo.create(sample({ slug: 'v-x', displayName: 'غیرفعال', isActive: false }));

  const rows = await repo.listActive();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.display_name), ['الف', 'ب']);
});

test('findBySlug خودروی غیرفعال یا ناشناس را null می‌دهد', async () => {
  await repo.create(sample({ slug: 'v-off', isActive: false }));
  assert.equal(await repo.findBySlug('v-off'), null);
  assert.equal(await repo.findBySlug('nope'), null);
});

test('listWithCounts فقط محصول فعال را می‌شمارد و خودروی بی‌محصول را با صفر می‌آورد', async () => {
  const v1 = await repo.create(sample({ slug: 'v-1', displayName: 'یک' }));
  await repo.create(sample({ slug: 'v-2', displayName: 'دو' }));
  const cat = await insertCategory(db);
  const active = await insertProduct(db, { categoryId: cat, slug: 'p1', sku: 'S1' });
  const hidden = await insertProduct(db, { categoryId: cat, slug: 'p2', sku: 'S2', isActive: false });
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1,$2),($3,$2)',
    [active, v1, hidden]);

  const rows = await repo.listWithCounts();
  const byName = Object.fromEntries(rows.map((r) => [r.display_name, r.product_count]));
  assert.equal(byName['یک'], 1, 'فقط محصول فعال شمرده می‌شود');
  assert.equal(byName['دو'], 0, 'خودروی بی‌محصول هم با صفر می‌آید');
});

test('adminList همهٔ خودروها را با شمار کاملِ محصول می‌دهد', async () => {
  const v1 = await repo.create(sample({ slug: 'v-1' }));
  await repo.create(sample({ slug: 'v-2', isActive: false }));
  const cat = await insertCategory(db);
  const hidden = await insertProduct(db, { categoryId: cat, slug: 'p1', sku: 'S1', isActive: false });
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1,$2)', [hidden, v1]);

  const rows = await repo.adminList();
  assert.equal(rows.length, 2, 'غیرفعال هم می‌آید');
  assert.equal(rows.find((r) => r.slug === 'v-1').product_count, 1,
    'برای تصمیم دربارهٔ حذف، محصول غیرفعال هم شمرده می‌شود');
});

/* ═════════════════════════════════════ ۳. نوشتن و حذف */

test('به‌روزرسانی مقدارها را عوض می‌کند و updated_at را جلو می‌برد', async () => {
  const id = await repo.create(sample());
  const before = await repo.findById(id);
  await new Promise((r) => setTimeout(r, 5));

  await repo.update(id, sample({ displayName: 'نام تازه', generation: 'نسل تازه' }));
  const after = await repo.findById(id);

  assert.equal(after.display_name, 'نام تازه');
  assert.equal(after.generation, 'نسل تازه');
  assert.ok(new Date(after.updated_at) > new Date(before.updated_at), 'هیچ trigger ای نیست');
});

test('به‌روزرسانی شناسهٔ ناموجود null می‌دهد', async () => {
  assert.equal(await repo.update(9999, sample()), null);
});

test('setActive برگشت‌پذیر است', async () => {
  const id = await repo.create(sample());
  assert.equal((await repo.setActive(id, false)).is_active, false);
  assert.equal((await repo.setActive(id, true)).is_active, true);
});

test('حذف خودروی بدون پیوند انجام می‌شود', async () => {
  const id = await repo.create(sample());
  assert.equal(await repo.remove(id), true);
  assert.equal(await repo.findById(id), null);
});

test('حذف خودروی دارای محصول با RESTRICT جلو گرفته می‌شود', async () => {
  const id = await repo.create(sample());
  const cat = await insertCategory(db);
  const pid = await insertProduct(db, { categoryId: cat, slug: 'p1', sku: 'S1' });
  await db.query('INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1,$2)', [pid, id]);

  await assert.rejects(
    () => repo.remove(id),
    (err) => err.code === 'fk_restrict' && err.constraint === 'product_vehicle_vehicle_id_fkey'
  );
  assert.ok(await repo.findById(id), 'خودرو باید سر جایش بماند');
});

test('حذف شناسهٔ ناموجود false می‌دهد', async () => {
  assert.equal(await repo.remove(9999), false);
});

/* ═════════════════════════ ۵. وجودِ شناسه‌ها (رفع OBS-1) */

test('existingIds فقط شناسه‌های موجود را برمی‌گرداند', async () => {
  const a = await repo.create(sample({ slug: 'v-a', displayName: 'الف' }));
  const b = await repo.create(sample({ slug: 'v-b', displayName: 'ب' }));

  const found = await repo.existingIds([a, 999999, b]);
  assert.deepEqual(found.sort((x, y) => x - y), [a, b].sort((x, y) => x - y));
});

test('existingIds خودروی غیرفعال را هم موجود می‌شمارد', async () => {
  const id = await repo.create(sample({ isActive: false }));
  assert.deepEqual(await repo.existingIds([id]), [id]);
});

test('existingIds با فهرست خالی یا ورودی بدشکل، بی‌خطر خالی می‌دهد', async () => {
  assert.deepEqual(await repo.existingIds([]), []);
  assert.deepEqual(await repo.existingIds(null), []);
  assert.deepEqual(await repo.existingIds(['abc', -1, 0, 1.5]), []);
});
