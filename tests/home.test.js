/* ============================================================================
 * tests/home.test.js — صفحهٔ اصلی فروشگاه (فاز ۴)
 * ----------------------------------------------------------------------------
 * برنامهٔ واقعی Express با مخزن‌های متصل به PGlite بالا می‌آید — همان
 * الگوی تزریق فازهای قبل. هیچ پایگاه دادهٔ بیرونی‌ای لازم نیست.
 *
 * تمرکز این فایل روی قولی است که فاز ۴ می‌دهد:
 *   * صفحهٔ اصلی دیگر جای‌نگهدارِ فنی نیست.
 *   * هر بخش فقط با دادهٔ واقعی رندر می‌شود؛ هیچ محصول ساختگی‌ای نیست.
 *   * با کاتالوگ خالی، صفحه همچنان کامل است و صادقانه حرف می‌زند.
 *   * هیچ پیوندی به قابلیتی که وجود ندارد گذاشته نشده است.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* NODE_ENV پیش از بار شدن config — ببینید توضیح در admin-routes.test.js. */
process.env.NODE_ENV = 'test';

const { createTestDb, insertCategory, insertBrand, insertProduct } =
  await import('./helpers/testDb.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createCategoryRepository } = await import('../src/db/repositories/categories.js');
const { createBrandRepository } = await import('../src/db/repositories/brands.js');

let db, server, BASE;

before(async () => {
  db = await createTestDb();
  const { createApp } = await import('../src/app.js');
  const app = createApp({
    repositories: {
      products: createProductRepository(db),
      categories: createCategoryRepository(db),
      brands: createBrandRepository(db),
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

const home = () => fetch(`${BASE}/`);
const homeHtml = async () => (await home()).text();

/* ═══════════════════════════════════════════ ۱. پوسته و زبان */

test('صفحهٔ اصلی ۲۰۰ و HTML فارسی راست‌به‌چپ می‌دهد', async () => {
  const res = await home();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta charset="UTF-8"/i);
});

test('صفحهٔ اصلی دقیقا یک h1 دارد', async () => {
  const html = await homeHtml();
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'یک عنوان اصلی، نه بیشتر و نه کمتر');
});

test('جای‌نگهدارِ فاز ۰ دیگر نیست', async () => {
  const html = await homeHtml();
  assert.ok(!html.includes('فاز ۰'));
  assert.ok(!html.includes('این صفحه فقط برای تأیید پایه فنی است'));
  assert.ok(!html.includes('نمونه قیمت'), 'ردیف‌های نمونهٔ فنی باید رفته باشند');
});

test('هدر، جست‌وجو و فوتر روی صفحهٔ اصلی هستند', async () => {
  const html = await homeHtml();
  assert.match(html, /class="site-header"/);
  assert.match(html, /action="\/search"/);
  assert.match(html, /class="site-footer"/);
});

test('عنوان صفحه و توضیح متا برای فروشگاه تنظیم شده‌اند', async () => {
  const html = await homeHtml();
  assert.match(html, /<title>قطعات یدکی پژو ۲۰۰۸ \| پارس ۲۰۰۸<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*پژو ۲۰۰۸[^"]*"/);
});

/* ═══════════════════════════════════════════ ۲. کاتالوگ خالی */

test('با کاتالوگ خالی، صفحه کامل است و صادقانه می‌گوید محصولی نیست', async () => {
  const res = await home();
  assert.equal(res.status, 200, 'کاتالوگ خالی نباید خطا بدهد');
  const html = await res.text();
  assert.match(html, /هنوز محصولی ثبت نشده است/);
  /* پوستهٔ فروشگاه باید همچنان کامل باشد. */
  assert.match(html, /class="site-header"/);
  assert.match(html, /class="site-footer"/);
  assert.match(html, /class="hero"/);
});

test('با کاتالوگ خالی هیچ کارت محصولی رندر نمی‌شود', async () => {
  const html = await homeHtml();
  assert.ok(!html.includes('class="product-card"'), 'هیچ محصول ساختگی نباید ساخته شود');
  /* «تومان» در متن توضیحیِ صفحه هست؛ آنچه نباید باشد، *عنصر قیمت* است. */
  assert.ok(!html.includes('class="price__now'), 'قیمتی وجود ندارد که نمایش داده شود');
});

test('بدون دسته و برند، بخش‌هایشان اصلا رندر نمی‌شوند', async () => {
  const html = await homeHtml();
  assert.ok(!html.includes('class="category-grid"'));
  assert.ok(!html.includes('class="brand-strip"'));
});

/* ═════════════════════════════════════ ۳. دسته‌ها و برندها */

test('دسته‌ها با تعداد محصول و پیوند درست نمایش داده می‌شوند', async () => {
  const catId = await insertCategory(db, { name: 'لوازم ترمز', slug: 'لوازم-ترمز' });
  await insertProduct(db, { categoryId: catId, name: 'لنت جلو', slug: 'لنت-جلو', sku: 'S1' });

  const html = await homeHtml();
  assert.match(html, /class="category-grid"/);
  assert.match(html, /لوازم ترمز/);
  assert.match(html, new RegExp(`href="/category/${encodeURIComponent('لوازم-ترمز')}"`));
  assert.match(html, /class="category-card__count num">۱</, 'شمارش با رقم فارسی');
});

test('برندها به‌صورت نوار نمایش داده می‌شوند', async () => {
  await insertBrand(db, { name: 'برند آزمون', slug: 'برند-آزمون' });
  const html = await homeHtml();
  assert.match(html, /class="brand-strip"/);
  assert.match(html, /برند آزمون/);
  assert.match(html, new RegExp(`href="/brand/${encodeURIComponent('برند-آزمون')}"`));
});

/* ═══════════════════════════════════════════════ ۴. قفسه‌ها */

test('محصول ویژه در قفسهٔ «ویژه» با قیمت فارسی می‌آید', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'فیلتر روغن موتور', slug: 'فیلتر-روغن',
    sku: 'S1', priceToman: 12500000, isFeatured: true,
  });

  const html = await homeHtml();
  assert.match(html, /محصولات ویژه/);
  assert.match(html, /فیلتر روغن موتور/);
  assert.ok(html.includes('۱۲٬۵۰۰٬۰۰۰ تومان'), 'قیمت با رقم فارسی و واحد تومان');
  assert.ok(!html.includes('12,500,000'), 'رقم انگلیسی خام نباید بیاید');
});

test('محصول تازه در قفسهٔ «تازه» می‌آید', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'شمع موتور', slug: 'شمع-موتور', sku: 'S2', isNew: true,
  });

  const html = await homeHtml();
  assert.match(html, /تازه به کاتالوگ اضافه شد/);
  assert.match(html, /شمع موتور/);
});

