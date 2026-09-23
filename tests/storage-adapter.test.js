/* ============================================================================
 * tests/storage-adapter.test.js — لایهٔ ذخیره‌سازی (فاز ۵)
 * ----------------------------------------------------------------------------
 * همه‌چیز در یک پوشهٔ موقت اتفاق می‌افتد؛ پوشهٔ storage واقعی پروژه
 * هرگز لمس نمی‌شود.
 * ==========================================================================*/
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const { createLocalStorage, assertImageId } = await import('../src/services/storage.js');

let dir, storage, originalsDir, productsDir;
const UUID = '11111111-2222-4333-8444-555555555555';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pars-storage-'));
  originalsDir = path.join(dir, 'originals');
  productsDir = path.join(dir, 'products');
  storage = createLocalStorage({ originalsDir, productsDir });
});

after(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

/* ═══════════════════════════════════ ۱. اعتبارسنجی شناسه */

test('شناسهٔ غیر-UUID رد می‌شود', () => {
  for (const bad of ['../../etc/passwd', 'abc', '', '../x', `${UUID}/..`, null, 42]) {
    assert.throws(() => assertImageId(bad), /شناسهٔ تصویر/, String(bad));
  }
});

test('شناسهٔ UUID پذیرفته می‌شود', () => {
  assert.equal(assertImageId(UUID), UUID);
});

test('هیچ متدی با شناسهٔ بدشکل کار نمی‌کند', async () => {
  await assert.rejects(() => storage.putOriginal('../evil', Buffer.from('x'), 'png'));
  await assert.rejects(() => storage.putDerivative('../evil', 'card', 'webp', Buffer.from('x')));
  await assert.rejects(() => storage.removeImage('../evil'));
  assert.throws(() => storage.publicUrl('../evil', 'card', 'webp'));
});

test('نام اندازه و پسوندِ بدشکل رد می‌شوند', async () => {
  await assert.rejects(() => storage.putDerivative(UUID, '../card', 'webp', Buffer.from('x')));
  await assert.rejects(() => storage.putDerivative(UUID, 'card', '../webp', Buffer.from('x')));
  assert.throws(() => storage.publicUrl(UUID, 'card/../..', 'webp'));
});

/* ═══════════════════════════════════════ ۲. نوشتن و خواندن */

test('اصل بیرون از پوشهٔ عمومی نوشته می‌شود', async () => {
  const target = await storage.putOriginal(UUID, Buffer.from('original-bytes'), 'png');
  assert.ok(target.startsWith(originalsDir), 'اصل باید در پوشهٔ originals باشد');
  assert.ok(!target.startsWith(productsDir), 'اصل هرگز نباید در پوشهٔ عمومی باشد');
  assert.equal(await fs.readFile(target, 'utf8'), 'original-bytes');
});

test('مشتق در پوشهٔ عمومیِ همان شناسه می‌نشیند', async () => {
  const target = await storage.putDerivative(UUID, 'card', 'webp', Buffer.from('derived'));
  assert.equal(target, path.join(productsDir, UUID, 'card.webp'));
  assert.equal(await fs.readFile(target, 'utf8'), 'derived');
});

test('نشانی عمومی همان قرارداد /media/products است', () => {
  assert.equal(storage.publicUrl(UUID, 'card', 'webp'), `/media/products/${UUID}/card.webp`);
  assert.equal(storage.publicUrl(UUID, 'detail', 'jpg'), `/media/products/${UUID}/detail.jpg`);
});

test('hasImage وجود پوشهٔ مشتق‌ها را گزارش می‌کند', async () => {
  assert.equal(await storage.hasImage(UUID), true);
  assert.equal(await storage.hasImage('99999999-9999-4999-8999-999999999999'), false);
});

/* ═════════════════════════════════════════════ ۳. پاک کردن */

test('removeImage هم مشتق‌ها و هم اصل را می‌برد', async () => {
  const id = '22222222-3333-4444-8555-666666666666';
  await storage.putOriginal(id, Buffer.from('o'), 'jpeg');
  await storage.putDerivative(id, 'thumb', 'jpg', Buffer.from('t'));
  await storage.putDerivative(id, 'card', 'webp', Buffer.from('c'));

  assert.equal(await storage.hasImage(id), true);
  await storage.removeImage(id);

  assert.equal(await storage.hasImage(id), false);
  const originals = await fs.readdir(originalsDir);
  assert.ok(!originals.some((n) => n.startsWith(id)), 'اصل هم باید رفته باشد');
});

test('removeImage بی‌اثرپذیر است — دو بار اجرا خطا نمی‌دهد', async () => {
  const id = '33333333-4444-4555-8666-777777777777';
  await storage.putDerivative(id, 'card', 'webp', Buffer.from('x'));
  await storage.removeImage(id);
  await storage.removeImage(id);          // باید بی‌صدا رد شود
  assert.equal(await storage.hasImage(id), false);
});

test('removeImage برای شناسه‌ای که هرگز نبوده هم بی‌خطر است', async () => {
  await storage.removeImage('44444444-5555-4666-8777-888888888888');
});

/* ══════════════════════════════════ ۴. استقلال از پیاده‌سازی */

test('قرارداد لایه همان چیزی است که مصرف‌کننده‌ها انتظار دارند', () => {
  for (const method of ['putOriginal', 'putDerivative', 'removeImage', 'hasImage', 'publicUrl']) {
    assert.equal(typeof storage[method], 'function', `${method} باید وجود داشته باشد`);
  }
  assert.equal(storage.driver, 'local', 'پیاده‌سازی فاز ۵ محلی است');
});
