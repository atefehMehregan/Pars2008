/* ============================================================================
 * tests/validate.test.js — آزمون اعتبارسنجی فرم‌ها
 * ----------------------------------------------------------------------------
 * منطق خالص است: نه پایگاه داده‌ای لازم دارد، نه HTTP. برای همین هم سریع
 * است و هم می‌شود حالت‌های مرزی را بی‌دردسر پوشش داد.
 *
 * تمرکز روی جاهایی است که قید پایگاه داده سخت‌گیر است و پیام خام آن برای
 * کاربر بی‌معنی می‌بود — مثل «قیمت ویژه باید *اکیدا* کمتر باشد» یا
 * «وزن اگر داده شد باید بزرگ‌تر از صفر باشد».
 * ==========================================================================*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, cleanNumeric, cleanText, cleanMultiline, checkbox,
  requiredText, optionalText, integer, money, oneOf, idRef,
  slugField, salePriceRule, createFieldErrors,
} from '../src/services/validate.js';

process.env.NODE_ENV = 'test';

const AVAILABILITY = ['in_stock', 'out_of_stock', 'on_order', 'discontinued'];

/* ------------------------------------------------------- نرمال‌سازی */

test('رقم فارسی در فیلد عددی پذیرفته می‌شود', () => {
  assert.equal(cleanNumeric('۱۲۳۴۵'), '12345');
  const r = money('۲۵۰۰۰۰', { label: 'قیمت' });
  assert.equal(r.error, null);
  assert.equal(r.value, 250000);
});

test('جداکنندهٔ هزارگان — فارسی و لاتین — حذف می‌شود', () => {
  assert.equal(money('۱٬۲۰۰٬۰۰۰', { label: 'قیمت' }).value, 1200000);
  assert.equal(money('1,200,000', { label: 'قیمت' }).value, 1200000);
});

test('نام محصول دست‌نخورده می‌ماند و رقم فارسی‌اش لاتین نمی‌شود', () => {
  /* «پژو ۲۰۰۸» باید همان بماند. تبدیل رقم در متن، خرابکاری است نه نرمال‌سازی. */
  const r = requiredText('پژو ۲۰۰۸', { label: 'نام' });
  assert.equal(r.value, 'پژو ۲۰۰۸');
  assert.equal(r.error, null);
});

test('فاصله‌های اضافی در متن تک‌خطی جمع می‌شوند', () => {
  assert.equal(cleanText('  لنت    ترمز  '), 'لنت ترمز');
});

test('متن چندخطی خط‌هایش را نگه می‌دارد', () => {
  assert.equal(cleanMultiline('خط یک\r\n\r\n\r\n\r\nخط دو  '), 'خط یک\n\nخط دو');
});

/* ------------------------------------------------------------- متن */

test('نام خالی رد می‌شود', () => {
  const r = requiredText('   ', { label: 'نام' });
  assert.ok(r.error, 'باید خطا بدهد');
  assert.match(r.error, /الزامی/);
});

test('نام بیش از حد بلند رد می‌شود', () => {
  const r = requiredText('م'.repeat(201), { label: 'نام', max: 200 });
  assert.ok(r.error);
  assert.match(r.error, /بیشتر/);
});

test('متن اختیاریِ خالی به null تبدیل می‌شود، نه رشتهٔ خالی', () => {
  const r = optionalText('', { label: 'توضیح' });
  assert.equal(r.value, null);
  assert.equal(r.error, null);
});

/* ------------------------------------------------------------ عدد */

test('قیمت منفی رد می‌شود', () => {
  const r = money('-1', { label: 'قیمت' });
  assert.ok(r.error);
  assert.match(r.error, /کمتر/);
});

test('قیمت اعشاری رد می‌شود', () => {
  assert.ok(money('12.5', { label: 'قیمت' }).error);
});

test('قیمت بزرگ‌تر از سقف رد می‌شود', () => {
  assert.ok(money(String(LIMITS.MONEY_MAX + 1), { label: 'قیمت' }).error);
});

test('موجودی صفر مجاز است', () => {
  const r = integer('۰', { label: 'موجودی', min: 0, max: LIMITS.STOCK_MAX });
  assert.equal(r.error, null);
  assert.equal(r.value, 0);
});

