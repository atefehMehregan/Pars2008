/* ============================================================================
 * tests/admin-product-images.test.js — مسیرهای مدیریت تصویر (فاز ۵)
 * ----------------------------------------------------------------------------
 * برنامهٔ واقعی Express با PGlite و یک پوشهٔ ذخیره‌سازیِ موقت بالا می‌آید،
 * پس آپلود، پردازش sharp، نوشتن فایل، مرز اجازهٔ دسترسی و CSRF همگی روی
 * مسیر واقعی HTTP آزموده می‌شوند.
 *
 * STORAGE_ROOT پیش از بار شدن config تنظیم می‌شود تا هم لایهٔ ذخیره‌سازی
 * و هم mount استاتیکِ /media/products به همان پوشهٔ موقت اشاره کنند.
 * پوشهٔ storage واقعی پروژه هرگز لمس نمی‌شود.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
const STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pars-images-'));
process.env.STORAGE_ROOT = STORAGE_ROOT;

const sharp = (await import('sharp')).default;
const { createTestDb, insertCategory, insertProduct } = await import('./helpers/testDb.js');
const { createProductRepository } = await import('../src/db/repositories/products.js');
const { createCategoryRepository } = await import('../src/db/repositories/categories.js');
const { createBrandRepository } = await import('../src/db/repositories/brands.js');
const { createProductImageRepository } = await import('../src/db/repositories/productImages.js');
const { hashPassword } = await import('../src/services/password.js');
const { config } = await import('../src/config/index.js');

const EMAIL = 'images@example.test';
const PASSWORD = 'correct-horse-9-battery';

let db, server, BASE, repo, productId, adminUsers;

/* ------------------------------------------------------------ کمکی‌ها */

const jpeg = (w = 900, h = 700) => sharp({
  create: { width: w, height: h, channels: 3, background: { r: 140, g: 150, b: 160 } },
}).jpeg().toBuffer();

const png = (w = 900, h = 700) => sharp({
  create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } },
}).png().toBuffer();

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

/** توکن CSRFِ گره‌خورده به نشست را از صفحهٔ مدیریت تصویر برمی‌دارد. */
async function adminCsrf(jar, id) {
  const html = await (await fetch(`${BASE}/admin/catalogue/products/${id}/images`, {
    headers: { Cookie: cookieHeader(jar) },
  })).text();
  return (html.match(/name="_csrf" value="([^"]*)"/) || [])[1] || '';
}

/** آپلود، دقیقا با همان ترتیبی که قالب می‌فرستد: _csrf پیش از فایل. */
async function upload(jar, id, files, { csrf } = {}) {
  const token = csrf !== undefined ? csrf : await adminCsrf(jar, id);
  const fd = new FormData();
  fd.append('_csrf', token);
  for (const f of files) {
    fd.append(f.field || 'images', new Blob([f.buffer], { type: f.type || 'image/jpeg' }),
      f.name || 'photo.jpg');
  }
  return fetch(`${BASE}/admin/catalogue/products/${id}/images`, {
    method: 'POST', body: fd, headers: { Cookie: cookieHeader(jar) }, redirect: 'manual',
  });
}

