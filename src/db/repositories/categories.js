/* ============================================================================
 * repositories/categories.js — دسترسی به دسته‌ها
 * ----------------------------------------------------------------------------
 * همان الگوی کارخانه: اجراکنندهٔ کوئری از بیرون تزریق می‌شود تا لایهٔ
 * اتصال تولید دست‌نخورده بماند و آزمون بتواند PGlite بدهد.
 * ==========================================================================*/

const COLUMNS = 'id, name, slug, parent_id, description, sort_order, is_active';

/* ستون‌های سمت مدیر — شامل ردیف غیرفعال و زمان‌ها. */
const ADMIN_COLUMNS = `
  c.id, c.name, c.slug, c.parent_id, c.description, c.sort_order, c.is_active,
  c.created_at, c.updated_at`;

const UNIQUE_FIELDS = { idx_categories_slug: 'slug' };
const FK_FIELDS = { categories_parent_id_fkey: 'parentId' };

/** خطای پایگاه داده → خطای معنادار. detail خام هرگز کپی نمی‌شود. */
function mapWriteError(err) {
  const constraint = err?.constraint ?? null;
  const make = (code, field) => {
    const mapped = new Error(`category_write_${code}`);
    mapped.code = code;
    mapped.field = field;
    mapped.constraint = constraint;
    mapped.cause = err;
    return mapped;
  };
  if (err?.code === '23505') return make('duplicate', UNIQUE_FIELDS[constraint] ?? null);
  if (err?.code === '23503') return make('fk_missing', FK_FIELDS[constraint] ?? null);
  if (err?.code === '23001') return make('fk_restrict', null);
  if (err?.code === '23514') return make('check_failed', null);
  return err;
}

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

  /* ================================= سمت مدیر ======================== */

  /**
   * همهٔ دسته‌ها — فعال و غیرفعال — با نام والد و شمارش‌ها.
   * شمارش فرزند و محصول برای صفحهٔ تأیید حذف لازم است: پیش از آنکه
   * پایگاه داده با RESTRICT جلو را بگیرد، باید بشود به کاربر گفت چرا.
   */
  async function adminList() {
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS},
              parent.name AS parent_name,
              (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id)
                AS product_count,
              (SELECT COUNT(*)::int FROM categories ch WHERE ch.parent_id = c.id)
                AS child_count
       FROM categories c
       LEFT JOIN categories parent ON parent.id = c.parent_id
       ORDER BY c.sort_order, c.name`
    );
    return res.rows;
  }

  /** یک دسته با شناسه — فعال یا غیرفعال. */
  async function findById(id) {
    if (!id) return null;
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS} FROM categories c WHERE c.id = $1 LIMIT 1`, [id]
    );
    return res.rows[0] || null;
  }

  /**
   * آیا گذاشتن parentId به‌عنوان والدِ id یک حلقه می‌سازد؟
   *
   * قید categories_not_own_parent فقط حالت «والدِ خودش» را می‌گیرد؛
   * حلقهٔ الف ← ب ← الف از دستش در می‌رود و درخت را برای همیشه خراب
   * می‌کند. اینجا از parentId رو به بالا راه می‌رویم و می‌بینیم آیا به
   * id می‌رسیم یا نه.
   *
   * بند depth < 100 یک ترمز ایمنی است: اگر داده‌ای از قبل حلقه داشته
   * باشد، کوئری بازگشتی بی‌آن تا ابد می‌چرخد.
   */
  async function wouldCreateCycle(id, parentId) {
    if (!id || !parentId) return false;
    if (String(id) === String(parentId)) return true;
    const res = await db.query(
      `WITH RECURSIVE up (id, parent_id, depth) AS (
         SELECT c.id, c.parent_id, 1
           FROM categories c WHERE c.id = $1
         UNION ALL
         SELECT c.id, c.parent_id, up.depth + 1
           FROM categories c
           JOIN up ON c.id = up.parent_id
          WHERE up.depth < 100
       )
       SELECT 1 FROM up WHERE id = $2 LIMIT 1`, [parentId, id]
    );
    return res.rows.length > 0;
  }

  async function create(data) {
    try {
      const res = await db.query(
        `INSERT INTO categories (name, slug, parent_id, description, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [data.name, data.slug, data.parentId ?? null, data.description ?? null,
         data.sortOrder ?? 0, data.isActive !== false]
      );
      return res.rows[0].id;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async function update(id, data) {
    try {
      const res = await db.query(
        `UPDATE categories SET
           name = $2, slug = $3, parent_id = $4, description = $5,
           sort_order = $6, is_active = $7,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, data.name, data.slug, data.parentId ?? null, data.description ?? null,
         data.sortOrder ?? 0, data.isActive !== false]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * حذف دائمی.
   * اگر محصولی یا زیردسته‌ای وابسته باشد، ON DELETE RESTRICT جلو را
   * می‌گیرد و خطای fk_restrict بالا می‌رود. این رفتار درست است و دور
   * زده نمی‌شود.
   */
  async function remove(id) {
    try {
      const res = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
      return res.rows.length > 0;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async function setActive(id, isActive) {
    const res = await db.query(
      `UPDATE categories SET is_active = $2, updated_at = now()
       WHERE id = $1 RETURNING id, is_active`, [id, isActive === true]
    );
    return res.rows[0] || null;
  }

  return {
    listActive, listWithCounts, findBySlug, childrenOf,
    adminList, findById, create, update, remove, setActive, wouldCreateCycle,
  };
}
