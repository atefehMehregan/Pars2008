/* ============================================================================
 * repositories/brands.js — دسترسی به برندها
 * ----------------------------------------------------------------------------
 * برند در این بازار مهم است: مشتری بین قطعهٔ اصل و بدل تمایز می‌گذارد و
 * اغلب مستقیم بر اساس برند فیلتر می‌کند.
 * ==========================================================================*/

const COLUMNS = 'id, name, slug, country, is_active';

export function createBrandRepository(db) {
  async function listActive() {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM brands WHERE is_active = TRUE ORDER BY name`
    );
    return res.rows;
  }

  /** برندهایی که دست‌کم یک محصول فعال دارند — برای نوار فیلتر. */
  async function listWithCounts() {
    const res = await db.query(
      `SELECT b.id, b.name, b.slug,
              COUNT(p.id) FILTER (WHERE p.is_active) ::int AS product_count
       FROM brands b
       LEFT JOIN products p ON p.brand_id = b.id
       WHERE b.is_active = TRUE
       GROUP BY b.id
       ORDER BY b.name`
    );
    return res.rows;
  }

  async function findBySlug(slug) {
    if (!slug) return null;
    const res = await db.query(
      `SELECT ${COLUMNS} FROM brands WHERE slug = $1 AND is_active = TRUE LIMIT 1`, [slug]
    );
    return res.rows[0] || null;
  }

  return { listActive, listWithCounts, findBySlug };
}
