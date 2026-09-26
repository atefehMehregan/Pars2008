/* ============================================================================
 * repositories/vehicles.js — دسترسی به خودروها
 * ----------------------------------------------------------------------------
 * خودرو محور سازگاری است: مشتری قطعه را برای خودروی *خودش* می‌خواهد، و
 * جدول product_vehicle همین را می‌گوید.
 *
 * همان الگوی کارخانه/تزریق بقیهٔ مخزن‌ها. ستون‌های توصیفی (نسل، کد موتور،
 * بازهٔ سال) عمدا NULL‌پذیرند و این لایه هیچ مقدار پیش‌فرضی برایشان
 * نمی‌سازد: دادهٔ کسب‌وکار است و فقط از مدیر می‌آید.
 * ==========================================================================*/

const COLUMNS = `
  id, make, model, generation, year_from, year_to, engine_code, engine_label,
  slug, display_name, sort_order, is_active`;

/* ستون‌های سمت مدیر — شامل ردیف غیرفعال و زمان‌ها. */
const ADMIN_COLUMNS = `
  v.id, v.make, v.model, v.generation, v.year_from, v.year_to,
  v.engine_code, v.engine_label, v.slug, v.display_name,
  v.sort_order, v.is_active, v.created_at, v.updated_at`;

const UNIQUE_FIELDS = { idx_vehicles_slug: 'slug' };

/** خطای پایگاه داده → خطای معنادار. detail خام هرگز کپی نمی‌شود. */
function mapWriteError(err) {
  const constraint = err?.constraint ?? null;
  const make = (code, field) => {
    const mapped = new Error(`vehicle_write_${code}`);
    mapped.code = code;
    mapped.field = field;
    mapped.constraint = constraint;
    mapped.cause = err;
    return mapped;
  };
  if (err?.code === '23505') return make('duplicate', UNIQUE_FIELDS[constraint] ?? null);
  if (err?.code === '23503') return make('fk_missing', null);
  /* حذف خودرویی که هنوز به محصولی وصل است: ON DELETE RESTRICT. */
  if (err?.code === '23001') return make('fk_restrict', null);
  if (err?.code === '23514') return make('check_failed', null);
  return err;
}

