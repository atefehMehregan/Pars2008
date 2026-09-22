/* ============================================================================
 * tests/catalog-write-repositories.test.js — آزمون نوشتن در کاتالوگ
 * ----------------------------------------------------------------------------
 * روی PGlite اجرا می‌شود، یعنی همان PostgreSQL. پس قیدها، کلیدهای خارجی
 * و CASCADE واقعا اعمال می‌شوند و این آزمون رفتار پایگاه داده را
 * شبیه‌سازی نمی‌کند — می‌سنجدش.
 *
 * تمرکز روی چیزهایی است که جای دیگری تضمین نشده‌اند:
 *   * search_text و oem_number_normalized را چه کسی پر می‌کند؟
 *   * updated_at بدون trigger واقعا جلو می‌رود؟
 *   * خطای کلید تکراری به نام فیلد ترجمه می‌شود؟
 *   * RESTRICT و CASCADE همان‌طورند که انتظار می‌رود؟
 *   * غیرفعال کردن، رفتار فهرست عمومی را عوض می‌کند ولی داده را نگه می‌دارد؟
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDb, insertCategory, insertBrand, insertVehicle,
} from './helpers/testDb.js';
import { createProductRepository } from '../src/db/repositories/products.js';
import { createCategoryRepository } from '../src/db/repositories/categories.js';
import { createBrandRepository } from '../src/db/repositories/brands.js';

process.env.NODE_ENV = 'test';

let db, products, categories, brands;

before(async () => {
  db = await createTestDb();
  products = createProductRepository(db);
  categories = createCategoryRepository(db);
  brands = createBrandRepository(db);
});

after(async () => { if (db) await db.close(); });

beforeEach(async () => {
  await db.exec(`TRUNCATE product_images, product_vehicle, products, vehicles, brands, categories
                 RESTART IDENTITY CASCADE`);
});

/** دادهٔ پایهٔ یک محصول معتبر؛ هر آزمون فقط تفاوتش را می‌نویسد. */
function productData(categoryId, overrides = {}) {
  return {
    name: 'لنت ترمز جلو',
    slug: 'لنت-ترمز-جلو',
    sku: 'BRK-100',
    oemNumber: null,
    categoryId,
    brandId: null,
    priceToman: 250000,
    salePriceToman: null,
    stockQty: 4,
    availability: 'in_stock',
    shortDescription: null,
    description: null,
    specs: {},
    compatibilityNote: null,
    weightGrams: null,
    isFeatured: false,
    isNew: false,
    isActive: true,
    ...overrides,
  };
}

async function rowOf(id) {
  const r = await db.query(
    'SELECT search_text, oem_number_normalized, updated_at, created_at FROM products WHERE id = $1',
    [id]
  );
  return r.rows[0];
}

/* ============================================ ساخت و متن جست‌وجو ===== */

test('ساخت محصول، search_text و oem_number_normalized را خودش پر می‌کند', async () => {
  const catId = await insertCategory(db, { name: 'ترمز', slug: 'ترمز' });
  const brandId = await insertBrand(db, { name: 'والئو', slug: 'والئو' });

  const id = await products.create(productData(catId, {
    brandId,
    oemNumber: '9678-191-580',
    shortDescription: 'برای پژو ۲۰۰۸',
  }));

  const row = await rowOf(id);
  assert.equal(row.oem_number_normalized, '9678191580',
    'جداکننده‌ها باید از شمارهٔ فنی حذف شوند');
  assert.ok(row.search_text.includes('9678191580'), 'شکل نرمال باید در متن جست‌وجو باشد');
  assert.ok(row.search_text.includes('والئو'), 'نام برند باید در متن جست‌وجو باشد');
  assert.ok(row.search_text.includes('brk-100'), 'کد کالا باید در متن جست‌وجو باشد');
});

