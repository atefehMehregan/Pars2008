/* ============================================================================
 * repositories/adminUsers.js — حساب‌های مدیر
 * ----------------------------------------------------------------------------
 * همان الگوی کارخانه/تزریق فازهای قبل.
 *
 * هیچ متدی password_hash را به بیرون نمی‌دهد مگر آنجا که برای سنجش رمز
 * لازم است (findForLogin). بقیهٔ مسیرها از publicColumns استفاده می‌کنند.
 * ==========================================================================*/

/* ستون‌های بی‌خطر برای نمایش. هش رمز اینجا نیست. */
const PUBLIC_COLUMNS = 'id, email, display_name, is_active, last_login_at, created_at';

export function createAdminUserRepository(db) {
  /**
   * حساب را برای سنجش رمز می‌آورد — تنها جایی که هش بیرون داده می‌شود.
   * جست‌وجو روی lower(email) است تا بزرگی/کوچکی حرف مهم نباشد.
   */
  async function findForLogin(email) {
    if (!email) return null;
    const res = await db.query(
      `SELECT id, email, password_hash, display_name, is_active
       FROM admin_users WHERE lower(email) = lower($1) LIMIT 1`, [email]
    );
    return res.rows[0] || null;
  }

  async function findById(id) {
    const res = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE id = $1 LIMIT 1`, [id]
    );
    return res.rows[0] || null;
  }

  async function findByEmail(email) {
    if (!email) return null;
    const res = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM admin_users WHERE lower(email) = lower($1) LIMIT 1`, [email]
    );
    return res.rows[0] || null;
  }

  /**
   * ساخت حساب مدیر.
   * رمزِ خام هرگز به اینجا نمی‌رسد — فقط هشِ از پیش ساخته‌شده.
   */
  async function create({ email, passwordHash, displayName = null }) {
    const res = await db.query(
      `INSERT INTO admin_users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_COLUMNS}`, [email, passwordHash, displayName]
    );
    return res.rows[0];
  }

  /** تغییر رمز؛ password_changed_at هم تازه می‌شود. */
  async function updatePassword(id, passwordHash) {
    const res = await db.query(
      `UPDATE admin_users
       SET password_hash = $2, password_changed_at = now(), updated_at = now()
       WHERE id = $1`, [id, passwordHash]
    );
    return res.rowCount > 0;
  }

  async function markLoggedIn(id) {
    await db.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [id]);
  }

  async function countAll() {
    const res = await db.query('SELECT COUNT(*)::int AS n FROM admin_users');
    return res.rows[0].n;
  }

  return { findForLogin, findById, findByEmail, create, updatePassword, markLoggedIn, countAll };
}
