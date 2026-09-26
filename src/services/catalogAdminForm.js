/* ============================================================================
 * services/catalogAdminForm.js — تبدیل فرم مدیر به دادهٔ تمیز
 * ----------------------------------------------------------------------------
 * بین کنترلر و مخزن می‌نشیند. کنترلر فقط HTTP می‌داند و مخزن فقط SQL؛
 * تبدیل «آنچه مرورگر فرستاد» به «آنچه پایگاه داده می‌پذیرد» کار اینجاست.
 *
 * قاعده‌ها:
 *   * هیچ استثنایی پرتاب نمی‌شود. خروجی همیشه { values, errors, warnings }.
 *   * خطا فارسی و آمادهٔ نمایش است و به نام فیلد فرم گره خورده.
 *   * هشدار، ذخیره را متوقف نمی‌کند — فقط دیده می‌شود.
 *   * قیدهای پایگاه داده اینجا بازگو می‌شوند تا کاربر پیام روشن بگیرد،
 *     ولی قید پایگاه داده همچنان خط آخر است.
 * ==========================================================================*/
import {
  requiredText, optionalText, integer, money, idRef, checkbox, oneOf,
  slugField, salePriceRule, yearRangeRule, specsField, stockWarning,
  cleanNumeric, createFieldErrors, LIMITS,
} from './validate.js';

import { SORT_KEYS, DEFAULT_SORT } from '../db/repositories/products.js';

export const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'on_order', 'discontinued'];

/* برچسب فارسی ترتیب‌ها — همان کلیدهای مخزن، یک جا برای فرم مدیر. */
export const SORT_LABELS = {
  newest: 'تازه‌ترین',
  'price-asc': 'ارزان‌ترین',
  'price-desc': 'گران‌ترین',
  name: 'بر اساس نام',
};

/** برچسب فارسی وضعیت‌ها — یک جا، تا فهرست و فرم یکی بگویند. */
export const AVAILABILITY_LABELS = {
  in_stock: 'موجود',
  out_of_stock: 'ناموجود',
  on_order: 'سفارشی',
  discontinued: 'منسوخ',
};

/* ------------------------------------------------------------ محصول ---- */

/**
 * فرم محصول → دادهٔ آمادهٔ مخزن.
 * @returns {{values:object, errors:object, warnings:string[]}}
 */
export function parseProductForm(body = {}) {
  const f = createFieldErrors();
  const warnings = [];

  const name = f.take('name', requiredText(body.name, { label: 'نام محصول', min: 2, max: 200 }));
  const slug = f.take('slug', slugField(body.slug, name, { label: 'نشانی' }));
  const sku = f.take('sku', requiredText(body.sku, { label: 'کد کالا', min: 1, max: 64 }));
  const oemNumber = f.take('oemNumber', optionalText(body.oemNumber, { label: 'شماره فنی', max: 120 }));

  const categoryId = f.take('categoryId', idRef(body.categoryId, { label: 'دسته', required: true }));
  const brandId = f.take('brandId', idRef(body.brandId, { label: 'برند', required: false }));

  const priceToman = f.take('priceToman', money(body.priceToman, { label: 'قیمت' }));
  const salePriceToman = f.take('salePriceToman',
    money(body.salePriceToman, { label: 'قیمت فروش ویژه', required: false }));
  /* قید products_sale_below_price اکیدا «کمتر» می‌خواهد. */
  f.add('salePriceToman', salePriceRule(salePriceToman, priceToman));

  const stockQty = f.take('stockQty',
    integer(body.stockQty, { label: 'موجودی', min: 0, max: LIMITS.STOCK_MAX }));
  const availability = f.take('availability',
    oneOf(body.availability, AVAILABILITY_VALUES, { label: 'وضعیت' }));

  const weightGrams = f.take('weightGrams',
    integer(body.weightGrams, { label: 'وزن (گرم)', required: false, min: 1, max: LIMITS.WEIGHT_MAX }));

  const shortDescription = f.take('shortDescription',
    optionalText(body.shortDescription, { label: 'توضیح کوتاه', max: 500 }));
  const description = f.take('description',
    optionalText(body.description, { label: 'توضیح کامل', max: 20000, multiline: true }));
  const compatibilityNote = f.take('compatibilityNote',
    optionalText(body.compatibilityNote, { label: 'یادداشت سازگاری', max: 1000, multiline: true }));

  const specs = f.take('specs', specsField(body.specKey, body.specValue));

  const isFeatured = checkbox(body.isFeatured);
  const isNew = checkbox(body.isNew);
  const isActive = checkbox(body.isActive);

  /* هشدار نرم — ذخیره را متوقف نمی‌کند. */
  if (stockQty !== null && availability) {
    const w = stockWarning(stockQty, availability);
    if (w) warnings.push(w);
  }

  return {
    values: {
      name, slug, sku, oemNumber, categoryId, brandId,
      priceToman, salePriceToman, stockQty, availability,
      shortDescription, description, compatibilityNote, specs,
      weightGrams, isFeatured, isNew, isActive,
    },
    errors: f.errors,
    warnings,
  };
}

