/* ============================================================================
 * tests/migration-guard.test.js — نگهبان اجرای مستقیم مهاجرت‌گر
 * ----------------------------------------------------------------------------
 * چرا این آزمون وجود دارد؟
 *
 * شکل قبلی نگهبان در src/db/migrate.js مسیرهای سیستم‌عامل را مقایسه می‌کرد:
 *
 *     path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
 *
 * روی لینوکس درست کار می‌کرد و روی ویندوز هرگز برابر نمی‌شد، چون آنجا
 * pathname برابر «/C:/…» است و path.resolve آن را به شکلی در می‌آورد که با
 * «C:\…» یکی نیست. نتیجه: «npm run migrate» روی ویندوز با کد ۰ و بدون هیچ
 * پیامی تمام می‌شد و هیچ جدولی ساخته نمی‌شد.
 *
 * نکتهٔ روش‌شناسی: این آزمون سکوی میزبان را جعل نمی‌کند. به‌جای آن
 *   ۱. ویژگیِ بنیادیِ راه‌حل تازه را روی همین سکو می‌سنجد (رفت‌وبرگشت
 *      مسیر ↔ نشانی فایل)، که روی هر سکویی باید برقرار باشد؛
 *   ۲. شکستِ منطقِ قدیمی را با توابع خالصِ path.win32 نشان می‌دهد — این
 *      محاسبه است، نه تظاهر به ویندوز بودن؛
 *   ۳. رفتار واقعی را می‌سنجد: import کردن ماژول نباید مهاجرت اجرا کند.
 * ==========================================================================*/
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';

const MIGRATE_URL = new URL('../src/db/migrate.js', import.meta.url).href;
const MIGRATE_PATH = fileURLToPath(MIGRATE_URL);

/* ═══════════════════ ۱. ویژگیِ بنیادی: رفت‌وبرگشت مسیر ↔ نشانی */

test('pathToFileURL(مسیر) با نشانیِ همان ماژول برابر است', () => {
  /* دقیقا همان مقایسه‌ای که نگهبان انجام می‌دهد، روی فایل واقعی. */
  assert.equal(pathToFileURL(MIGRATE_PATH).href, MIGRATE_URL);
});

test('رفت‌وبرگشت روی هر سکویی پایدار است', () => {
  const roundTripped = pathToFileURL(fileURLToPath(MIGRATE_URL)).href;
  assert.equal(roundTripped, MIGRATE_URL, 'مسیر → نشانی → مسیر نباید چیزی را عوض کند');
});

test('نگهبان برای فایل دیگری فعال نمی‌شود', () => {
  const other = fileURLToPath(new URL('../src/db/index.js', import.meta.url));
  assert.notEqual(pathToFileURL(other).href, MIGRATE_URL,
    'فقط خودِ migrate.js باید نگهبان را فعال کند');
});

test('نشانی‌های حاوی فاصله و نویسهٔ غیرلاتین درست رمزگذاری می‌شوند', () => {
  /* مسیر نصب روی ویندوز اغلب فاصله دارد («C:\\Program Files\\…»).
     مقایسه باید روی نشانیِ رمزگذاری‌شده انجام شود، نه روی متن خام. */
  const tricky = path.join(path.dirname(MIGRATE_PATH), 'پوشه با فاصله', 'migrate.js');
  const href = pathToFileURL(tricky).href;
  assert.ok(href.startsWith('file://'), href);
  assert.ok(!href.includes(' '), 'فاصله باید رمزگذاری شود');
  assert.equal(fileURLToPath(href), tricky, 'رفت‌وبرگشت باید دقیق باشد');
});

/* ═════════ ۲. چرا منطق قدیمی روی ویندوز می‌شکست (محاسبهٔ خالص) */

test('منطق قدیمی زیر قواعد مسیر ویندوز برابر نمی‌شد', () => {
  /* این‌ها فقط توابع خالص‌اند؛ سکوی میزبان دست‌نخورده می‌ماند. */
  const winArgv = 'C:\\app\\src\\db\\migrate.js';
  const winMetaUrl = 'file:///C:/app/src/db/migrate.js';

  const oldLeft = path.win32.resolve(winArgv);
  const oldRight = path.win32.resolve(new URL(winMetaUrl).pathname);

  assert.notEqual(oldLeft, oldRight,
    'منطق قدیمی روی ویندوز برابر نمی‌شد — به همین دلیل مهاجرت اجرا نمی‌شد');
  assert.equal(oldLeft, 'C:\\app\\src\\db\\migrate.js');
  assert.ok(oldRight.startsWith('\\'), `pathname با «/C:» شروع می‌شود: ${oldRight}`);
});

test('منطق قدیمی روی لینوکس برابر می‌شد — برای همین دیده نشده بود', () => {
  const nixArgv = '/app/src/db/migrate.js';
  const nixMetaUrl = 'file:///app/src/db/migrate.js';
  assert.equal(
    path.posix.resolve(nixArgv),
    path.posix.resolve(new URL(nixMetaUrl).pathname),
    'روی لینوکس نقصی دیده نمی‌شد'
  );
});

/* ══════════════════════════ ۳. رفتار واقعیِ ماژول */

test('import کردن migrate.js مهاجرت اجرا نمی‌کند و اتصالی نمی‌سازد', async () => {
  const db = await import('../src/db/index.js');
  assert.equal(db.isPoolCreated(), false, 'پیش از import نباید استخری باشد');

  const migrate = await import('../src/db/migrate.js');

  /* اگر نگهبان اشتباه فعال می‌شد، runMigrations اجرا و getPool صدا زده
     می‌شد — و چون DATABASE_URL تنظیم نیست، استخر یا ساخته می‌شد یا خطا
     می‌داد. هیچ‌کدام نباید رخ بدهد. */
  assert.equal(db.isPoolCreated(), false,
    'import کردن ماژول نباید اتصال به پایگاه داده بسازد');
  assert.equal(typeof migrate.runMigrations, 'function', 'صادرات باید در دسترس باشد');
  assert.equal(typeof migrate.listMigrationFiles, 'function');
});

test('listMigrationFiles همچنان ترتیب درست می‌دهد', async () => {
  const { listMigrationFiles } = await import('../src/db/migrate.js');
  const files = listMigrationFiles();
  assert.ok(files.length >= 3, `انتظار دست‌کم سه مهاجرت: ${files.join(', ')}`);
  assert.deepEqual(files, [...files].sort(), 'ترتیب باید قطعی باشد');
  assert.ok(files.every((f) => f.endsWith('.sql')));
});

/* ═════════════════════ ۴. نگهبان هنوز سر جایش است */

test('نگهبان اجرای مستقیم حذف یا تضعیف نشده است', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(MIGRATE_PATH, 'utf8');

  assert.ok(src.includes('pathToFileURL(process.argv[1]).href === import.meta.url'),
    'نگهبان باید مقایسهٔ نشانی-محور باشد');
  assert.ok(src.includes('if (isDirectRun)'), 'اجرای مهاجرت باید پشت نگهبان بماند');
  /* فقط کدِ اجرایی سنجیده می‌شود: توضیحِ بالای نگهبان عمدا شکل قدیمی را
     نقل می‌کند تا معلوم باشد چرا عوض شده، و نباید آزمون را بشکند.
     بلوک توضیح به‌صورت کامل حذف می‌شود، نه فقط خطوطی که با ستاره
     شروع می‌شوند. */
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!codeOnly.includes('new URL(import.meta.url).pathname'),
    'شکل قدیمیِ ناسازگار با ویندوز نباید در کد اجرایی برگردد');
});
