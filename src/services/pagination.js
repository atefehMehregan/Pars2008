/* ============================================================================
 * services/pagination.js — ساخت نوار صفحه‌بندی
 * ----------------------------------------------------------------------------
 * فقط محاسبه و ساخت پیوند. شماره‌ها در قالب با فیلتر faDigits فارسی
 * می‌شوند؛ اینجا عدد انگلیسی می‌ماند تا محاسبه درست بماند.
 * ==========================================================================*/
import { buildQueryString } from './catalogQuery.js';

/**
 * پنجره‌ای از شماره صفحه‌ها حول صفحهٔ جاری.
 * برای کاتالوگ چندصد قلمی، نمایش همهٔ شماره‌ها بی‌فایده و شلوغ است.
 */
export function pageWindow(current, pageCount, span = 2) {
  const pages = [];
  const from = Math.max(1, current - span);
  const to = Math.min(pageCount, current + span);
  for (let i = from; i <= to; i++) pages.push(i);
  return pages;
}

/**
 * مدل کامل نوار صفحه‌بندی برای قالب.
 * @param {object} result خروجی مخزن: {page, pageCount, total}
 * @param {string} basePath مسیر صفحه، مثلا '/products'
 * @param {object} queryBase پارامترهای جاری که باید حفظ شوند
 */
export function buildPagination(result, basePath, queryBase = {}) {
  const { page, pageCount, total } = result;
  if (pageCount <= 1) return null;

  const link = (p) => basePath + buildQueryString({ ...queryBase, page: p });

  return {
    page,
    pageCount,
    total,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    prevUrl: page > 1 ? link(page - 1) : null,
    nextUrl: page < pageCount ? link(page + 1) : null,
    pages: pageWindow(page, pageCount).map((p) => ({
      number: p,
      url: link(p),
      isCurrent: p === page,
    })),
  };
}