/* ------------------------------------------------------------- دسته ---- */

export function parseCategoryForm(body = {}) {
  const f = createFieldErrors();
  const name = f.take('name', requiredText(body.name, { label: 'نام دسته', min: 2, max: 120 }));
  const slug = f.take('slug', slugField(body.slug, name, { label: 'نشانی' }));
  const parentId = f.take('parentId', idRef(body.parentId, { label: 'دستهٔ والد', required: false }));
  const description = f.take('description',
    optionalText(body.description, { label: 'توضیح', max: 2000, multiline: true }));
  const sortOrder = f.take('sortOrder', integer(body.sortOrder, {
    label: 'ترتیب نمایش', required: false,
    min: LIMITS.SORT_ORDER_MIN, max: LIMITS.SORT_ORDER_MAX,
  }));
  const isActive = checkbox(body.isActive);

  return {
    values: { name, slug, parentId, description, sortOrder: sortOrder ?? 0, isActive },
    errors: f.errors,
    warnings: [],
  };
}

/* ------------------------------------------------------------- برند ---- */

export function parseBrandForm(body = {}) {
  const f = createFieldErrors();
  const name = f.take('name', requiredText(body.name, { label: 'نام برند', min: 2, max: 120 }));
  const slug = f.take('slug', slugField(body.slug, name, { label: 'نشانی' }));
  const country = f.take('country', optionalText(body.country, { label: 'کشور', max: 80 }));
  const isActive = checkbox(body.isActive);

  return { values: { name, slug, country, isActive }, errors: f.errors, warnings: [] };
}

/* ------------------------------------------------------------ خودرو ---- */

/**
 * فرم خودرو → دادهٔ آمادهٔ مخزن.
 *
 * ستون‌های توصیفی (نسل، کد موتور، بازهٔ سال) اختیاری‌اند و اینجا هیچ
 * مقدار پیش‌فرضی برایشان ساخته نمی‌شود: دادهٔ کسب‌وکار است و فقط از
 * مدیر می‌آید.
 *
 * @returns {{values:object, errors:object, warnings:string[]}}
 */
export function parseVehicleForm(body = {}) {
  const f = createFieldErrors();

  const make = f.take('make', requiredText(body.make, { label: 'سازنده', min: 2, max: 80 }));
  const model = f.take('model', requiredText(body.model, { label: 'مدل', min: 1, max: 80 }));
  const displayName = f.take('displayName',
    requiredText(body.displayName, { label: 'نام نمایشی', min: 2, max: 160 }));
  /* نشانی از نام نمایشی ساخته می‌شود، چون همان چیزی است که مشتری می‌بیند. */
  const slug = f.take('slug', slugField(body.slug, displayName, { label: 'نشانی' }));

  const generation = f.take('generation', optionalText(body.generation, { label: 'نسل', max: 80 }));
  const engineCode = f.take('engineCode', optionalText(body.engineCode, { label: 'کد موتور', max: 40 }));
  const engineLabel = f.take('engineLabel', optionalText(body.engineLabel, { label: 'عنوان موتور', max: 80 }));

  const yearFrom = f.take('yearFrom', integer(body.yearFrom, {
    label: 'از سال', required: false, min: LIMITS.YEAR_MIN, max: LIMITS.YEAR_MAX,
  }));
  const yearTo = f.take('yearTo', integer(body.yearTo, {
    label: 'تا سال', required: false, min: LIMITS.YEAR_MIN, max: LIMITS.YEAR_MAX,
  }));
  /* قید vehicles_year_range همین را می‌گوید، ولی کاربر باید پیام روشن
     ببیند نه خطای خام پایگاه داده. */
  f.add('yearTo', yearRangeRule(yearFrom, yearTo));

  const sortOrder = f.take('sortOrder', integer(body.sortOrder, {
    label: 'ترتیب نمایش', required: false,
    min: LIMITS.SORT_ORDER_MIN, max: LIMITS.SORT_ORDER_MAX,
  }));
  const isActive = checkbox(body.isActive);

  return {
    values: {
      make, model, generation, yearFrom, yearTo, engineCode, engineLabel,
      slug, displayName, sortOrder: sortOrder ?? 0, isActive,
    },
    errors: f.errors,
    warnings: [],
  };
}

