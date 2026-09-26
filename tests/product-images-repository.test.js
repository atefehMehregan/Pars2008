/* ============================================================================
 * tests/product-images-repository.test.js — مخزن تصویر محصول (فاز ۵)
 * ----------------------------------------------------------------------------
 * روی PGlite اجرا می‌شود، یعنی همان PostgreSQL واقعی: قید یکتای جزئیِ
 * «یک تصویر اصلی» و CASCADE واقعا اعمال می‌شوند، نه شبیه‌سازی.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertProduct } = await import('./helpers/testDb.js');
const { createProductImageRepository } = await import('../src/db/repositories/productImages.js');

let db, repo, productId, otherProductId;

const uuid = (n) => `${String(n).repeat(8)}-1111-4222-8333-444444444444`.slice(0, 36);
const A = uuid(1), B = uuid(2), C = uuid(3);

before(async () => {
  db = await createTestDb();
  repo = createProductImageRepository(db);
});

after(async () => { if (db) await db.close(); });

beforeEach(async () => {
  await db.exec('TRUNCATE product_images, products, categories RESTART IDENTITY CASCADE');
  const catId = await insertCategory(db);
  productId = await insertProduct(db, { categoryId: catId, slug: 'p-1', sku: 'S1' });
  otherProductId = await insertProduct(db, { categoryId: catId, slug: 'p-2', sku: 'S2' });
});

/* ═══════════════════════════════════════════ ۱. افزودن */

test('افزودن تصویر، ردیف را با ترتیب انتهای فهرست می‌سازد', async () => {
  const first = await repo.add({ productId, imageId: A, width: 800, height: 600 });
  const second = await repo.add({ productId, imageId: B });

  assert.equal(first.sort_order, 0);
  assert.equal(second.sort_order, 1, 'قلم بعدی باید انتهای فهرست بنشیند');
  assert.equal(first.width, 800);
  assert.equal(first.height, 600);
  assert.equal(await repo.countForProduct(productId), 2);
});

test('is_primary فقط وقتی روشن است که صریح خواسته شود', async () => {
  const row = await repo.add({ productId, imageId: A });
  assert.equal(row.is_primary, false, 'مخزن خودش تصمیم نمی‌گیرد — کنترلر تصمیم می‌گیرد');
});

test('دو تصویر اصلی برای یک محصول ممکن نیست', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await assert.rejects(
    () => repo.add({ productId, imageId: B, isPrimary: true }),
    /duplicate key|unique/i,
    'قید پایگاه داده باید جلویش را بگیرد'
  );
});

test('دو محصول می‌توانند هرکدام تصویر اصلی خودشان را داشته باشند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId: otherProductId, imageId: B, isPrimary: true });
  assert.equal((await repo.listForProduct(productId)).length, 1);
  assert.equal((await repo.listForProduct(otherProductId)).length, 1);
});

/* ═════════════════════════════════════ ۲. تصویر اصلی */

test('setPrimary جابه‌جا می‌کند و قید را نمی‌شکند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });
  await repo.add({ productId, imageId: C });

  assert.equal(await repo.setPrimary(productId, B), true);

  const rows = await repo.listForProduct(productId);
  const primary = rows.filter((r) => r.is_primary);
  assert.equal(primary.length, 1, 'دقیقا یکی');
  assert.equal(primary[0].image_id, B);
});

/* ---------------------------------------------------------------------
 * آزمون بازگشتی برای باگ «اصلی کردنِ بار دوم».
 *
 * پیاده‌سازی قبلی با یک دستور کار می‌کرد و فقط *نخستین* جابه‌جایی روی
 * ردیف‌های تازه‌درج‌شده را درست انجام می‌داد؛ جابه‌جایی دوم با خطای
 * 23505 روی idx_product_images_one_primary می‌شکست و کاربر صفحهٔ ۵۰۰
 * می‌دید.
 *
 * آزمون قبلی این را نمی‌گرفت چون فقط *یک* جابه‌جایی داشت — دقیقا همان
 * حالتی که کار می‌کرد. این آزمون چند جابه‌جایی پشت سر هم می‌کند.
 * ------------------------------------------------------------------ */
