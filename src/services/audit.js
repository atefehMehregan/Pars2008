/* ============================================================================
 * services/audit.js — رد پای اقدام‌های مدیر
 * ----------------------------------------------------------------------------
 * از همین فاز نوشته می‌شود، هرچند فعلا فقط رویدادهای احراز هویت را دارد.
 * در سامانه‌ای که بعدا سفارش و پرداخت می‌گیرد، نباید بازه‌ای وجود داشته
 * باشد که «چه کسی، چه وقت، چه کرد؟» بی‌پاسخ بماند.
 *
 * قاعده: نوشتن رد پا هرگز نباید عملیات اصلی را بشکند. اگر ثبت شکست خورد،
 * در لاگ سرور می‌ماند ولی ورودِ موفق کاربر را باطل نمی‌کند.
 * ==========================================================================*/

/** کنش‌های شناخته‌شده. رشتهٔ آزاد استفاده نمی‌شود تا گزارش‌گیری ممکن بماند. */
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'admin.login.success',
  LOGIN_FAILED: 'admin.login.failed',
  LOGIN_BLOCKED: 'admin.login.blocked',
  LOGOUT: 'admin.logout',
  ADMIN_CREATED: 'admin.created',
  PASSWORD_CHANGED: 'admin.password.changed',

  /* کاتالوگ. جداسازی «فعال/غیرفعال» از «حذف» عمدی است: اولی بازگشت‌پذیر
     است و دومی نیست، و گزارش بعدی باید بتواند این دو را از هم جدا کند. */
  PRODUCT_CREATED: 'catalog.product.created',
  PRODUCT_UPDATED: 'catalog.product.updated',
  PRODUCT_DELETED: 'catalog.product.deleted',
  PRODUCT_ACTIVE_CHANGED: 'catalog.product.active',
  PRODUCT_STOCK_CHANGED: 'catalog.product.stock',

  /* تصویر محصول — فاز ۵. «افزودن» از «حذف» جدا می‌ماند چون دومی
     برگشت‌ناپذیر است و گزارش بعدی باید این دو را از هم جدا کند. */
  PRODUCT_IMAGE_ADDED: 'catalog.product.image.added',
  PRODUCT_IMAGE_UPDATED: 'catalog.product.image.updated',
  PRODUCT_IMAGE_PRIMARY: 'catalog.product.image.primary',
  PRODUCT_IMAGE_DELETED: 'catalog.product.image.deleted',

  CATEGORY_CREATED: 'catalog.category.created',
  CATEGORY_UPDATED: 'catalog.category.updated',
  CATEGORY_DELETED: 'catalog.category.deleted',
  CATEGORY_ACTIVE_CHANGED: 'catalog.category.active',

  BRAND_CREATED: 'catalog.brand.created',
  BRAND_UPDATED: 'catalog.brand.updated',
  BRAND_DELETED: 'catalog.brand.deleted',
  BRAND_ACTIVE_CHANGED: 'catalog.brand.active',

  /* خودرو — فاز ۶. سازگاری محصول با خودرو جداگانه ثبت می‌شود چون
     تغییرش روی آنچه مشتری می‌بیند اثر مستقیم دارد. */
  VEHICLE_CREATED: 'catalog.vehicle.created',
  VEHICLE_UPDATED: 'catalog.vehicle.updated',
  VEHICLE_DELETED: 'catalog.vehicle.deleted',
  VEHICLE_ACTIVE_CHANGED: 'catalog.vehicle.active',
  PRODUCT_VEHICLES_CHANGED: 'catalog.product.vehicles',
};

export function createAuditLog(db) {
  /**
   * ثبت یک رویداد.
   * @param {object} p
   * @param {number|null} p.adminId شناسهٔ مدیر، یا null وقتی حساب ناشناخته بوده
   * @param {string} p.action یکی از AUDIT_ACTIONS
   * @param {object} [p.detail] جزئیات بی‌خطر — هرگز رمز یا توکن
   */
  async function record({ adminId = null, action, entity = null, entityId = null, detail = {}, ip = null }) {
    try {
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, detail, ip)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [adminId, action, entity, entityId === null ? null : String(entityId),
         JSON.stringify(detail ?? {}), ip === null ? null : String(ip).slice(0, 64)]
      );
    } catch (err) {
      /* ثبت نشد، ولی عملیات اصلی نباید بشکند. */
      console.error('[audit] ثبت نشد:', err.message);
    }
  }

  /** آخرین رویدادها — برای داشبورد و آزمون. */
  async function recent({ limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 200);
    const res = await db.query(
      `SELECT l.id, l.admin_id, l.action, l.entity, l.entity_id, l.detail, l.ip, l.created_at,
              a.email AS admin_email
       FROM admin_audit_log l
       LEFT JOIN admin_users a ON a.id = l.admin_id
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $1`, [safeLimit]
    );
    return res.rows;
  }

  async function countByAction(action) {
    const res = await db.query(
      'SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action = $1', [action]);
    return res.rows[0].n;
  }

  return { record, recent, countByAction };
}