test('محصول تازه بلافاصله با جست‌وجوی عمومی پیدا می‌شود', async () => {
  /* اگر search_text پر نمی‌شد، محصول بی‌سروصدا از جست‌وجو غیب می‌شد —
     خرابی‌ای که تا شکایت مشتری دیده نمی‌شود. */
  const catId = await insertCategory(db, { name: 'ترمز', slug: 'ترمز' });
  await products.create(productData(catId, { oemNumber: '9678191580' }));

  const byName = await products.search({ term: 'لنت ترمز' });
  assert.equal(byName.total, 1, 'جست‌وجوی نام باید محصول تازه را بیاورد');

  const byOem = await products.search({ term: '9678 191 580' });
  assert.equal(byOem.total, 1, 'جست‌وجوی شمارهٔ فنی با جداکنندهٔ متفاوت هم باید بیاورد');
  assert.equal(byOem.matchedBy, 'part_number');
});

test('شمارهٔ فنیِ خالی به null می‌رود، نه رشتهٔ خالی', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId, { oemNumber: '' }));
  const row = await rowOf(id);
  assert.equal(row.oem_number_normalized, null);
});

/* ================================================ به‌روزرسانی ======== */

test('به‌روزرسانی، updated_at را جلو می‌برد — چون هیچ trigger ای نیست', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));

  /* عقب بردن عمدی، تا سنجش قطعی باشد و به سرعت اجرا وابسته نباشد. */
  await db.query(`UPDATE products SET updated_at = now() - interval '1 day' WHERE id = $1`, [id]);
  const before = (await rowOf(id)).updated_at;

  await products.update(id, productData(catId, { name: 'لنت ترمز عقب' }));
  const after = (await rowOf(id)).updated_at;

  assert.ok(new Date(after) > new Date(before), 'updated_at باید جلو رفته باشد');
  const ageMs = Date.now() - new Date(after).getTime();
  assert.ok(ageMs < 60_000, `updated_at باید همین حالا باشد، نه ${ageMs} میلی‌ثانیه پیش`);
});

test('به‌روزرسانی، متن جست‌وجو را از نو می‌سازد', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));
  assert.ok((await rowOf(id)).search_text.includes('لنت'));

  await products.update(id, productData(catId, { name: 'فیلتر روغن', sku: 'OIL-9' }));
  const row = await rowOf(id);
  assert.ok(row.search_text.includes('فیلتر روغن'), 'نام تازه باید وارد متن شود');
  assert.ok(!row.search_text.includes('لنت'), 'نام قدیمی باید رفته باشد');
  assert.ok(row.search_text.includes('oil-9'));
});

test('به‌روزرسانی شناسهٔ ناموجود null می‌دهد و چیزی نمی‌شکند', async () => {
  const catId = await insertCategory(db);
  assert.equal(await products.update(999999, productData(catId)), null);
});

/* ================================================ کلید تکراری ======== */

test('نشانی تکراری به خطای فیلد «slug» ترجمه می‌شود', async () => {
  const catId = await insertCategory(db);
  await products.create(productData(catId));

  await assert.rejects(
    () => products.create(productData(catId, { sku: 'BRK-200' })),
    (err) => {
      assert.equal(err.code, 'duplicate');
      assert.equal(err.field, 'slug');
      return true;
    }
  );
});

test('کد کالای تکراری به خطای فیلد «sku» ترجمه می‌شود', async () => {
  const catId = await insertCategory(db);
  await products.create(productData(catId));

  await assert.rejects(
    () => products.create(productData(catId, { slug: 'لنت-ترمز-عقب' })),
    (err) => {
      assert.equal(err.code, 'duplicate');
      assert.equal(err.field, 'sku');
      return true;
    }
  );
});

test('پیام خطای ترجمه‌شده محتوای ردیف را لو نمی‌دهد', async () => {
  /* detail خام PostgreSQL در نقض CHECK کل ردیف را در خود دارد. */
  const catId = await insertCategory(db);
  await assert.rejects(
    () => products.create(productData(catId, { salePriceToman: 250000 })),
    (err) => {
      assert.equal(err.code, 'check_failed');
      assert.ok(!err.message.includes('لنت'), 'پیام نباید محتوای ردیف را داشته باشد');
      assert.ok(!/\d{6}/.test(err.message), 'پیام نباید مبلغ را داشته باشد');
      return true;
    }
  );
});

test('ارجاع به برند ناموجود به fk_missing ترجمه می‌شود', async () => {
  const catId = await insertCategory(db);
  await assert.rejects(
    () => products.create(productData(catId, { brandId: 999999 })),
    (err) => {
      assert.equal(err.code, 'fk_missing');
      assert.equal(err.field, 'brandId');
      return true;
    }
  );
});

