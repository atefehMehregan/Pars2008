/* ============================================================================
 * repositories/loginAttempts.js — تلاش‌های ورود
 * ----------------------------------------------------------------------------
 * لایهٔ بادوامِ محدودسازی ورود. محدودکنندهٔ درون-حافظه سریع است ولی با
 * راه‌اندازی دوباره پاک می‌شود؛ این یکی نمی‌شود.
 *
 * آستانه‌ها از config می‌آیند و پارامتر ورودی‌اند — هیچ عددی اینجا
 * سخت‌کد نشده است.
 * ==========================================================================*/

export function createLoginAttemptRepository(db) {
  /** ثبت یک تلاش. شناسه و آی‌پی کوتاه می‌شوند تا ورودی بلند جدول را پر نکند. */
  async function record(identifier, ip, ok) {
    await db.query(
      'INSERT INTO login_attempts (identifier, ip, ok) VALUES ($1, $2, $3)',
      [String(identifier ?? '').slice(0, 254), String(ip ?? 'unknown').slice(0, 64), Boolean(ok)]
    );
  }

  /**
   * آیا این ترکیب شناسه/آی‌پی فعلا قفل است؟
   *
   * فقط تلاش‌های *ناموفق* شمرده می‌شوند، تا ورودهای درستِ پیاپی کسی را
   * قفل نکنند. پنجرهٔ زمانی را خود PostgreSQL حساب می‌کند.
   *
   * @param {{maxPerIdentifier:number, maxPerIp:number, windowMinutes:number}} limits
   */
  async function isBlocked(identifier, ip, limits) {
    const res = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE identifier = $1)::int AS by_identifier,
         COUNT(*) FILTER (WHERE ip = $2)::int         AS by_ip
       FROM login_attempts
       WHERE ok = FALSE
         AND created_at > now() - ($3 || ' minutes')::interval`,
      [String(identifier ?? ''), String(ip ?? 'unknown'), String(limits.windowMinutes)]
    );
    const row = res.rows[0];
    return row.by_identifier >= limits.maxPerIdentifier || row.by_ip >= limits.maxPerIp;
  }

  /** شمارش تلاش‌های ناموفق — برای آزمون و گزارش. */
  async function countFailures(identifier, windowMinutes) {
    const res = await db.query(
      `SELECT COUNT(*)::int AS n FROM login_attempts
       WHERE identifier = $1 AND ok = FALSE
         AND created_at > now() - ($2 || ' minutes')::interval`,
      [String(identifier ?? ''), String(windowMinutes)]
    );
    return res.rows[0].n;
  }

  /** نظافت دوره‌ای. */
  async function purgeOlderThan(days = 30) {
    const res = await db.query(
      `DELETE FROM login_attempts WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return res.rowCount;
  }

  return { record, isBlocked, countFailures, purgeOlderThan };
}