test('وزن صفر رد می‌شود چون قید پایگاه داده اکیدا بزرگ‌تر از صفر می‌خواهد', () => {
  const r = integer('0', { label: 'وزن', required: false, min: 1, max: LIMITS.WEIGHT_MAX });
  assert.ok(r.error, 'صفر نباید پذیرفته شود');
});

test('وزن خالی مجاز است چون ستون nullable است', () => {
  const r = integer('', { label: 'وزن', required: false, min: 1 });
  assert.equal(r.value, null);
  assert.equal(r.error, null);
});

test('ارجاع به شناسه باید عدد مثبت باشد', () => {
  assert.ok(idRef('0', { label: 'دسته', required: true }).error);
  assert.equal(idRef('7', { label: 'دسته' }).value, 7);
  assert.equal(idRef('', { label: 'برند' }).value, null);
});

/* -------------------------------------------------- فهرست مقدارها */

test('وضعیت ناشناخته رد می‌شود', () => {
  const r = oneOf('flying', AVAILABILITY, { label: 'وضعیت' });
  assert.ok(r.error);
  assert.equal(r.value, null);
});

test('وضعیت شناخته‌شده پذیرفته می‌شود', () => {
  assert.equal(oneOf('on_order', AVAILABILITY, { label: 'وضعیت' }).value, 'on_order');
});

/* ------------------------------------------------------- چک‌باکس */

test('نبودِ چک‌باکس یعنی خاموش', () => {
  assert.equal(checkbox(undefined), false);
  assert.equal(checkbox('on'), true);
  assert.equal(checkbox('0'), false);
});

/* --------------------------------------------------------- نشانی */

test('نشانی خالی از روی نام فارسی ساخته می‌شود', () => {
  const r = slugField('', 'لنت ترمز جلو');
  assert.equal(r.error, null);
  assert.equal(r.value, 'لنت-ترمز-جلو');
});

test('نشانیِ دست‌نویس هم نرمال می‌شود، نه اینکه رد شود', () => {
  assert.equal(slugField('لوازم ترمز', 'هر چیزی').value, 'لوازم-ترمز');
});

test('ی و ک عربی در نشانی یکدست می‌شوند', () => {
  /* وگرنه «كليد» و «کلید» دو نشانی متفاوت می‌شدند و یکی ۴۰۴ می‌داد. */
  assert.equal(slugField('كليد', '').value, slugField('کلید', '').value);
});

test('وقتی نه نشانی هست و نه نامِ قابل تبدیل، خطا می‌دهد', () => {
  const r = slugField('', '!!!');
  assert.ok(r.error);
});

/* ----------------------------------------- قاعدهٔ بین-فیلدیِ قیمت */

test('قیمت ویژهٔ برابر با قیمت اصلی رد می‌شود', () => {
  /* قید products_sale_below_price اکیدا «کمتر» می‌خواهد. */
  assert.ok(salePriceRule(100000, 100000));
});

test('قیمت ویژهٔ بیشتر از قیمت اصلی رد می‌شود', () => {
  assert.ok(salePriceRule(120000, 100000));
});

test('قیمت ویژهٔ کمتر پذیرفته می‌شود', () => {
  assert.equal(salePriceRule(90000, 100000), null);
});

test('نبودِ قیمت ویژه مشکلی نیست', () => {
  assert.equal(salePriceRule(null, 100000), null);
});

/* -------------------------------------------------- جمع‌کنندهٔ خطا */

test('اولین خطای هر فیلد می‌ماند و بعدی‌ها آن را پاک نمی‌کنند', () => {
  const f = createFieldErrors();
  f.take('name', { value: '', error: 'خطای اول' });
  f.add('name', 'خطای دوم');
  assert.equal(f.errors.name, 'خطای اول');
  assert.equal(f.ok(), false);
  assert.equal(f.has('name'), true);
});

test('بدون خطا، ok درست است و مقدارها رد می‌شوند', () => {
  const f = createFieldErrors();
  const v = f.take('name', requiredText('لنت', { label: 'نام' }));
  assert.equal(v, 'لنت');
  assert.equal(f.ok(), true);
  assert.deepEqual(f.errors, {});
});
