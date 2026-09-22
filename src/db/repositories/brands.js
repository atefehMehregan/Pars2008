/* ============================================================================
 * repositories/brands.js — دسترسی به برندها
 * ----------------------------------------------------------------------------
 * برند در این بازار مهم است: مشتری بین قطعهٔ اصل و بدل تمایز می‌گذارد و
 * اغلب مستقیم بر اساس برند فیلتر می‌کند.
 * ==========================================================================*/

const COLUMNS = 'id, name, slug, country, is_active';

/* ستون‌های سمت مدیر — شامل ردیف غیرفعال و زمان‌ها. */
const ADMIN_COLUMNS = `
  b.id, b.name, b.slug, b.country, b.is_active, b.created_at, b.updated_at`;

const UNIQUE_FIELDS = { idx_brands_slug: 'slug' };

/** خطای پایگاه داده → خطای معنادار. detail خام هرگز کپی نمی‌شود. */
function mapWriteError(err) {
  const constraint = err?.constraint ?? null;
  const make = (code, field) => {
    const mapped = new Error(`brand_write_${code}`);
    mapped.code = code;
    mapped.field = field;
    mapped.constraint = constraint;
    mapped.cause = err;
    return mapped;
  };
  if (err?.code === '23505') return make('duplicate', UNIQUE_FIELDS[constraint] ?? null);
  if (err?.code === '23503') return make('fk_missing', null);
  if (err?.code === '23001') return make('fk_restrict', null);
  if (err?.code === '23514') return make('check_failed', null);
  return err;
}

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

  /* ================================= سمت مدیر ======================== */

  /**
   * همهٔ برندها — فعال و غیرفعال — با شمار محصول‌های وابسته.
   * شمارش اینجا *همهٔ* محصول‌ها را می‌گیرد، نه فقط فعال‌ها: برای تصمیم
   * دربارهٔ حذف، محصول غیرفعال هم مانع است چون کلید خارجی RESTRICT است.
   */
  async function adminList() {
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS},
              (SELECT COUNT(*)::int FROM products p WHERE p.brand_id = b.id)
                AS product_count
       FROM brands b
       ORDER BY b.name`
    );
    return res.rows;
  }

  /** یک برند با شناسه — فعال یا غیرفعال. */
  async function findById(id) {
    if (!id) return null;
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS} FROM brands b WHERE b.id = $1 LIMIT 1`, [id]
    );
    return res.rows[0] || null;
  }

  async function create(data) {
    try {
      const res = await db.query(
        `INSERT INTO brands (name, slug, country, is_active)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [data.name, data.slug, data.country ?? null, data.isActive !== false]
      );
      return res.rows[0].id;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async function update(id, data) {
    try {
      const res = await db.query(
        `UPDATE brands SET
           name = $2, slug = $3, country = $4, is_active = $5,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, data.name, data.slug, data.country ?? null, data.isActive !== false]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /** حذف دائمی. محصول وابسته یعنی RESTRICT، و آن جلو گرفته می‌شود. */
  async function remove(id) {
    try {
      const res = await db.query('DELETE FROM brands WHERE id = $1 RETURNING id', [id]);
      return res.rows.length > 0;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async function setActive(id, isActive) {
    const res = await db.query(
      `UPDATE brands SET is_active = $2, updated_at = now()
       WHERE id = $1 RETURNING id, is_active`, [id, isActive === true]
    );
    return res.rows[0] || null;
  }

  return {
    listActive, listWithCounts, findBySlug,
    adminList, findById, create, update, remove, setActive,
  };
}
