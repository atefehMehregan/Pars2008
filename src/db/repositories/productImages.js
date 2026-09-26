/* ============================================================================
 * repositories/productImages.js — تصویرهای محصول
 * ----------------------------------------------------------------------------
 * همان الگوی کارخانه/تزریق بقیهٔ مخزن‌ها.
 *
 * دو ثابت که این لایه نگه می‌دارد:
 *
 *   ۱. هر محصول حداکثر *یک* تصویر اصلی دارد. این را ایندکس جزئیِ
 *      idx_product_images_one_primary در پایگاه داده تضمین می‌کند و
 *      اینجا فقط با آن هم‌کار می‌شویم، نه اینکه تقلیدش کنیم.
 *
 *   ۲. جابه‌جایی تصویر اصلی در *یک* دستور SQL انجام می‌شود، نه دو تا.
 *      دلیل فنی مهم: db.query روی استخر pg هر بار ممکن است اتصال
 *      دیگری بگیرد، پس BEGIN/COMMIT دستی در این لایه می‌توانست روی دو
 *      اتصال متفاوت بیفتد و بی‌اثر بماند. یک دستورِ اتمی این تله را
 *      کامل دور می‌زند.
 *
 * هیچ بایتی از اینجا رد نمی‌شود — این لایه فقط ردیف می‌شناسد. پاک کردن
 * فایل کار لایهٔ ذخیره‌سازی است و ترتیبش در کنترلر تعیین می‌شود.
 * ==========================================================================*/

const COLUMNS = 'id, product_id, image_id, alt_text, width, height, sort_order, is_primary, created_at';

