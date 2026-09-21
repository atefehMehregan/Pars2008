/* ============================================================================
 * repositories/products.js — دسترسی به محصول‌ها
 * ----------------------------------------------------------------------------
 * چرا کارخانه (factory) و نه import مستقیم استخر اتصال؟
 *
 *   تا لایهٔ اتصال تولید (src/db/index.js با pg.Pool) دست‌نخورده بماند و
 *   در عین حال آزمون‌ها بتوانند یک اجراکنندهٔ دیگر — PGlite — تزریق کنند.
 *   معماری تولید تغییر نمی‌کند؛ فقط وابستگی از بیرون داده می‌شود.
 *
 * قاعده‌ها:
 *   * همهٔ کوئری‌ها پارامتری‌اند. هیچ مقداری داخل رشتهٔ SQL چسبانده نمی‌شود.
 *   * ترتیب و اندازهٔ صفحه از فهرست مجاز می‌آیند، نه از ورودی کاربر.
 *   * مبلغ‌ها عدد برمی‌گردند (تومان)؛ قالب‌بندی کار لایهٔ نمایش است.
 * ==========================================================================*/
import { normalizePersian } from '../../services/format.js';
import { normalizeOem } from '../../services/slug.js';

/* ترتیب‌های مجاز. کلید از کاربر می‌آید، عبارت SQL هرگز. */
const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  'price-asc': 'COALESCE(p.sale_price_toman, p.price_toman) ASC, p.id DESC',
  'price-desc': 'COALESCE(p.sale_price_toman, p.price_toman) DESC, p.id DESC',
  name: 'p.name ASC, p.id DESC',
};
export const SORT_KEYS = Object.keys(SORTS);
export const DEFAULT_SORT = 'newest';

const AVAILABILITY = ['in_stock', 'out_of_stock', 'on_order', 'discontinued'];
export const AVAILABILITY_VALUES = AVAILABILITY;

export const MAX_PER_PAGE = 60;
export const DEFAULT_PER_PAGE = 12;

/* ستون‌هایی که به بیرون داده می‌شوند. SELECT * عمدا استفاده نمی‌شود تا
   افزودن ستون داخلی در آینده ناخواسته بیرون درز نکند. */
const PRODUCT_COLUMNS = `
  p.id, p.name, p.slug, p.sku, p.oem_number,
  p.price_toman, p.sale_price_toman,
  p.stock_qty, p.availability,
  p.short_description, p.description, p.specs, p.compatibility_note,
  p.is_featured, p.is_new, p.created_at,
  p.category_id, c.name AS category_name, c.slug AS category_slug,
  p.brand_id, b.name AS brand_name, b.slug AS brand_slug,
  (SELECT i.image_id FROM product_images i
    WHERE i.product_id = p.id
    ORDER BY i.is_primary DESC, i.sort_order, i.id
    LIMIT 1) AS primary_image_id`;

