/* ============================================================================
 * services/catalogQuery.js — خواندن پارامترهای نشانی
 * ----------------------------------------------------------------------------
 * هر چیزی که از querystring می‌آید ورودی کاربر است. اینجا تنها جایی است که
 * این ورودی به شکل قابل‌اعتماد در می‌آید، و قاعده ساده است:
 *
 *   هر پارامتری که در فهرست مجاز نباشد، *نادیده گرفته می‌شود* — نه خطا
 *   می‌دهد و نه به پایگاه داده می‌رسد. فهرست سفید، نه فهرست سیاه.
 *
 * این لایه هیچ SQL نمی‌سازد؛ فقط یک شیء تمیز می‌دهد که مخزن آن را
 * پارامتری مصرف می‌کند.
 * ==========================================================================*/
import { SORT_KEYS, DEFAULT_SORT, AVAILABILITY_VALUES } from '../db/repositories/products.js';
import { toEnglishDigits } from './format.js';

export const PER_PAGE = 12;

/** عدد صفحه از نشانی. ورودی بی‌معنی → صفحهٔ ۱. */
export function parsePage(raw) {
  const n = Number(toEnglishDigits(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  /* سقف عملی، تا کسی با page=99999999 پایگاه داده را بی‌جهت مشغول نکند. */
  return Math.min(Math.trunc(n), 10_000);
}

/** کلید ترتیب. ناشناخته → پیش‌فرض. */
export function parseSort(raw) {
  return SORT_KEYS.includes(raw) ? raw : DEFAULT_SORT;
}

/** وضعیت موجودی. ناشناخته → undefined (یعنی بدون فیلتر). */
export function parseAvailability(raw) {
  return AVAILABILITY_VALUES.includes(raw) ? raw : undefined;
}

/** عبارت جست‌وجو. فقط کوتاه می‌شود؛ نرمال‌سازی کار لایهٔ مخزن است. */
export function parseSearchTerm(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 120);
}

/**
 * خواندن کامل پارامترهای یک صفحهٔ فهرست.
 * @returns {{page:number, sort:string, availability:string|undefined, brandSlug:string|undefined}}
 */
export function parseListingQuery(query = {}) {
  const brandSlug = typeof query.brand === 'string' && query.brand.length <= 200
    ? query.brand.trim() || undefined
    : undefined;

  return {
    page: parsePage(query.page),
    sort: parseSort(query.sort),
    availability: parseAvailability(query.availability),
    brandSlug,
  };
}

/**
 * ساخت نشانی همین صفحه با پارامترهای عوض‌شده — برای پیوندهای صفحه‌بندی و
 * مرتب‌سازی. فقط کلیدهای شناخته‌شده نوشته می‌شوند، پس پارامتر ناخواسته‌ای
 * از نشانی ورودی به نشانی خروجی منتقل نمی‌شود.
 */
export function buildQueryString({ page, sort, availability, brand, q } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (brand) params.set('brand', brand);
  if (availability) params.set('availability', availability);
  if (sort && sort !== DEFAULT_SORT) params.set('sort', sort);
  if (page && page > 1) params.set('page', String(page));
  const s = params.toString();
  return s ? `?${s}` : '';
}
