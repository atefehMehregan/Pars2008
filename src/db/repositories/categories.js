/* ============================================================================
 * repositories/categories.js — دسترسی به دسته‌ها
 * ----------------------------------------------------------------------------
 * همان الگوی کارخانه: اجراکنندهٔ کوئری از بیرون تزریق می‌شود تا لایهٔ
 * اتصال تولید دست‌نخورده بماند و آزمون بتواند PGlite بدهد.
 * ==========================================================================*/

const COLUMNS = 'id, name, slug, parent_id, description, sort_order, is_active';

export function createCategoryRepository(db) {
  /** همهٔ دسته‌های فعال، به ترتیب نمایش. */
  async function listActive() {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM categories
       WHERE is_active = TRUE
       ORDER BY sort_order, name`
    );
    return res.rows;
  }

  /**
   * دسته‌های فعال به‌همراه تعداد محصول فعال هر کدام.
   * شمارش با LEFT JOIN انجام می‌شود تا دستهٔ خالی هم با تعداد صفر بیاید —
   * نمایش «۰ محصول» صادقانه‌تر از حذف بی‌سروصدای دسته است.
   */
  async function listWithCounts() {
    const res = await db.query(
      `SELECT c.id, c.name, c.slug, c.parent_id, c.sort_order,
              COUNT(p.id) FILTER (WHERE p.is_active) ::int AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       WHERE c.is_active = TRUE
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`
    );
    return res.rows;
  }

  /** یک دسته با نشانی؛ اگر نبود یا غیرفعال بود null. */
  async function findBySlug(slug) {
    if (!slug) return null;
    const res = await db.query(
      `SELECT ${COLUMNS} FROM categories
       WHERE slug = $1 AND is_active = TRUE LIMIT 1`, [slug]
    );
    return res.rows[0] || null;
  }

  /** زیردسته‌های یک دسته (برای سطح دوم، اگر روزی استفاده شود). */
  async function childrenOf(parentId) {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM categories
       WHERE parent_id = $1 AND is_active = TRUE
       ORDER BY sort_order, name`, [parentId]
    );
    return res.rows;
  }

  return { listActive, listWithCounts, findBySlug, childrenOf };
}