const FROM_JOINS = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id`;

/* مهار مقدارهای صفحه‌بندی، یک جا برای list و search.
   ورودی بی‌معنی (منفی، صفر، غیرعددی) به پیش‌فرض برمی‌گردد — نه به ۱، که
   رفتار غافلگیرکننده‌ای بود: «perPage=-3» یعنی ورودی خراب، نه «یک قلم». */
function clampPerPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PER_PAGE;
  return Math.min(Math.trunc(n), MAX_PER_PAGE);
}

function clampPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

export function createProductRepository(db) {
  /**
   * شرط‌های WHERE را از فیلترهای اعتبارسنجی‌شده می‌سازد.
   * هر مقدار به آرایهٔ params می‌رود؛ فقط شمارهٔ جای‌نگهدار وارد SQL می‌شود.
   */
  function buildWhere(filters = {}, params = []) {
    const clauses = ['p.is_active = TRUE', 'c.is_active = TRUE'];

    if (filters.categoryId) {
      params.push(filters.categoryId);
      clauses.push(`p.category_id = $${params.length}`);
    }
    if (filters.brandId) {
      params.push(filters.brandId);
      clauses.push(`p.brand_id = $${params.length}`);
    }
    if (filters.availability && AVAILABILITY.includes(filters.availability)) {
      params.push(filters.availability);
      clauses.push(`p.availability = $${params.length}`);
    }
    if (filters.vehicleId) {
      params.push(filters.vehicleId);
      clauses.push(`EXISTS (SELECT 1 FROM product_vehicle pv
                            WHERE pv.product_id = p.id AND pv.vehicle_id = $${params.length})`);
    }
    if (filters.isFeatured === true) clauses.push('p.is_featured = TRUE');
    if (filters.isNew === true) clauses.push('p.is_new = TRUE');

    return { sql: clauses.join(' AND '), params };
  }

  /**
   * فهرست صفحه‌بندی‌شدهٔ محصول‌ها.
   * @returns {Promise<{items:object[], total:number, page:number, perPage:number, pageCount:number}>}
   */
  async function list({ filters = {}, sort = DEFAULT_SORT, page = 1, perPage = DEFAULT_PER_PAGE } = {}) {
    const orderBy = SORTS[sort] || SORTS[DEFAULT_SORT];
    const safePerPage = clampPerPage(perPage);
    const safePage = clampPage(page);

    const params = [];
    const where = buildWhere(filters, params);

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total ${FROM_JOINS} WHERE ${where.sql}`, params
    );
    const total = countRes.rows[0].total;

    const listParams = params.slice();
    listParams.push(safePerPage, (safePage - 1) * safePerPage);
    const rows = await db.query(
      `SELECT ${PRODUCT_COLUMNS} ${FROM_JOINS} WHERE ${where.sql}
       ORDER BY ${orderBy}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    return {
      items: rows.rows,
      total,
      page: safePage,
      perPage: safePerPage,
      pageCount: Math.max(1, Math.ceil(total / safePerPage)),
    };
  }

  /** یک محصول با نشانی؛ اگر نبود null. */
  async function findBySlug(slug) {
    if (!slug) return null;
    const res = await db.query(
      `SELECT ${PRODUCT_COLUMNS} ${FROM_JOINS}
       WHERE p.slug = $1 AND p.is_active = TRUE
       LIMIT 1`, [slug]
    );
    return res.rows[0] || null;
  }

  /** همهٔ تصویرهای یک محصول، به ترتیب نمایش. */
  async function imagesFor(productId) {
    const res = await db.query(
      `SELECT id, image_id, alt_text, width, height, is_primary, sort_order
       FROM product_images WHERE product_id = $1
       ORDER BY is_primary DESC, sort_order, id`, [productId]
    );
    return res.rows;
  }

  /** خودروهای سازگار با یک محصول. */
  async function vehiclesFor(productId) {
    const res = await db.query(
      `SELECT v.id, v.display_name, v.slug, pv.note
       FROM product_vehicle pv
       JOIN vehicles v ON v.id = pv.vehicle_id
       WHERE pv.product_id = $1 AND v.is_active = TRUE
       ORDER BY v.sort_order, v.id`, [productId]
    );
    return res.rows;
  }

  /**
   * جست‌وجو.
   *
   * دو مسیر جدا، چون دو رفتار متفاوت‌اند:
   *   ۱. شمارهٔ فنی / کد کالا — تطبیق دقیق یا پیشوندی روی شکل نرمال‌شده.
   *      مشتری شماره را از روی قطعه می‌خواند؛ نتیجهٔ تقریبی اینجا بی‌فایده است.
   *   ۲. نام — تطبیق سه‌نویسه‌ای، چون املا و کامل بودن نام متغیر است.
   *
   * مسیر اول اول امتحان می‌شود: اگر کاربر شماره داده، همان را می‌خواهد.
   */
  async function search({ term, page = 1, perPage = DEFAULT_PER_PAGE, sort = DEFAULT_SORT } = {}) {
    const raw = String(term ?? '').trim();
    if (!raw) return { items: [], total: 0, page: 1, perPage, pageCount: 1, matchedBy: 'none' };

    const safePerPage = clampPerPage(perPage);
    const safePage = clampPage(page);
    const offset = (safePage - 1) * safePerPage;

    /* ---- مسیر ۱: شمارهٔ فنی یا کد کالا ---- */
    const oem = normalizeOem(raw);
    if (oem && oem.length >= 4) {
      const exact = await db.query(
        `SELECT COUNT(*)::int AS total ${FROM_JOINS}
         WHERE p.is_active = TRUE AND c.is_active = TRUE
           AND (p.oem_number_normalized = $1 OR upper(p.sku) = $1
                OR p.oem_number_normalized LIKE $1 || '%')`, [oem]
      );
      if (exact.rows[0].total > 0) {
        const rows = await db.query(
          `SELECT ${PRODUCT_COLUMNS} ${FROM_JOINS}
           WHERE p.is_active = TRUE AND c.is_active = TRUE
             AND (p.oem_number_normalized = $1 OR upper(p.sku) = $1
                  OR p.oem_number_normalized LIKE $1 || '%')
           ORDER BY (p.oem_number_normalized = $1) DESC, p.name
           LIMIT $2 OFFSET $3`, [oem, safePerPage, offset]
        );
        return {
          items: rows.rows, total: exact.rows[0].total,
          page: safePage, perPage: safePerPage,
          pageCount: Math.max(1, Math.ceil(exact.rows[0].total / safePerPage)),
          matchedBy: 'part_number',
        };
      }
    }

    /* ---- مسیر ۲: نام، تطبیق تقریبی ---- */
    const needle = normalizePersian(raw).toLowerCase();
    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total ${FROM_JOINS}
       WHERE p.is_active = TRUE AND c.is_active = TRUE
         AND (p.search_text ILIKE '%' || $1 || '%' OR p.search_text % $1)`, [needle]
    );
    const total = countRes.rows[0].total;

    const rows = await db.query(
      `SELECT ${PRODUCT_COLUMNS}, similarity(p.search_text, $1) AS score ${FROM_JOINS}
       WHERE p.is_active = TRUE AND c.is_active = TRUE
         AND (p.search_text ILIKE '%' || $1 || '%' OR p.search_text % $1)
       ORDER BY (p.search_text ILIKE '%' || $1 || '%') DESC, score DESC, p.name
       LIMIT $2 OFFSET $3`, [needle, safePerPage, offset]
    );

    return {
      items: rows.rows, total,
      page: safePage, perPage: safePerPage,
      pageCount: Math.max(1, Math.ceil(total / safePerPage)),
      matchedBy: 'name',
    };
  }

  return { list, findBySlug, imagesFor, vehiclesFor, search };
}