/**
 * شناسه‌های خودروی انتخاب‌شده در فرم محصول.
 *
 * مرورگر برای select چندگزینه‌ای یک مقدار یا آرایه می‌فرستد؛ هر دو
 * پذیرفته می‌شوند. مقدار بی‌معنی بی‌صدا کنار گذاشته می‌شود — همان
 * قاعدهٔ فهرست سفید در بقیهٔ پروژه.
 */
export function parseVehicleSelection(raw, { max = 200 } = {}) {
  const list = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
  const seen = new Set();
  for (const value of list) {
    const n = Number(cleanNumeric(value));
    if (Number.isSafeInteger(n) && n > 0) seen.add(n);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/* ------------------------------------------- تشخیص فیلدهای تغییرکرده -- */

/** نگاشت نام فیلد فرم به ستون پایگاه داده. برای رد پا لازم است. */
export const PRODUCT_COLUMN_MAP = {
  name: 'name', slug: 'slug', sku: 'sku', oemNumber: 'oem_number',
  categoryId: 'category_id', brandId: 'brand_id',
  priceToman: 'price_toman', salePriceToman: 'sale_price_toman',
  stockQty: 'stock_qty', availability: 'availability',
  shortDescription: 'short_description', description: 'description',
  compatibilityNote: 'compatibility_note', specs: 'specs',
  weightGrams: 'weight_grams',
  isFeatured: 'is_featured', isNew: 'is_new', isActive: 'is_active',
};

export const CATEGORY_COLUMN_MAP = {
  name: 'name', slug: 'slug', parentId: 'parent_id',
  description: 'description', sortOrder: 'sort_order', isActive: 'is_active',
};

export const BRAND_COLUMN_MAP = {
  name: 'name', slug: 'slug', country: 'country', isActive: 'is_active',
};

export const VEHICLE_COLUMN_MAP = {
  make: 'make', model: 'model', generation: 'generation',
  yearFrom: 'year_from', yearTo: 'year_to',
  engineCode: 'engine_code', engineLabel: 'engine_label',
  slug: 'slug', displayName: 'display_name',
  sortOrder: 'sort_order', isActive: 'is_active',
};

function sameValue(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  /* BIGINT از درایور گاهی رشته برمی‌گردد و از فرم عدد می‌آید. */
  return String(a) === String(b);
}

/**
 * فقط *نام* فیلدهای تغییرکرده.
 *
 * عمدا هیچ مقداری برنمی‌گردد: رد پا باید بگوید «چه چیزی عوض شد»، نه
 * «به چه چیزی عوض شد». قیمت، توضیح و بقیهٔ محتوا جای‌شان در لاگ نیست.
 */
export function changedFields(previousRow, nextValues, columnMap) {
  if (!previousRow) return Object.keys(nextValues);
  const changed = [];
  for (const [field, column] of Object.entries(columnMap)) {
    if (!(field in nextValues)) continue;
    if (!sameValue(previousRow[column], nextValues[field])) changed.push(field);
  }
  return changed;
}

/* --------------------------------------------------- پیام خطای نوشتن -- */

const CONSTRAINT_MESSAGES = {
  products_category_id_fkey: 'این دسته محصول دارد و حذف نمی‌شود. اول محصول‌ها را به دستهٔ دیگری ببرید یا حذف کنید.',
  products_brand_id_fkey: 'این برند محصول دارد و حذف نمی‌شود. اول محصول‌ها را به برند دیگری ببرید یا حذف کنید.',
  categories_parent_id_fkey: 'این دسته زیردسته دارد و حذف نمی‌شود. اول زیردسته‌ها را جابه‌جا یا حذف کنید.',
  product_vehicle_vehicle_id_fkey: 'این خودرو به محصول‌هایی وصل است و حذف نمی‌شود. اول سازگاری آن محصول‌ها را بردارید، یا خودرو را غیرفعال کنید.',
};

const DUPLICATE_MESSAGES = {
  slug: 'این نشانی قبلا استفاده شده است. نشانی دیگری بنویسید.',
  sku: 'این کد کالا قبلا ثبت شده است.',
};

const MISSING_MESSAGES = {
  categoryId: 'دستهٔ انتخاب‌شده وجود ندارد.',
  brandId: 'برند انتخاب‌شده وجود ندارد.',
};

/**
 * خطای مخزن → پیام فارسی.
 *
 * هیچ‌وقت متن خام پایگاه داده برنگردانده نمی‌شود: پیام PostgreSQL در
 * نقض CHECK کل ردیف را در خود دارد.
 *
 * @returns {{field:string|null, message:string}}
 */
export function describeWriteError(err) {
  if (err?.code === 'duplicate') {
    const field = err.field ?? null;
    return { field, message: DUPLICATE_MESSAGES[field] || 'مقدار تکراری است.' };
  }
  if (err?.code === 'fk_missing') {
    const field = err.field ?? null;
    return { field, message: MISSING_MESSAGES[field] || 'مقدار انتخاب‌شده وجود ندارد.' };
  }
  if (err?.code === 'fk_restrict') {
    return {
      field: null,
      message: CONSTRAINT_MESSAGES[err.constraint]
        || 'این ردیف جای دیگری استفاده شده و حذف نمی‌شود.',
    };
  }
  if (err?.code === 'check_failed') {
    return { field: null, message: 'مقدارها با قاعده‌های پایگاه داده سازگار نیستند.' };
  }
  return null;   // خطای ناشناخته — به errorHandler سپرده می‌شود
}

/* ----------------------------------------------------- پیام‌های فلش --- */

/* پس از هدایت، پیام از روی *کد* ساخته می‌شود، نه از متن داخل نشانی.
   متن دلخواه در query string یعنی هر کسی می‌تواند با یک پیوند، پیام
   دلخواهش را داخل پنل مدیر نشان بدهد. فهرست سفید این راه را می‌بندد. */
export const FLASH_SUCCESS = {
  created: 'با موفقیت ثبت شد.',
  updated: 'تغییرها ذخیره شد.',
  deleted: 'برای همیشه حذف شد.',
  activated: 'فعال شد و در سایت دیده می‌شود.',
  deactivated: 'غیرفعال شد و از سایت برداشته شد. هر وقت خواستید دوباره فعالش کنید.',
  stock: 'موجودی به‌روز شد.',
};

/** نگاشت نام قید پایگاه داده به کدِ کوتاهِ قابل حمل در نشانی. */
export const DELETE_ERROR_CODES = {
  products_category_id_fkey: 'cat_has_products',
  categories_parent_id_fkey: 'cat_has_children',
  products_brand_id_fkey: 'brand_has_products',
  product_vehicle_vehicle_id_fkey: 'vehicle_has_products',
};

export const FLASH_ERRORS = {
  cat_has_products: CONSTRAINT_MESSAGES.products_category_id_fkey,
  cat_has_children: CONSTRAINT_MESSAGES.categories_parent_id_fkey,
  brand_has_products: CONSTRAINT_MESSAGES.products_brand_id_fkey,
  vehicle_has_products: CONSTRAINT_MESSAGES.product_vehicle_vehicle_id_fkey,
  blocked: 'این ردیف جای دیگری استفاده شده و حذف نمی‌شود.',
  not_found: 'ردیف مورد نظر پیدا نشد.',
  bad_stock: 'مقدار موجودی یا وضعیت معتبر نبود و چیزی ذخیره نشد.',
};

/* ------------------------------------------------- نشانی فهرست مدیر --- */

/**
 * رشتهٔ پرسمان فهرست مدیر.
 * عمدا از buildQueryString کاتالوگ عمومی استفاده نمی‌شود: آن یکی فهرست
 * سفیدِ خودش را دارد (sort/availability/brand/q) و پارامترهای مدیر
 * (category/active) را بی‌سروصدا می‌انداخت.
 */
export function buildAdminQuery({ q, category, brand, active, sort, page } = {}) {
  const parts = [];
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  if (category) parts.push(`category=${encodeURIComponent(category)}`);
  if (brand) parts.push(`brand=${encodeURIComponent(brand)}`);
  if (active === 'yes' || active === 'no') parts.push(`active=${active}`);
  /* ترتیب پیش‌فرض در نشانی نمی‌نشیند تا نشانی‌ها کوتاه بمانند. */
  if (sort && sort !== DEFAULT_SORT) parts.push(`sort=${encodeURIComponent(sort)}`);
  if (page && Number(page) > 1) parts.push(`page=${encodeURIComponent(page)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** پارامترهای فهرست محصول مدیر، از فهرست سفید. */
export function parseProductListQuery(query = {}) {
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const category = Number(query.category) > 0 ? Number(query.category) : null;
  const brand = Number(query.brand) > 0 ? Number(query.brand) : null;
  const active = query.active === 'yes' ? true : (query.active === 'no' ? false : null);
  /* کلید ترتیب از همان فهرست سفید مخزن می‌آید؛ ناشناخته → پیش‌فرض. */
  const sort = SORT_KEYS.includes(query.sort) ? query.sort : DEFAULT_SORT;
  const page = Number(query.page) > 0 ? Math.trunc(Number(query.page)) : 1;
  return { q, category, brand, active, sort, page };
}