export function createVehicleRepository(db) {
  /** همهٔ خودروهای فعال، به ترتیب نمایش. */
  async function listActive() {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM vehicles
       WHERE is_active = TRUE
       ORDER BY sort_order, display_name`
    );
    return res.rows;
  }

  /**
   * خودروهای فعال به‌همراه شمار محصول‌های فعالِ سازگار.
   * LEFT JOIN تا خودروی بی‌محصول هم با صفر بیاید — نمایش «۰ محصول»
   * صادقانه‌تر از حذف بی‌سروصدای آن است.
   */
  async function listWithCounts() {
    const res = await db.query(
      `SELECT v.id, v.slug, v.display_name, v.sort_order,
              COUNT(p.id) FILTER (WHERE p.is_active) ::int AS product_count
       FROM vehicles v
       LEFT JOIN product_vehicle pv ON pv.vehicle_id = v.id
       LEFT JOIN products p ON p.id = pv.product_id
       WHERE v.is_active = TRUE
       GROUP BY v.id
       ORDER BY v.sort_order, v.display_name`
    );
    return res.rows;
  }

  /** یک خودرو با نشانی؛ اگر نبود یا غیرفعال بود null. */
  async function findBySlug(slug) {
    if (!slug) return null;
    const res = await db.query(
      `SELECT ${COLUMNS} FROM vehicles
       WHERE slug = $1 AND is_active = TRUE LIMIT 1`, [slug]
    );
    return res.rows[0] || null;
  }

  /* ================================= سمت مدیر ======================== */

  /**
   * همهٔ خودروها — فعال و غیرفعال — با شمار محصول‌های وابسته.
   * شمارش *همهٔ* محصول‌ها را می‌گیرد، نه فقط فعال‌ها: برای تصمیم دربارهٔ
   * حذف، محصول غیرفعال هم مانع است چون کلید خارجی RESTRICT است.
   */
  async function adminList() {
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS},
              (SELECT COUNT(*)::int FROM product_vehicle pv WHERE pv.vehicle_id = v.id)
                AS product_count
       FROM vehicles v
       ORDER BY v.sort_order, v.display_name`
    );
    return res.rows;
  }

  /** یک خودرو با شناسه — فعال یا غیرفعال. */
  async function findById(id) {
    if (!id) return null;
    const res = await db.query(
      `SELECT ${ADMIN_COLUMNS} FROM vehicles v WHERE v.id = $1 LIMIT 1`, [id]
    );
    return res.rows[0] || null;
  }

  /**
   * از میان شناسه‌های داده‌شده، آن‌هایی که واقعا در جدول هستند.
   *
   * چرا لازم است: مدیر می‌تواند فرم محصول را باز بگذارد و در همان فاصله
   * مدیر دیگری خودرویی را که به هیچ محصولی وصل نبود حذف کند. آن فرمِ
   * کهنه شناسه‌ای می‌فرستد که دیگر وجود ندارد. با این کوئری آن حالت
   * *پیش از* نوشتن محصول دیده می‌شود، نه به شکل خطای کلید خارجی پس از آن.
   *
   * فعال و غیرفعال هر دو «موجود» شمرده می‌شوند، چون فرم مدیر عمدا
   * خودروی غیرفعال را هم برای انتخاب نشان می‌دهد.
   *
   * @param {Array<number|string>} ids
   * @returns {Promise<number[]>} زیرمجموعهٔ موجود
   */
  async function existingIds(ids) {
    const list = (Array.isArray(ids) ? ids : [])
      .map((v) => Number(v))
      .filter((v) => Number.isSafeInteger(v) && v > 0);
    if (!list.length) return [];
    const res = await db.query(
      'SELECT id FROM vehicles WHERE id = ANY($1::bigint[])', [list]);
    return res.rows.map((r) => Number(r.id));
  }

  async function create(data) {
    try {
      const res = await db.query(
        `INSERT INTO vehicles
           (make, model, generation, year_from, year_to, engine_code, engine_label,
            slug, display_name, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [data.make, data.model, data.generation ?? null,
         data.yearFrom ?? null, data.yearTo ?? null,
         data.engineCode ?? null, data.engineLabel ?? null,
         data.slug, data.displayName, data.sortOrder ?? 0, data.isActive !== false]
      );
      return res.rows[0].id;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * به‌روزرسانی کامل.
   *
   * display_name همان چیزی ذخیره می‌شود که مدیر فرستاده است؛ اینجا از
   * روی make/model بازسازی نمی‌شود. پیش‌پر کردن کار فرم است، نه این لایه.
   */
  async function update(id, data) {
    try {
      const res = await db.query(
        `UPDATE vehicles SET
           make = $2, model = $3, generation = $4,
           year_from = $5, year_to = $6,
           engine_code = $7, engine_label = $8,
           slug = $9, display_name = $10,
           sort_order = $11, is_active = $12,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id, data.make, data.model, data.generation ?? null,
         data.yearFrom ?? null, data.yearTo ?? null,
         data.engineCode ?? null, data.engineLabel ?? null,
         data.slug, data.displayName, data.sortOrder ?? 0, data.isActive !== false]
      );
      return res.rows[0]?.id ?? null;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  /**
   * حذف دائمی.
   * اگر محصولی به این خودرو وصل باشد، ON DELETE RESTRICT جلو را می‌گیرد
   * و خطای fk_restrict بالا می‌رود. این رفتار درست است و دور زده نمی‌شود.
   */
  async function remove(id) {
    try {
      const res = await db.query('DELETE FROM vehicles WHERE id = $1 RETURNING id', [id]);
      return res.rows.length > 0;
    } catch (err) {
      throw mapWriteError(err);
    }
  }

  async function setActive(id, isActive) {
    const res = await db.query(
      `UPDATE vehicles SET is_active = $2, updated_at = now()
       WHERE id = $1 RETURNING id, is_active`, [id, isActive === true]
    );
    return res.rows[0] || null;
  }

  return {
    listActive, listWithCounts, findBySlug,
    adminList, findById, existingIds, create, update, remove, setActive,
  };
}