/* ==================================================== حذف =========== */

test('حذف محصول، تصویرها و سازگاری خودرو را هم می‌برد', async () => {
  const catId = await insertCategory(db);
  const vehId = await insertVehicle(db);
  const id = await products.create(productData(catId));
  await db.query(
    `INSERT INTO product_images (product_id, image_id, is_primary) VALUES ($1, $2, TRUE)`,
    [id, 'img-test-1']
  );
  await db.query(
    `INSERT INTO product_vehicle (product_id, vehicle_id) VALUES ($1, $2)`, [id, vehId]
  );

  assert.equal(await products.remove(id), true);

  const imgs = await db.query('SELECT COUNT(*)::int AS n FROM product_images');
  const vehs = await db.query('SELECT COUNT(*)::int AS n FROM product_vehicle');
  assert.equal(imgs.rows[0].n, 0, 'تصویرها باید با CASCADE رفته باشند');
  assert.equal(vehs.rows[0].n, 0, 'سازگاری‌ها باید با CASCADE رفته باشند');

  const vehiclesLeft = await db.query('SELECT COUNT(*)::int AS n FROM vehicles');
  assert.equal(vehiclesLeft.rows[0].n, 1, 'خودِ خودرو نباید حذف شود');
});

test('حذف شناسهٔ ناموجود false می‌دهد', async () => {
  assert.equal(await products.remove(999999), false);
});

test('حذف دستهٔ دارای محصول با RESTRICT جلو گرفته می‌شود', async () => {
  const catId = await insertCategory(db);
  await products.create(productData(catId));

  await assert.rejects(
    () => categories.remove(catId),
    (err) => {
      assert.equal(err.code, 'fk_restrict');
      assert.equal(err.constraint, 'products_category_id_fkey');
      return true;
    }
  );

  const still = await db.query('SELECT COUNT(*)::int AS n FROM categories');
  assert.equal(still.rows[0].n, 1, 'دسته باید سر جایش مانده باشد');
});

test('حذف برند دارای محصول با RESTRICT جلو گرفته می‌شود', async () => {
  const catId = await insertCategory(db);
  const brandId = await insertBrand(db);
  await products.create(productData(catId, { brandId }));

  await assert.rejects(
    () => brands.remove(brandId),
    (err) => {
      assert.equal(err.code, 'fk_restrict');
      assert.equal(err.constraint, 'products_brand_id_fkey');
      return true;
    }
  );
});

test('حذف دستهٔ دارای زیردسته با RESTRICT جلو گرفته می‌شود', async () => {
  const parentId = await insertCategory(db, { name: 'والد', slug: 'والد' });
  await categories.create({ name: 'فرزند', slug: 'فرزند', parentId, sortOrder: 1 });

  await assert.rejects(
    () => categories.remove(parentId),
    (err) => {
      assert.equal(err.code, 'fk_restrict');
      assert.equal(err.constraint, 'categories_parent_id_fkey');
      return true;
    }
  );
});

test('حذف برند بدون محصول انجام می‌شود', async () => {
  const brandId = await insertBrand(db);
  assert.equal(await brands.remove(brandId), true);
});

/* ======================================= فعال / غیرفعال ============= */

test('غیرفعال کردن محصول، آن را از فهرست عمومی برمی‌دارد ولی نگه می‌دارد', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));

  assert.equal((await products.list()).total, 1, 'پیش از غیرفعال شدن دیده می‌شود');

  const res = await products.setActive(id, false);
  assert.equal(res.is_active, false);

  assert.equal((await products.list()).total, 0, 'فهرست عمومی نباید غیرفعال را نشان بدهد');
  assert.equal(await products.findBySlug('لنت-ترمز-جلو'), null, 'صفحهٔ عمومی هم نباید بیاید');

  const adminSide = await products.adminList();
  assert.equal(adminSide.total, 1, 'فهرست مدیر باید همچنان نشانش بدهد');
  assert.equal(adminSide.items[0].is_active, false);

  /* و برگشت‌پذیر است — همین فرقش با حذف است. */
  await products.setActive(id, true);
  assert.equal((await products.list()).total, 1, 'دوباره فعال شد و برگشت');
});