const post = (jar, url, body) => fetch(`${BASE}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
  body: new URLSearchParams(body),
  redirect: 'manual',
});

const imageDir = (imageId) => path.join(STORAGE_ROOT, 'products', imageId);
const listOriginals = () => fsp.readdir(path.join(STORAGE_ROOT, 'originals')).catch(() => []);

/* --------------------------------------------------------- راه‌اندازی */

before(async () => {
  db = await createTestDb();
  repo = createProductImageRepository(db);
  const { createAdminUserRepository } = await import('../src/db/repositories/adminUsers.js');
  adminUsers = createAdminUserRepository(db);

  const { createApp } = await import('../src/app.js');
  const app = createApp({
    db,
    repositories: {
      products: createProductRepository(db),
      categories: createCategoryRepository(db),
      brands: createBrandRepository(db),
      productImages: repo,
    },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
  await fsp.rm(STORAGE_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.exec(`TRUNCATE product_images, products, categories, admin_audit_log,
                 admin_sessions, login_attempts, admin_users RESTART IDENTITY CASCADE`);
  await adminUsers.create({ email: EMAIL, passwordHash: await hashPassword(PASSWORD) });
  const catId = await insertCategory(db);
  productId = await insertProduct(db, { categoryId: catId, slug: 'p-1', sku: 'S1' });
  await fsp.rm(STORAGE_ROOT, { recursive: true, force: true });
  await fsp.mkdir(path.join(STORAGE_ROOT, 'products'), { recursive: true });
  await fsp.mkdir(path.join(STORAGE_ROOT, 'originals'), { recursive: true });
});

/* ═══════════════════════════════ ۱. مرز اجازهٔ دسترسی */

test('GET بدون ورود به صفحهٔ ورود هدایت می‌شود', async () => {
  const res = await fetch(`${BASE}/admin/catalogue/products/${productId}/images`,
    { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('آپلود بدون ورود با ۴۰۱ رد می‌شود و هیچ فایلی نوشته نمی‌شود', async () => {
  const fd = new FormData();
  fd.append('_csrf', 'anything');
  fd.append('images', new Blob([await jpeg()], { type: 'image/jpeg' }), 'x.jpg');

  const res = await fetch(`${BASE}/admin/catalogue/products/${productId}/images`,
    { method: 'POST', body: fd, redirect: 'manual' });

  assert.equal(res.status, 401, 'غیر-GET بدون نشست باید ۴۰۱ بدهد، نه هدایت');
  assert.equal(await repo.countForProduct(productId), 0);
  assert.deepEqual(await listOriginals(), [], 'هیچ اصلی نباید نوشته شده باشد');
});

test('همهٔ مسیرهای نوشتنِ تصویر بدون نشست ۴۰۱ می‌دهند', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const url of [
    `/admin/catalogue/products/${productId}/images/reorder`,
    `/admin/catalogue/products/${productId}/images/${id}/primary`,
    `/admin/catalogue/products/${productId}/images/${id}/alt`,
    `/admin/catalogue/products/${productId}/images/${id}/delete`,
  ]) {
    const res = await post({}, url, { _csrf: 'x' });
    assert.equal(res.status, 401, url);
  }
});

test('صفحهٔ مدیریت تصویر کش و نمایه نمی‌شود', async () => {
  const jar = await login();
  const res = await fetch(`${BASE}/admin/catalogue/products/${productId}/images`,
    { headers: { Cookie: cookieHeader(jar) } });
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});

/* ═════════════════════════════════════════════ ۲. CSRF */

test('آپلود بدون توکن CSRF با ۴۰۳ رد می‌شود', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{ buffer: await jpeg() }], { csrf: '' });
  assert.equal(res.status, 403);
  assert.equal(await repo.countForProduct(productId), 0);
  assert.deepEqual(await listOriginals(), [], 'بایت‌ها نباید ماندگار شده باشند');
});

test('آپلود با توکن CSRF غلط رد می‌شود', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{ buffer: await jpeg() }], { csrf: 'wrong-token' });
  assert.equal(res.status, 403);
  assert.equal(await repo.countForProduct(productId), 0);
});

test('توکن CSRF عمومیِ صفحهٔ ورود برای آپلود پذیرفته نمی‌شود', async () => {
  const page = await fetch(`${BASE}/admin/login`);
  const publicToken = ((await page.text()).match(/name="_csrf" value="([^"]*)"/) || [])[1];
  const jar = await login();

  const res = await upload(jar, productId, [{ buffer: await jpeg() }], { csrf: publicToken });
  assert.equal(res.status, 403, 'فقط توکن گره‌خورده به همین نشست پذیرفته می‌شود');
});

test('حذف تصویر بدون CSRF رد می‌شود و ردیف می‌ماند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);

  const res = await post(jar,
    `/admin/catalogue/products/${productId}/images/${img.image_id}/delete`, { _csrf: 'nope' });
  assert.equal(res.status, 403);
  assert.equal(await repo.countForProduct(productId), 1, 'ردیف نباید رفته باشد');
});

/* ══════════════════════════════════ ۳. آپلود موفق */

test('آپلود درست: هشت مشتق، اصلِ خصوصی، و ردیف پایگاه داده', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{ buffer: await jpeg(1200, 900) }]);
  assert.equal(res.status, 303);

  const rows = await repo.listForProduct(productId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].width, 1200);
  assert.equal(rows[0].height, 900);

  const files = (await fsp.readdir(imageDir(rows[0].image_id))).sort();
  assert.deepEqual(files, [
    'card.jpg', 'card.webp', 'detail.jpg', 'detail.webp',
    'thumb.jpg', 'thumb.webp', 'zoom.jpg', 'zoom.webp',
  ], 'چهار اندازه × دو قالب — همان چیزی که config تعریف کرده');

  const originals = await listOriginals();
  assert.equal(originals.length, 1, 'اصل نگه داشته می‌شود');
  assert.ok(originals[0].startsWith(rows[0].image_id));
});

test('مشتق‌ها مربع و در اندازهٔ اعلام‌شده‌اند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(1200, 400) }]);
  const [img] = await repo.listForProduct(productId);

  for (const [name, size] of [['thumb', 160], ['card', 400], ['detail', 800], ['zoom', 1600]]) {
    const meta = await sharp(path.join(imageDir(img.image_id), `${name}.webp`)).metadata();
    assert.equal(meta.width, size, `${name} عرض`);
    assert.equal(meta.height, size, `${name} ارتفاع — بوم مربع، حتی برای ورودی کشیده`);
  }
});

test('فراداده EXIF از مشتق‌ها حذف می‌شود', async () => {
  const jar = await login();
  const withExif = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#888' } })
    .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-OWNER', Artist: 'SECRET-ARTIST' } } })
    .jpeg().toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, 'ورودی باید واقعا EXIF داشته باشد');

  await upload(jar, productId, [{ buffer: withExif }]);
  const [img] = await repo.listForProduct(productId);
  const meta = await sharp(path.join(imageDir(img.image_id), 'detail.jpg')).metadata();
  assert.equal(meta.exif, undefined, 'EXIF نباید در خروجی بماند');
});

test('PNG و WebP هم پذیرفته می‌شوند', async () => {
  const jar = await login();
  const webp = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#555' } })
    .webp().toBuffer();
  const res = await upload(jar, productId, [
    { buffer: await png(), type: 'image/png', name: 'a.png' },
    { buffer: webp, type: 'image/webp', name: 'b.webp' },
  ]);
  assert.equal(res.status, 303);
  assert.equal(await repo.countForProduct(productId), 2);
});

test('چند فایل در یک درخواست ذخیره می‌شوند', async () => {
  const jar = await login();
  await upload(jar, productId, [
    { buffer: await jpeg(800, 800) }, { buffer: await jpeg(900, 600) }, { buffer: await png() },
  ]);
  assert.equal(await repo.countForProduct(productId), 3);
});

/* ═══════════════════════════ ۴. اعتبارسنجی ورودی */

test('فایل غیر-تصویری با نام jpg رد می‌شود (بایت‌های ابتدایی، نه پسوند)', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{
    buffer: Buffer.from('#!/bin/sh\necho definitely not an image\n'.repeat(20)),
    type: 'image/jpeg', name: 'evil.jpg',
  }]);

  assert.equal(res.status, 422);
  assert.match(await res.text(), /فقط تصویر JPEG، PNG یا WebP/);
  assert.equal(await repo.countForProduct(productId), 0);
  assert.deepEqual(await listOriginals(), []);
});

test('SVG پذیرفته نمی‌شود — در فهرست سفید نیست', async () => {
  const jar = await login();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="500" height="500"/></svg>');
  const res = await upload(jar, productId, [{ buffer: svg, type: 'image/svg+xml', name: 'a.svg' }]);
  assert.equal(res.status, 422);
  assert.equal(await repo.countForProduct(productId), 0);
});

test('تصویر کوچک‌تر از کمینهٔ ابعاد رد می‌شود', async () => {
  const jar = await login();
  const small = await jpeg(300, 200);   // ضلع بزرگ‌تر ۳۰۰ < ۴۰۰
  const res = await upload(jar, productId, [{ buffer: small }]);

  assert.equal(res.status, 422);
  assert.match(await res.text(), new RegExp(`${config.uploads.minImageDimension}`));
  assert.equal(await repo.countForProduct(productId), 0);
});

test('تصویر دقیقا در کمینهٔ ابعاد پذیرفته می‌شود', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{ buffer: await jpeg(config.uploads.minImageDimension, 100) }]);
  assert.equal(res.status, 303);
  assert.equal(await repo.countForProduct(productId), 1);
});

test('فایل بزرگ‌تر از سقف حجم رد می‌شود و ردیفی ساخته نمی‌شود', async () => {
  const jar = await login();
  /* نویزِ تصادفی تا فشرده نشود و واقعا از سقف رد شود. */
  const big = Buffer.alloc(config.uploads.maxImageBytes + 200 * 1024);
  for (let i = 0; i < big.length; i += 1) big[i] = (i * 2654435761) & 0xff;
  big.set(Buffer.from([0xff, 0xd8, 0xff]), 0);      // تا از نگاه اول JPEG به نظر برسد

  const res = await upload(jar, productId, [{ buffer: big }]);
  assert.equal(res.status, 413, 'Multer باید پیش از پردازش قطع کند');
  assert.equal(await repo.countForProduct(productId), 0);
  assert.deepEqual(await listOriginals(), []);
});

test('فیلد فایلِ ناشناخته رد می‌شود', async () => {
  const jar = await login();
  const res = await upload(jar, productId, [{ buffer: await jpeg(), field: 'avatar' }]);
  assert.equal(res.status, 400);
  assert.equal(await repo.countForProduct(productId), 0);
});

test('درخواست بدون فایل، پیام روشن می‌دهد نه خطا', async () => {
  const jar = await login();
  const res = await upload(jar, productId, []);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /error=none/);
});

test('سقف تعداد تصویر هر محصول رعایت می‌شود', async () => {
  const jar = await login();
  const max = config.uploads.maxImagesPerProduct;
  const batch = [];
  for (let i = 0; i < max; i += 1) batch.push({ buffer: await jpeg(500 + i, 500) });
  await upload(jar, productId, batch);
  assert.equal(await repo.countForProduct(productId), max);

  const res = await upload(jar, productId, [{ buffer: await jpeg() }]);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /error=full/);
  assert.equal(await repo.countForProduct(productId), max, 'از سقف رد نمی‌شود');
});

/* ══════════════════════════════ ۵. تصویر اصلی */

test('اولین تصویر خودبه‌خود اصلی می‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);
  assert.equal(img.is_primary, true);
});

test('تصویر دوم اصلی نمی‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(800, 800) }]);
  await upload(jar, productId, [{ buffer: await jpeg(900, 900) }]);
  const rows = await repo.listForProduct(productId);
  assert.equal(rows.filter((r) => r.is_primary).length, 1);
});

test('تغییر تصویر اصلی از راه مسیر، دقیقا یکی را اصلی نگه می‌دارد', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(800, 800) }, { buffer: await jpeg(810, 800) }]);
  const rows = await repo.listForProduct(productId);
  const target = rows.find((r) => !r.is_primary);

  const res = await post(jar,
    `/admin/catalogue/products/${productId}/images/${target.image_id}/primary`,
    { _csrf: await adminCsrf(jar, productId) });
  assert.equal(res.status, 303);

  const after = await repo.listForProduct(productId);
  assert.equal(after.filter((r) => r.is_primary).length, 1);
  assert.equal(after.find((r) => r.is_primary).image_id, target.image_id);
});

/* آزمون بازگشتی در سطح HTTP برای همان باگی که در مرورگر دیده شد:
   «اصلی کردن» بار اول کار می‌کرد و بار دوم صفحهٔ ۵۰۰ می‌داد. */
test('اصلی کردنِ پیاپی از راه مسیر، بار دوم و سوم هم ۵۰۰ نمی‌دهد', async () => {
  const jar = await login();
  await upload(jar, productId, [
    { buffer: await jpeg(800, 800) }, { buffer: await jpeg(810, 800) }, { buffer: await jpeg(820, 800) },
  ]);
  const ids = (await repo.listForProduct(productId))
    .slice().sort((a, b) => a.sort_order - b.sort_order).map((r) => r.image_id);
  assert.equal(ids.length, 3);

  const csrf = await adminCsrf(jar, productId);
  /* دور کامل: دومی، سومی، برگشت به اولی، و باز دومی. */
  for (const [step, target] of [ids[1], ids[2], ids[0], ids[1]].entries()) {
    const res = await post(jar,
      `/admin/catalogue/products/${productId}/images/${target}/primary`, { _csrf: csrf });

    assert.equal(res.status, 303, `گام ${step + 1}: نباید ۵۰۰ بدهد`);
    assert.match(res.headers.get('location'), /flash=primary/, `گام ${step + 1}`);

    const rows = await repo.listForProduct(productId);
    const primary = rows.filter((r) => r.is_primary);
    assert.equal(primary.length, 1, `گام ${step + 1}: دقیقا یک تصویر اصلی`);
    assert.equal(primary[0].image_id, target, `گام ${step + 1}: همان تصویر خواسته‌شده`);
    assert.equal(rows.length, 3, `گام ${step + 1}: هیچ تصویری گم نشود`);
  }
});

test('حذف تصویر اصلی، کم‌ترین sort_order را جانشین می‌کند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(800, 800) }, { buffer: await jpeg(810, 800) }]);
  const rows = await repo.listForProduct(productId);
  const primary = rows.find((r) => r.is_primary);
  const survivor = rows.find((r) => !r.is_primary);

  await post(jar, `/admin/catalogue/products/${productId}/images/${primary.image_id}/delete`,
    { _csrf: await adminCsrf(jar, productId) });

  const after = await repo.listForProduct(productId);
  assert.equal(after.length, 1);
  assert.equal(after[0].image_id, survivor.image_id);
  assert.equal(after[0].is_primary, true, 'جانشین باید اصلی شده باشد');
});

/* ══════════════════════ ۶. حذف و نظافت فایل */

test('حذف تصویر، ردیف و همهٔ فایل‌هایش را می‌برد', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);
  assert.ok(fs.existsSync(imageDir(img.image_id)));

  const res = await post(jar,
    `/admin/catalogue/products/${productId}/images/${img.image_id}/delete`,
    { _csrf: await adminCsrf(jar, productId) });

  assert.equal(res.status, 303);
  assert.equal(await repo.countForProduct(productId), 0);
  assert.equal(fs.existsSync(imageDir(img.image_id)), false, 'مشتق‌ها باید رفته باشند');
  assert.deepEqual(await listOriginals(), [], 'اصل هم باید رفته باشد');
});

test('حذف محصول، ردیف‌ها *و* فایل‌های تصویرش را می‌برد', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(800, 800) }, { buffer: await jpeg(810, 800) }]);
  const ids = (await repo.listForProduct(productId)).map((r) => r.image_id);
  assert.equal(ids.length, 2);
  for (const id of ids) assert.ok(fs.existsSync(imageDir(id)));

  const res = await post(jar, `/admin/catalogue/products/${productId}/delete`,
    { _csrf: await adminCsrf(jar, productId), confirm: 'yes' });
  assert.equal(res.status, 303);

  assert.equal(await repo.countForProduct(productId), 0, 'CASCADE ردیف‌ها را برده');
  for (const id of ids) {
    assert.equal(fs.existsSync(imageDir(id)), false, `فایل یتیم نماند: ${id}`);
  }
  assert.deepEqual(await listOriginals(), [], 'هیچ اصلی نباید بماند');
});

test('حذفِ ناتمامِ محصول (بدون تأیید) هیچ فایلی را پاک نمی‌کند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);

  const res = await post(jar, `/admin/catalogue/products/${productId}/delete`,
    { _csrf: await adminCsrf(jar, productId) });     // بدون confirm

  assert.equal(res.status, 422);
  assert.equal(await repo.countForProduct(productId), 1, 'ردیف باید مانده باشد');
  assert.ok(fs.existsSync(imageDir(img.image_id)), 'فایل هم باید مانده باشد');
});

test('حذف تصویرِ ناموجود بی‌خطر است', async () => {
  const jar = await login();
  const res = await post(jar,
    `/admin/catalogue/products/${productId}/images/99999999-9999-4999-8999-999999999999/delete`,
    { _csrf: await adminCsrf(jar, productId) });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /error=not_found/);
});

/* ════════════════════ ۷. شناسه و مسیرِ امن */

test('شناسهٔ تصویرِ بدشکل به مسیر فایل تبدیل نمی‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const csrf = await adminCsrf(jar, productId);

  for (const bad of ['../../etc/passwd', 'not-a-uuid', '%2e%2e', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee!']) {
    const res = await post(jar,
      `/admin/catalogue/products/${productId}/images/${encodeURIComponent(bad)}/delete`,
      { _csrf: csrf });
    assert.equal(res.status, 303, bad);
    assert.match(res.headers.get('location'), /error=not_found/, bad);
  }

  assert.equal(await repo.countForProduct(productId), 1, 'هیچ‌کدام نباید چیزی حذف کرده باشد');
});

test('«..» در مسیر، پیش از مسیریابی نرمال می‌شود و به مسیر دیگری می‌رسد', async () => {
  /* رفتار واقعی را ثبت می‌کنیم، نه آنچه حدس می‌زدیم:
     «/products/:id/images/../delete» توسط خودِ لایهٔ HTTP به
     «/products/:id/delete» نرمال می‌شود، پس هرگز به نگهبان imageId
     نمی‌رسد. آن مسیر هم نگهبان خودش را دارد — بدون کادر تأیید چیزی
     حذف نمی‌کند. یعنی هیچ راهی برای بالا رفتن از پوشه باز نمی‌ماند. */
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);

  const res = await post(jar, `/admin/catalogue/products/${productId}/images/../delete`,
    { _csrf: await adminCsrf(jar, productId) });

  assert.equal(res.status, 422, 'به مسیر حذف محصول می‌رسد و بدون تأیید رد می‌شود');
  assert.equal(await repo.countForProduct(productId), 1, 'هیچ تصویری حذف نشده');
  const still = await db.query('SELECT COUNT(*)::int AS n FROM products WHERE id = $1', [productId]);
  assert.equal(still.rows[0].n, 1, 'محصول هم حذف نشده');
});

test('شناسهٔ محصولِ بدشکل به فهرست محصول برمی‌گردد', async () => {
  const jar = await login();
  const res = await fetch(`${BASE}/admin/catalogue/products/abc/images`,
    { headers: { Cookie: cookieHeader(jar) }, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /products\?error=not_found/);
});

test('نام فایلِ فرستادهٔ کاربر هرگز روی دیسک استفاده نمی‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(), name: '../../evil name .jpg' }]);
  const [img] = await repo.listForProduct(productId);

  assert.match(img.image_id, /^[0-9a-f-]{36}$/, 'شناسه باید UUID ساختهٔ سرور باشد');
  const products = await fsp.readdir(path.join(STORAGE_ROOT, 'products'));
  assert.deepEqual(products, [img.image_id], 'فقط پوشهٔ UUID روی دیسک است');
});

/* ════════════════════ ۸. عمومی در برابر خصوصی */

test('مشتق عمومی سرو می‌شود، اصل هرگز', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);

  const derivative = await fetch(`${BASE}/media/products/${img.image_id}/card.jpg`);
  assert.equal(derivative.status, 200);
  assert.match(derivative.headers.get('content-type'), /image\/jpeg/);

  /* هیچ mount ای برای originals وجود ندارد — نه با نشانی مستقیم و نه
     با تلاش برای بالا رفتن از پوشه. */
  for (const attempt of [
    '/media/originals/x.jpeg',
    `/media/products/../originals/${img.image_id}.jpeg`,
    `/media/products/%2e%2e/originals/${img.image_id}.jpeg`,
  ]) {
    const res = await fetch(`${BASE}${attempt}`, { redirect: 'manual' });
    assert.ok(res.status === 404 || res.status === 301 || res.status === 403,
      `${attempt} نباید محتوا بدهد (وضعیت ${res.status})`);
  }
});

/* ══════════════════════════ ۹. ترتیب و متن جایگزین */

test('ترتیب تازه ذخیره می‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [
    { buffer: await jpeg(800, 800) }, { buffer: await jpeg(810, 800) }, { buffer: await jpeg(820, 800) },
  ]);
  const rows = (await repo.listForProduct(productId))
    .slice().sort((a, b) => a.sort_order - b.sort_order);
  const reversed = rows.map((r) => r.image_id).reverse();

  const body = new URLSearchParams();
  body.append('_csrf', await adminCsrf(jar, productId));
  for (const id of reversed) body.append('order', id);

  const res = await fetch(`${BASE}/admin/catalogue/products/${productId}/images/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body, redirect: 'manual',
  });
  assert.equal(res.status, 303);

  const after = (await repo.listForProduct(productId))
    .slice().sort((a, b) => a.sort_order - b.sort_order).map((r) => r.image_id);
  assert.deepEqual(after, reversed);
});