test('جابه‌جایی‌های پیاپی تصویر اصلی: A → B → C → A', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });
  await repo.add({ productId, imageId: C });

  const expectOnly = async (expected, step) => {
    const rows = await repo.listForProduct(productId);
    const primary = rows.filter((r) => r.is_primary);
    assert.equal(primary.length, 1, `${step}: باید دقیقا یک تصویر اصلی باشد`);
    assert.equal(primary[0].image_id, expected, `${step}: تصویر اصلی باید ${expected} باشد`);
    assert.equal(rows.length, 3, `${step}: هیچ ردیفی نباید گم شود`);
  };

  await expectOnly(A, 'وضعیت اولیه');

  assert.equal(await repo.setPrimary(productId, B), true, 'جابه‌جایی ۱');
  await expectOnly(B, 'پس از A → B');

  /* اینجا بود که پیاده‌سازی قبلی می‌شکست. */
  assert.equal(await repo.setPrimary(productId, C), true, 'جابه‌جایی ۲');
  await expectOnly(C, 'پس از B → C');

  assert.equal(await repo.setPrimary(productId, A), true, 'جابه‌جایی ۳ — بازگشت به اولی');
  await expectOnly(A, 'پس از C → A');

  /* و باز هم، تا مطمئن شویم به تعداد دفعات بستگی ندارد. */
  assert.equal(await repo.setPrimary(productId, B), true, 'جابه‌جایی ۴');
  await expectOnly(B, 'پس از A → B (دور دوم)');
});

test('اصلی کردنِ تصویری که از قبل اصلی است، بی‌خطر و بی‌اثر است', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });

  for (let i = 0; i < 3; i += 1) {
    assert.equal(await repo.setPrimary(productId, A), true, `تکرار ${i + 1}`);
    const primary = (await repo.listForProduct(productId)).filter((r) => r.is_primary);
    assert.equal(primary.length, 1);
    assert.equal(primary[0].image_id, A);
  }
});

test('جابه‌جایی با دو تصویر هم پیاپی کار می‌کند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });

  for (const target of [B, A, B, A]) {
    assert.equal(await repo.setPrimary(productId, target), true);
    const primary = (await repo.listForProduct(productId)).filter((r) => r.is_primary);
    assert.equal(primary.length, 1);
    assert.equal(primary[0].image_id, target);
  }
});

test('جابه‌جایی در یک محصول، تصویر اصلیِ محصول دیگر را دست نمی‌زند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });
  await repo.add({ productId: otherProductId, imageId: C, isPrimary: true });

  await repo.setPrimary(productId, B);
  await repo.setPrimary(productId, A);

  const other = await repo.listForProduct(otherProductId);
  assert.equal(other.length, 1);
  assert.equal(other[0].is_primary, true, 'محصول دیگر باید تصویر اصلی خودش را نگه دارد');
});

test('setPrimary برای شناسهٔ ناموجود false می‌دهد و چیزی را عوض نمی‌کند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  assert.equal(await repo.setPrimary(productId, C), false);
  const rows = await repo.listForProduct(productId);
  assert.equal(rows[0].image_id, A);
  assert.equal(rows[0].is_primary, true);
});

test('setPrimary تصویر محصول دیگر را نمی‌قاپد', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId: otherProductId, imageId: B });
  assert.equal(await repo.setPrimary(productId, B), false, 'B مال این محصول نیست');
});

test('promotePrimaryIfMissing کم‌ترین sort_order را اصلی می‌کند', async () => {
  await repo.add({ productId, imageId: A, sortOrder: 5 });
  await repo.add({ productId, imageId: B, sortOrder: 1 });

  const promoted = await repo.promotePrimaryIfMissing(productId);
  assert.equal(promoted, B, 'کم‌ترین ترتیب باید جانشین شود');

  const rows = await repo.listForProduct(productId);
  assert.equal(rows.filter((r) => r.is_primary).length, 1);
});

test('promotePrimaryIfMissing وقتی اصلی هست کاری نمی‌کند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });
  assert.equal(await repo.promotePrimaryIfMissing(productId), null);
  assert.equal((await repo.findOne(productId, A)).is_primary, true);
});

test('promotePrimaryIfMissing روی محصول بی‌تصویر بی‌خطر است', async () => {
  assert.equal(await repo.promotePrimaryIfMissing(productId), null);
});

