/* ============================================================================
 * tests/product-vehicle-links.test.js — پیوند محصول ↔ خودرو (فاز ۶)
 * ----------------------------------------------------------------------------
 * setVehicles در *یک* دستور کار می‌کند. این فایل همان چیزی را می‌سنجد که
 * در فاز ۵ نداشتیم و باگ «جابه‌جایی دوم» را ممکن کرد: عملیات پیاپی، نه
 * فقط یک بار.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertProduct } = await import('./helpers/testDb.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createVehicleRepository } = await import('../src/db/repositories/vehicles.js');

let db, products, vehicles, productId, otherProductId, v1, v2, v3;

before(async () => {
  db = await createTestDb();
  products = createProductRepository(db);
  vehicles = createVehicleRepository(db);
});
after(async () => { if (db) await db.close(); });

beforeEach(async () => {
  await db.exec('TRUNCATE product_vehicle, products, vehicles, categories RESTART IDENTITY CASCADE');
  const cat = await insertCategory(db);
  productId = await insertProduct(db, { categoryId: cat, slug: 'p-1', sku: 'S1' });
  otherProductId = await insertProduct(db, { categoryId: cat, slug: 'p-2', sku: 'S2' });
  const mk = (n) => vehicles.create({
    make: 'نمونه', model: 'نمونه', slug: `v-${n}`, displayName: `خودروی ${n}`, isActive: true,
  });
  v1 = await mk(1); v2 = await mk(2); v3 = await mk(3);
});

const linked = async (id = productId) => (await products.vehicleIdsFor(id)).sort((a, b) => a - b);

/* ═════════════════════════════════ ۱. جایگزینی پیاپی */

test('پیوندها پیاپی جایگزین می‌شوند — نه فقط بار اول', async () => {
  assert.equal(await products.setVehicles(productId, [v1, v2]), 2);
  assert.deepEqual(await linked(), [v1, v2].sort((a, b) => a - b));

  assert.equal(await products.setVehicles(productId, [v2, v3]), 2);
  assert.deepEqual(await linked(), [v2, v3].sort((a, b) => a - b));

  assert.equal(await products.setVehicles(productId, [v1]), 1);
  assert.deepEqual(await linked(), [v1]);

  assert.equal(await products.setVehicles(productId, [v1, v2, v3]), 3);
  assert.deepEqual(await linked(), [v1, v2, v3].sort((a, b) => a - b));
});

test('اجرای دوبارهٔ همان انتخاب بی‌اثر است (idempotent)', async () => {
  await products.setVehicles(productId, [v1, v2]);
  assert.equal(await products.setVehicles(productId, [v1, v2]), 2);
  assert.deepEqual(await linked(), [v1, v2].sort((a, b) => a - b));
});

test('شناسهٔ تکراری در ورودی، ردیف تکراری نمی‌سازد', async () => {
  assert.equal(await products.setVehicles(productId, [v1, v1, v1]), 1);
  assert.deepEqual(await linked(), [v1]);
});

test('فهرست خالی همهٔ پیوندها را برمی‌دارد', async () => {
  await products.setVehicles(productId, [v1, v2]);
  assert.equal(await products.setVehicles(productId, []), 0);
  assert.deepEqual(await linked(), []);
});

test('ورودی بی‌معنی بی‌صدا کنار گذاشته می‌شود', async () => {
  assert.equal(await products.setVehicles(productId, [v1, 'abc', -5, 0, null, undefined]), 1);
  assert.deepEqual(await linked(), [v1]);
});

test('پیوند به خودروی ناموجود با خطای کلید خارجی رد می‌شود', async () => {
  await assert.rejects(
    () => products.setVehicles(productId, [999999]),
    (err) => err.code === 'fk_missing' || err.code === '23503'
  );
});

/* ═══════════════════════════════════ ۲. جداسازی */

test('تغییر پیوندهای یک محصول، محصول دیگر را دست نمی‌زند', async () => {
  await products.setVehicles(otherProductId, [v1, v2, v3]);
  await products.setVehicles(productId, [v1]);
  await products.setVehicles(productId, []);

  assert.deepEqual(await linked(otherProductId), [v1, v2, v3].sort((a, b) => a - b));
});

/* ═══════════════════════════════════ ۳. حذف‌ها */

test('حذف محصول، پیوندهایش را با CASCADE می‌برد', async () => {
  await products.setVehicles(productId, [v1, v2]);
  await db.query('DELETE FROM products WHERE id = $1', [productId]);
  const left = await db.query('SELECT COUNT(*)::int AS n FROM product_vehicle WHERE product_id=$1',
    [productId]);
  assert.equal(left.rows[0].n, 0);
});

test('خودروی پیونددار حذف نمی‌شود، ولی پس از برداشتن پیوند می‌شود', async () => {
  await products.setVehicles(productId, [v1]);
  await assert.rejects(() => vehicles.remove(v1), (err) => err.code === 'fk_restrict');

  await products.setVehicles(productId, []);
  assert.equal(await vehicles.remove(v1), true);
});

/* ═══════════════════════════ ۴. فیلتر عمومی خودرو */

test('فیلتر خودرو فقط محصول‌های سازگار را می‌دهد', async () => {
  await products.setVehicles(productId, [v1]);
  await products.setVehicles(otherProductId, [v2]);

  const only1 = await products.list({ filters: { vehicleId: v1 } });
  assert.equal(only1.total, 1);
  assert.equal(only1.items[0].id, productId);

  const none = await products.list({ filters: { vehicleId: v3 } });
  assert.equal(none.total, 0);
});