test('غیرفعال کردن دسته و برند هم از سمت مدیر دیده می‌شود', async () => {
  const catId = await insertCategory(db);
  const brandId = await insertBrand(db);
  await categories.setActive(catId, false);
  await brands.setActive(brandId, false);

  assert.equal((await categories.listActive()).length, 0, 'فهرست عمومی خالی است');
  assert.equal((await brands.listActive()).length, 0, 'فهرست عمومی خالی است');
  assert.equal((await categories.adminList()).length, 1, 'فهرست مدیر نشان می‌دهد');
  assert.equal((await brands.adminList()).length, 1, 'فهرست مدیر نشان می‌دهد');
});

/* =========================================== موجودی و وضعیت ========= */

test('ویرایش موجودی فقط موجودی و وضعیت را عوض می‌کند', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));
  await db.query(`UPDATE products SET updated_at = now() - interval '1 day' WHERE id = $1`, [id]);

  const res = await products.adjustStock(id, { stockQty: 0, availability: 'out_of_stock' });
  assert.equal(res.stock_qty, 0);
  assert.equal(res.availability, 'out_of_stock');

  const row = await rowOf(id);
  assert.ok(Date.now() - new Date(row.updated_at).getTime() < 60_000, 'updated_at باید تازه شود');
  assert.ok(row.search_text.includes('لنت'), 'متن جست‌وجو نباید دست بخورد');
});

test('وضعیت ناشناخته در ویرایش موجودی نادیده گرفته می‌شود', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));
  const res = await products.adjustStock(id, { stockQty: 2, availability: 'flying' });
  assert.equal(res.availability, 'in_stock', 'مقدار مجازِ قبلی باید بماند');
});

test('موجودی صفر با وضعیت in_stock پذیرفته می‌شود و مسدود نمی‌شود', async () => {
  /* ناسازگاری ظاهری عمدا خطای مسدودکننده نیست: «سفارشی» و «منسوخ»
     واقعا مستقل از موجودی‌اند. هشدارش کار لایهٔ نمایش است. */
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId, { stockQty: 0, availability: 'in_stock' }));
  const found = await products.findById(id);
  assert.equal(found.stock_qty, 0);
  assert.equal(found.availability, 'in_stock');
});

/* ================================= تازه‌سازی متن جست‌وجوی برند ====== */

test('تغییر نام برند، متن جست‌وجوی محصول‌هایش را از نو می‌سازد', async () => {
  /* رگرسیون. search_text نام برند را در خود دارد؛ بدون این تازه‌سازی،
     نام *قدیمی* در ردیف محصول می‌ماند و نتیجه‌اش این است که محصول با
     نام تازه پیدا نمی‌شود و با نام قدیمی هنوز پیدا می‌شود. */
  const catId = await insertCategory(db);
  const brandId = await insertBrand(db, { name: 'والئو', slug: 'والئو' });
  const id = await products.create(productData(catId, { brandId }));

  /* ۱. نام قدیمی در متن جست‌وجو هست. */
  assert.ok((await rowOf(id)).search_text.includes('والئو'),
    'در آغاز باید نام برند در متن جست‌وجو باشد');

  /* ۲. نام برند عوض می‌شود. */
  await brands.update(brandId, { name: 'بوش', slug: 'والئو' });
  const refreshed = await products.refreshSearchTextForBrand(brandId);
  assert.equal(refreshed, 1, 'یک محصول باید تازه شده باشد');

  /* ۳. نام قدیمی رفته و نام تازه آمده. */
  const text = (await rowOf(id)).search_text;
  assert.ok(!text.includes('والئو'), 'نام قدیمی نباید بماند');
  assert.ok(text.includes('بوش'), 'نام تازه باید آمده باشد');

  assert.equal((await products.search({ term: 'بوش' })).total, 1, 'با نام تازه پیدا می‌شود');
  assert.equal((await products.search({ term: 'والئو' })).total, 0, 'با نام قدیمی دیگر نه');
});