/* ════════════════════════════════════════ ۳. ترتیب و متن */

test('reorder در یک دستور ترتیب را می‌نویسد', async () => {
  await repo.add({ productId, imageId: A });
  await repo.add({ productId, imageId: B });
  await repo.add({ productId, imageId: C });

  const moved = await repo.reorder(productId, [C, A, B]);
  assert.equal(moved, 3);

  const order = (await repo.listForProduct(productId))
    .slice().sort((x, y) => x.sort_order - y.sort_order).map((r) => r.image_id);
  assert.deepEqual(order, [C, A, B]);
});

test('reorder شناسهٔ محصول دیگر را نادیده می‌گیرد', async () => {
  await repo.add({ productId, imageId: A });
  await repo.add({ productId: otherProductId, imageId: B });
  const moved = await repo.reorder(productId, [B, A]);
  assert.equal(moved, 1, 'فقط تصویر همین محصول جابه‌جا می‌شود');
});

test('reorder با فهرست خالی بی‌اثر است', async () => {
  await repo.add({ productId, imageId: A });
  assert.equal(await repo.reorder(productId, []), 0);
  assert.equal(await repo.reorder(productId, null), 0);
});

test('متن جایگزین ذخیره می‌شود و خالی به NULL می‌رود', async () => {
  await repo.add({ productId, imageId: A });
  const updated = await repo.updateAlt(productId, A, '  لنت ترمز جلو  ');
  assert.equal(updated.alt_text, 'لنت ترمز جلو', 'فاصله‌های دو سر باید بریده شوند');

  const cleared = await repo.updateAlt(productId, A, '   ');
  assert.equal(cleared.alt_text, null, 'خالی یعنی NULL، نه رشتهٔ خالی');
});

test('updateAlt برای تصویر محصول دیگر null می‌دهد', async () => {
  await repo.add({ productId: otherProductId, imageId: B });
  assert.equal(await repo.updateAlt(productId, B, 'x'), null);
});

/* ═══════════════════════════════════════════ ۴. حذف */

test('remove ردیف حذف‌شده را برمی‌گرداند تا کنترلر بداند چه پاک کند', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  const row = await repo.remove(productId, A);
  assert.equal(row.image_id, A);
  assert.equal(row.is_primary, true, 'کنترلر باید بداند اصلی بوده');
  assert.equal(await repo.countForProduct(productId), 0);
});

test('remove برای شناسهٔ ناموجود null می‌دهد', async () => {
  assert.equal(await repo.remove(productId, A), null);
});

test('remove تصویر محصول دیگر را پاک نمی‌کند', async () => {
  await repo.add({ productId: otherProductId, imageId: B });
  assert.equal(await repo.remove(productId, B), null);
  assert.equal(await repo.countForProduct(otherProductId), 1);
});

/* ══════════════════════════ ۵. نظافت و حذف محصول */

test('imageIdsForProduct همهٔ شناسه‌ها را می‌دهد — ورودی نظافت فایل', async () => {
  await repo.add({ productId, imageId: A });
  await repo.add({ productId, imageId: B });
  const ids = await repo.imageIdsForProduct(productId);
  assert.deepEqual(ids.slice().sort(), [A, B].sort());
});

test('حذف محصول، ردیف تصویرها را با CASCADE می‌برد', async () => {
  await repo.add({ productId, imageId: A, isPrimary: true });
  await repo.add({ productId, imageId: B });

  await db.query('DELETE FROM products WHERE id = $1', [productId]);

  assert.equal(await repo.countForProduct(productId), 0, 'ردیفی نباید بماند');
  const orphans = await db.query('SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1',
    [productId]);
  assert.equal(orphans.rows[0].n, 0);
});

test('شناسه‌ها باید *پیش از* حذف محصول خوانده شوند — بعدش دیگر نیستند', async () => {
  await repo.add({ productId, imageId: A });
  const before = await repo.imageIdsForProduct(productId);
  await db.query('DELETE FROM products WHERE id = $1', [productId]);
  const after = await repo.imageIdsForProduct(productId);

  assert.equal(before.length, 1);
  assert.equal(after.length, 0,
    'این دقیقا دلیلِ ترتیبِ «اول شناسه‌ها را بخوان، بعد حذف کن» در کنترلر است');
});