test('متن جایگزین از راه مسیر ذخیره می‌شود و در HTML فرار داده می‌شود', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);

  await post(jar, `/admin/catalogue/products/${productId}/images/${img.image_id}/alt`,
    { _csrf: await adminCsrf(jar, productId), altText: '<script>alert(1)</script>' });

  const html = await (await fetch(`${BASE}/admin/catalogue/products/${productId}/images`,
    { headers: { Cookie: cookieHeader(jar) } })).text();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

/* ══════════════════════════════ ۱۰. رد پا */

test('افزودن و حذف تصویر در رد پا ثبت می‌شوند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg() }]);
  const [img] = await repo.listForProduct(productId);
  await post(jar, `/admin/catalogue/products/${productId}/images/${img.image_id}/delete`,
    { _csrf: await adminCsrf(jar, productId) });

  const actions = (await db.query('SELECT action FROM admin_audit_log ORDER BY id')).rows
    .map((r) => r.action);
  assert.ok(actions.includes('catalog.product.image.added'));
  assert.ok(actions.includes('catalog.product.image.deleted'));
});

test('رد پا محتوای تصویر یا نام فایل را ذخیره نمی‌کند', async () => {
  const jar = await login();
  await upload(jar, productId, [{ buffer: await jpeg(), name: 'customer-secret-photo.jpg' }]);
  const detail = (await db.query(
    "SELECT detail::text AS d FROM admin_audit_log WHERE action = 'catalog.product.image.added'"
  )).rows.map((r) => r.d).join(' ');
  assert.ok(!detail.includes('customer-secret-photo'), 'نام فایل کاربر نباید در رد پا باشد');
});