test('تازه‌سازی برند، محصول برندهای دیگر را دست نمی‌زند', async () => {
  const catId = await insertCategory(db);
  const a = await insertBrand(db, { name: 'والئو', slug: 'والئو' });
  const b = await insertBrand(db, { name: 'بوش', slug: 'بوش' });
  await products.create(productData(catId, { brandId: a }));
  const other = await products.create(productData(catId, {
    brandId: b, slug: 'قطعه-دیگر', sku: 'BRK-200',
  }));

  await brands.update(a, { name: 'سَکس', slug: 'والئو' });
  await products.refreshSearchTextForBrand(a);

  assert.ok((await rowOf(other)).search_text.includes('بوش'),
    'محصول برند دیگر نباید عوض شود');
});

test('تازه‌سازی برندِ بی‌محصول بی‌خطر است', async () => {
  const brandId = await insertBrand(db);
  assert.equal(await products.refreshSearchTextForBrand(brandId), 0);
  assert.equal(await products.refreshSearchTextForBrand(null), 0);
});

/* =============================================== حلقهٔ دسته ========= */

test('حلقهٔ الف ← ب ← الف پیش از رسیدن به SQL رد می‌شود', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  const b = await categories.create({ name: 'ب', slug: 'ب', parentId: a });

  assert.equal(await categories.wouldCreateCycle(a, b), true,
    'والد کردن ب برای الف یک حلقه می‌سازد');
  assert.equal(await categories.wouldCreateCycle(b, a), false,
    'همین رابطه در جهت درست مشکلی ندارد');
});

test('حلقهٔ سه‌حلقه‌ای هم گرفته می‌شود', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  const b = await categories.create({ name: 'ب', slug: 'ب', parentId: a });
  const c = await categories.create({ name: 'ج', slug: 'ج', parentId: b });
  assert.equal(await categories.wouldCreateCycle(a, c), true);
});

test('والد کردنِ خودِ دسته رد می‌شود', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  assert.equal(await categories.wouldCreateCycle(a, a), true);
});

test('دستهٔ بدون والد حلقه نمی‌سازد', async () => {
  const a = await categories.create({ name: 'الف', slug: 'الف' });
  assert.equal(await categories.wouldCreateCycle(a, null), false);
});

/* ============================================== فهرست مدیر ========= */

test('فهرست مدیر با کد کالا و شمارهٔ فنی فیلتر می‌شود', async () => {
  const catId = await insertCategory(db);
  await products.create(productData(catId));
  await products.create(productData(catId, {
    name: 'فیلتر روغن', slug: 'فیلتر-روغن', sku: 'OIL-9', oemNumber: '1109-AY',
  }));

  assert.equal((await products.adminList({ filters: { term: 'OIL-9' } })).total, 1);
  assert.equal((await products.adminList({ filters: { term: '1109 AY' } })).total, 1);
  assert.equal((await products.adminList({ filters: { term: 'فیلتر' } })).total, 1);
  assert.equal((await products.adminList()).total, 2, 'بدون فیلتر همه می‌آیند');
});

test('فهرست مدیر با وضعیت فعال بودن فیلتر می‌شود', async () => {
  const catId = await insertCategory(db);
  const id = await products.create(productData(catId));
  await products.create(productData(catId, {
    name: 'فیلتر روغن', slug: 'فیلتر-روغن', sku: 'OIL-9',
  }));
  await products.setActive(id, false);

  assert.equal((await products.adminList({ filters: { isActive: false } })).total, 1);
  assert.equal((await products.adminList({ filters: { isActive: true } })).total, 1);
  assert.equal((await products.adminList()).total, 2);
});

test('فهرست مدیر، دستهٔ غیرفعال و محصول‌هایش را پنهان نمی‌کند', async () => {
  /* فهرست عمومی محصولِ دسته‌ی غیرفعال را حذف می‌کند؛ مدیر باید ببیندش
     وگرنه راهی برای اصلاحش ندارد. */
  const catId = await insertCategory(db);
  await products.create(productData(catId));
  await categories.setActive(catId, false);

  assert.equal((await products.list()).total, 0, 'سمت عمومی پنهان است');
  assert.equal((await products.adminList()).total, 1, 'سمت مدیر دیده می‌شود');
});