test('بدون پرچم ویژه/تازه، قفسهٔ «تازه‌ترین» جای آن‌ها را می‌گیرد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, name: 'واشر درب سوپاپ', slug: 'واشر', sku: 'S3' });

  const html = await homeHtml();
  assert.match(html, /تازه‌ترین محصول‌ها/);
  assert.match(html, /واشر درب سوپاپ/);
  assert.ok(!html.includes('محصولات ویژه'), 'قفسهٔ خالی نباید رندر شود');
});

test('وقتی محصول ویژه هست، همان محصول در قفسهٔ «تازه‌ترین» تکرار نمی‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'دیسک ترمز', slug: 'دیسک-ترمز', sku: 'S4',
    isFeatured: true, isNew: true,
  });

  const html = await homeHtml();
  assert.ok(!html.includes('تازه‌ترین محصول‌ها'), 'قفسهٔ سوم نباید تکرار شود');
  assert.equal((html.match(/دیسک ترمز/g) || []).length, 2,
    'یک بار در قفسهٔ ویژه و یک بار در قفسهٔ تازه — نه بیشتر');
});

test('محصول غیرفعال در صفحهٔ اصلی دیده نمی‌شود', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: 'قطعهٔ بازنشسته', slug: 'retired', sku: 'S5',
    isFeatured: true, isActive: false,
  });

  const html = await homeHtml();
  assert.ok(!html.includes('قطعهٔ بازنشسته'));
  assert.match(html, /هنوز محصولی ثبت نشده است/, 'از دید مشتری کاتالوگ خالی است');
});

test('نام محصول در صفحهٔ اصلی فرار داده می‌شود (XSS)', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, {
    categoryId: catId, name: '<script>alert(1)</script>', slug: 'xss-home',
    sku: 'S6', isFeatured: true,
  });

  const html = await homeHtml();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'تگ خام نباید در خروجی باشد');
  assert.match(html, /&lt;script&gt;/);
});

/* ═════════════════════════════ ۵. هیچ پیوند مرده‌ای نیست */

test('صفحهٔ اصلی به سبد خرید، تسویه یا حساب کاربری پیوند نمی‌دهد', async () => {
  const catId = await insertCategory(db);
  await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1' });

  const html = await homeHtml();
  for (const dead of ['/cart', '/checkout', '/login', '/account', '/register', '/orders']) {
    assert.ok(!html.includes(`href="${dead}`), `پیوند ${dead} نباید وجود داشته باشد`);
  }
  assert.ok(!html.includes('افزودن به سبد'), 'دکمهٔ سبد خرید هنوز نباید باشد');
});

test('همهٔ پیوندهای صفحهٔ اصلی به مسیرهای واقعا موجود می‌روند', async () => {
  const catId = await insertCategory(db, { name: 'دستهٔ الف', slug: 'دسته-الف' });
  await insertBrand(db, { name: 'برند الف', slug: 'برند-الف' });
  await insertProduct(db, { categoryId: catId, slug: 'p1', sku: 'S1', isFeatured: true });

  const html = await homeHtml();
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 5, 'صفحه باید پیوند داشته باشد');

  const known = [
    /^#[\w-]+$/,                    // پیوند درون‌صفحه‌ای
    /^\/$/,
    /^\/products(\?|$)/,
    /^\/search(\?|$)/,
    /^\/category\//,
    /^\/brand\//,
    /^\/product\//,
    /^\/css\//,                     // شیوه‌نامه
    /^\/img\//,                     // نشان برند و favicon
  ];
  for (const href of hrefs) {
    assert.ok(known.some((re) => re.test(href)), `پیوند ناشناخته: ${href}`);
  }
});
