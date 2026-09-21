/* ============================================================================
 * scripts/check-sharp.js — بررسی کارکرد sharp روی این محیط
 * ----------------------------------------------------------------------------
 * sharp تنها وابستگی بومی (native) پروژه است، پس باید زود و صریح تأیید شود.
 * این اسکریپت تصویری می‌سازد، تغییر اندازه می‌دهد، واترمارک می‌گذارد و به
 * WebP و JPEG رمزگذاری می‌کند — یعنی دقیقا همان کاری که خط لوله واقعی
 * انجام خواهد داد.
 *
 * چیزی روی دیسک نمی‌نویسد؛ همه‌چیز در حافظه است.
 * ==========================================================================*/
import sharp from 'sharp';

const ok = (m) => console.log('  ✓ ' + m);

console.log('\n=== بررسی sharp ===');
console.log(`  نسخه sharp: ${sharp.versions.sharp}`);
console.log(`  نسخه libvips: ${sharp.versions.vips}`);
console.log(`  سکو: ${process.platform}-${process.arch}`);
console.log(`  هم‌زمانی: ${sharp.concurrency()}`);
console.log('');

/* ۱. ساخت تصویر آزمایشی */
const source = await sharp({
  create: { width: 1200, height: 900, channels: 3, background: { r: 228, g: 230, b: 226 } },
}).png().toBuffer();
ok(`تصویر آزمایشی ساخته شد (${source.length} بایت)`);

/* ۲. خواندن فراداده */
const meta = await sharp(source).metadata();
if (meta.width !== 1200 || meta.height !== 900) throw new Error('ابعاد نادرست');
ok(`فراداده خوانده شد: ${meta.format} ${meta.width}×${meta.height}`);

/* ۳. واترمارک آزمایشی */
const watermark = await sharp({
  create: { width: 200, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.45 } },
}).png().toBuffer();
ok('واترمارک آزمایشی ساخته شد');

/* ۴. تغییر اندازه + ترکیب واترمارک + WebP */
const webp = await sharp(source)
  .resize(400, 400, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .composite([{ input: watermark, gravity: 'southwest' }])
  .webp({ quality: 82 })
  .toBuffer();
const webpMeta = await sharp(webp).metadata();
if (webpMeta.format !== 'webp') throw new Error('خروجی WebP نیست');
ok(`WebP ساخته شد: ${webpMeta.width}×${webpMeta.height}، ${webp.length} بایت`);

/* ۵. جایگزین JPEG */
const jpeg = await sharp(source)
  .resize(400, 400, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
  .jpeg({ quality: 84, mozjpeg: true })
  .toBuffer();
const jpegMeta = await sharp(jpeg).metadata();
if (jpegMeta.format !== 'jpeg') throw new Error('خروجی JPEG نیست');
ok(`JPEG ساخته شد: ${jpegMeta.width}×${jpegMeta.height}، ${jpeg.length} بایت`);

/* ۶. رد کردن ورودی نامعتبر */
let rejected = false;
try { await sharp(Buffer.from('این یک تصویر نیست')).metadata(); }
catch { rejected = true; }
if (!rejected) throw new Error('ورودی نامعتبر رد نشد');
ok('ورودی نامعتبر به‌درستی رد شد');

console.log('\nنتیجه: sharp روی این محیط کار می‌کند.\n');