export function createProductImageRepository(db) {
  /** همهٔ تصویرهای یک محصول، به ترتیب نمایش. */
  async function listForProduct(productId) {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM product_images
       WHERE product_id = $1
       ORDER BY is_primary DESC, sort_order, id`, [productId]
    );
    return res.rows;
  }

  async function countForProduct(productId) {
    const res = await db.query(
      'SELECT COUNT(*)::int AS n FROM product_images WHERE product_id = $1', [productId]);
    return res.rows[0].n;
  }

  /** شناسهٔ همهٔ تصویرهای یک محصول — برای نظافت فایل‌ها پیش از حذف محصول. */
  async function imageIdsForProduct(productId) {
    const res = await db.query(
      'SELECT image_id FROM product_images WHERE product_id = $1', [productId]);
    return res.rows.map((r) => r.image_id);
  }

  async function findOne(productId, imageId) {
    const res = await db.query(
      `SELECT ${COLUMNS} FROM product_images
       WHERE product_id = $1 AND image_id = $2 LIMIT 1`, [productId, imageId]
    );
    return res.rows[0] || null;
  }

  /**
   * افزودن یک تصویر.
   *
   * sort_order اگر داده نشود، انتهای فهرست می‌نشیند. is_primary عمدا
   * پارامتر است و نه تصمیمِ این لایه: قاعدهٔ «اولین تصویر، اصلی است»
   * تصمیمِ کنترلر است و آنجا آزمون می‌شود.
   */
  async function add({ productId, imageId, altText = null, width = null, height = null,
    sortOrder = null, isPrimary = false }) {
    const order = sortOrder === null
      ? (await db.query(
        'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM product_images WHERE product_id = $1',
        [productId])).rows[0].next
      : sortOrder;

    const res = await db.query(
      `INSERT INTO product_images
         (product_id, image_id, alt_text, width, height, sort_order, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${COLUMNS}`,
      [productId, imageId, altText, width, height, order, isPrimary === true]
    );
    return res.rows[0];
  }

  /**
   * تعیین تصویر اصلی — اول خاموش کردن قبلی، بعد روشن کردن تازه.
   *
   * چرا دو دستور و نه یکی؟
   *
   *   شکل قبلی یک دستور بود:
   *     UPDATE … SET is_primary = (image_id = $2) WHERE product_id = $1
   *   و *گاهی* کار می‌کرد. PostgreSQL یکتایی را حین اجرای دستور و ردیف
   *   به ردیف می‌سنجد، نه در پایان آن؛ پس لحظه‌ای پیش می‌آید که هم ردیف
   *   تازه و هم ردیف قبلی is_primary دارند و ایندکس جزئیِ
   *   idx_product_images_one_primary با خطای 23505 رد می‌کند.
   *
   *   در عمل: نخستین جابه‌جایی روی ردیف‌های تازه‌درج‌شده رد می‌شد، و هر
   *   جابه‌جایی بعدی شکست می‌خورد — یعنی «اصلی کردن» بار دوم به صفحهٔ
   *   خطای ۵۰۰ می‌رسید.
   *
   *   قید DEFERRABLE این را حل می‌کرد، ولی ایندکسِ *جزئی* قابل تعویق
   *   نیست (تعویق فقط برای قید جدول است، و UNIQUE … WHERE را نمی‌شود
   *   به‌صورت قید نوشت). پس ترتیب را خودمان تضمین می‌کنیم: هیچ‌وقت دو
   *   ردیف هم‌زمان اصلی نمی‌شوند.
   *
   * اتمی بودن: اگر اجراکننده تراکنش داشته باشد (لایهٔ تولید دارد) هر دو
   * دستور در یک تراکنش می‌روند، پس هیچ پنجره‌ای نمی‌ماند که محصول
   * بی‌تصویرِ اصلی بماند. PGlite یک اتصال دارد و ترتیب در آن تضمین است.
   *
   * @returns {Promise<boolean>} آیا تصویری با این شناسه بود؟
   */
  async function setPrimary(productId, imageId) {
    const exists = await findOne(productId, imageId);
    if (!exists) return false;
    /* از قبل اصلی است: کاری لازم نیست و هیچ ردیفی بازنویسی نمی‌شود. */
    if (exists.is_primary === true) return true;

    const clearSql = `UPDATE product_images SET is_primary = FALSE
                       WHERE product_id = $1 AND is_primary AND image_id <> $2`;
    const setSql = `UPDATE product_images SET is_primary = TRUE
                     WHERE product_id = $1 AND image_id = $2`;

    if (typeof db.withTransaction === 'function') {
      await db.withTransaction(async (client) => {
        await client.query(clearSql, [productId, imageId]);
        await client.query(setSql, [productId, imageId]);
      });
    } else {
      await db.query(clearSql, [productId, imageId]);
      await db.query(setSql, [productId, imageId]);
    }
    return true;
  }

  /**
   * اگر محصول تصویر اصلی ندارد ولی تصویر دارد، کم‌ترین sort_order را
   * اصلی می‌کند.
   *
   * پس از حذف تصویر اصلی صدا زده می‌شود، و چون بی‌اثرپذیر است می‌شود
   * بدون ترس دوباره اجرایش کرد.
   *
   * @returns {Promise<string|null>} شناسهٔ تصویری که اصلی شد، یا null
   */
  async function promotePrimaryIfMissing(productId) {
    const current = await db.query(
      'SELECT 1 FROM product_images WHERE product_id = $1 AND is_primary LIMIT 1', [productId]);
    if (current.rows.length > 0) return null;

    const next = await db.query(
      `SELECT image_id FROM product_images
       WHERE product_id = $1
       ORDER BY sort_order, id
       LIMIT 1`, [productId]
    );
    if (next.rows.length === 0) return null;

    const imageId = next.rows[0].image_id;
    await db.query(
      'UPDATE product_images SET is_primary = TRUE WHERE product_id = $1 AND image_id = $2',
      [productId, imageId]
    );
    return imageId;
  }

  /** متن جایگزین. خالی یعنی NULL، نه رشتهٔ خالی. */
  async function updateAlt(productId, imageId, altText) {
    const value = (altText ?? '').trim();
    const res = await db.query(
      `UPDATE product_images SET alt_text = $3
       WHERE product_id = $1 AND image_id = $2
       RETURNING ${COLUMNS}`,
      [productId, imageId, value === '' ? null : value]
    );
    return res.rows[0] || null;
  }

  /**
   * ترتیب تازه، در یک دستور.
   *
   * شناسه‌هایی که به این محصول تعلق ندارند بی‌اثرند، چون شرط WHERE هم
   * product_id را می‌سنجد. شناسهٔ جاافتاده هم مشکلی نمی‌سازد: ردیفش
   * سر جای قبلی‌اش می‌ماند.
   *
   * @returns {Promise<number>} شمار ردیف‌های جابه‌جا شده
   */
  async function reorder(productId, imageIds) {
    const ids = Array.isArray(imageIds) ? imageIds.filter((v) => typeof v === 'string') : [];
    if (ids.length === 0) return 0;

    const res = await db.query(
      `UPDATE product_images AS pi
          SET sort_order = v.ord
         FROM (SELECT unnest($2::text[]) AS iid,
                      generate_subscripts($2::text[], 1) - 1 AS ord) AS v
        WHERE pi.product_id = $1 AND pi.image_id = v.iid
        RETURNING pi.id`,
      [productId, ids]
    );
    return res.rows.length;
  }

  /**
   * حذف یک تصویر.
   *
   * ردیفِ حذف‌شده برگردانده می‌شود تا کنترلر بداند آیا اصلی بوده (و
   * باید جانشین انتخاب کند) و کدام فایل‌ها را باید پاک کند.
   *
   * @returns {Promise<object|null>}
   */
  async function remove(productId, imageId) {
    const res = await db.query(
      `DELETE FROM product_images
       WHERE product_id = $1 AND image_id = $2
       RETURNING ${COLUMNS}`, [productId, imageId]
    );
    return res.rows[0] || null;
  }

  return {
    listForProduct, countForProduct, imageIdsForProduct, findOne,
    add, setPrimary, promotePrimaryIfMissing, updateAlt, reorder, remove,
  };
}
