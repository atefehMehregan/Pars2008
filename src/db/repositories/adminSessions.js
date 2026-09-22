/* ============================================================================
 * repositories/adminSessions.js — نشست‌های مدیر
 * ----------------------------------------------------------------------------
 * خودِ توکن نشست هرگز ذخیره نمی‌شود، فقط SHA-256 آن. همین برای CSRF هم
 * صادق است. اگر پایگاه داده لو برود، محتوای این جدول برای جا زدن به‌جای
 * مدیر بی‌فایده است.
 *
 * دو ساعتِ انقضا با هم اعمال می‌شوند و هر دو داخل خود کوئری‌اند، تا
 * نشستِ منقضی هیچ‌وقت — حتی برای یک لحظه — معتبر برگردانده نشود:
 *
 *   مطلق:  expires_at > now()
 *   بی‌کاری: last_seen_at > now() - idleMinutes
 * ==========================================================================*/

export function createAdminSessionRepository(db) {
  /**
   * ساخت نشست.
   * @param {object} p
   * @param {string} p.id UUID
   * @param {number} p.adminId
   * @param {string} p.tokenHash sha256 توکن
   * @param {string} p.csrfHash sha256 توکن CSRF
   * @param {Date}   p.expiresAt سقف مطلق
   */
  async function create({ id, adminId, tokenHash, csrfHash, userAgent, ip, expiresAt }) {
    const res = await db.query(
      `INSERT INTO admin_sessions
         (id, admin_id, token_hash, csrf_hash, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, admin_id, created_at, expires_at`,
      [id, adminId, tokenHash, csrfHash,
       String(userAgent ?? '').slice(0, 300), String(ip ?? '').slice(0, 64), expiresAt]
    );
    return res.rows[0];
  }

  /**
   * نشست معتبر را با هشِ توکن پیدا می‌کند.
   * شرط‌های «باطل نشده»، «منقضی نشده» و «بی‌کار نمانده» همگی داخل کوئری‌اند.
   * حساب مدیر هم باید هنوز فعال باشد — غیرفعال کردن مدیر باید بلافاصله
   * نشست‌های زنده‌اش را بی‌اثر کند، نه اینکه تا انقضا صبر کند.
   *
   * @returns {Promise<object|null>} نشست به‌همراه اطلاعات عمومی مدیر
   */
  async function findValid(tokenHash, idleMinutes) {
    if (!tokenHash) return null;
    const res = await db.query(
      `SELECT s.id, s.admin_id, s.csrf_hash, s.created_at, s.last_seen_at, s.expires_at,
              a.email, a.display_name, a.is_active
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND s.last_seen_at > now() - ($2 || ' minutes')::interval
         AND a.is_active = TRUE
       LIMIT 1`,
      [tokenHash, String(idleMinutes)]
    );
    return res.rows[0] || null;
  }

  /** تازه کردن «آخرین فعالیت» — ساعتِ بی‌کاری را عقب می‌برد. */
  async function touch(sessionId) {
    await db.query('UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
  }

  /** باطل کردن یک نشست با هشِ توکن. */
  async function revokeByTokenHash(tokenHash) {
    if (!tokenHash) return false;
    const res = await db.query(
      `UPDATE admin_sessions SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]
    );
    return res.rowCount > 0;
  }

  /** باطل کردن یک نشست با شناسه. */
  async function revokeById(sessionId) {
    const res = await db.query(
      `UPDATE admin_sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`, [sessionId]
    );
    return res.rowCount > 0;
  }

  /**
   * باطل کردن همهٔ نشست‌های یک مدیر.
   * هنگام ورود موفق صدا زده می‌شود (دفاع در برابر تثبیت نشست) و برای
   * «خروج از همه دستگاه‌ها».
   */
  async function revokeAllForAdmin(adminId) {
    const res = await db.query(
      `UPDATE admin_sessions SET revoked_at = now()
       WHERE admin_id = $1 AND revoked_at IS NULL`, [adminId]
    );
    return res.rowCount;
  }

  /** نظافت دوره‌ای: منقضی‌ها و باطل‌شده‌های قدیمی. */
  async function purge() {
    const res = await db.query(
      `DELETE FROM admin_sessions
       WHERE expires_at < now()
          OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '7 days')`
    );
    return res.rowCount;
  }

  /* --------------------------------------------------- کمکی‌های آزمون --
   * فقط برای آزمون‌هایی که باید گذشت زمان را شبیه‌سازی کنند. در مسیر
   * برنامه صدا زده نمی‌شوند.
   * ----------------------------------------------------------------------*/

  /** عقب بردن مصنوعی ساعت یک نشست. */
  async function shiftClock(sessionId, { createdMinutesAgo, lastSeenMinutesAgo, expiresMinutesFromNow }) {
    const sets = [];
    const params = [sessionId];
    if (createdMinutesAgo !== undefined) {
      params.push(String(createdMinutesAgo));
      sets.push(`created_at = now() - ($${params.length} || ' minutes')::interval`);
    }
    if (lastSeenMinutesAgo !== undefined) {
      params.push(String(lastSeenMinutesAgo));
      sets.push(`last_seen_at = now() - ($${params.length} || ' minutes')::interval`);
    }
    if (expiresMinutesFromNow !== undefined) {
      params.push(String(expiresMinutesFromNow));
      sets.push(`expires_at = now() + ($${params.length} || ' minutes')::interval`);
    }
    if (!sets.length) return;
    await db.query(`UPDATE admin_sessions SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  async function findRawById(sessionId) {
    const res = await db.query('SELECT * FROM admin_sessions WHERE id = $1', [sessionId]);
    return res.rows[0] || null;
  }

  async function countLiveForAdmin(adminId) {
    const res = await db.query(
      `SELECT COUNT(*)::int AS n FROM admin_sessions
       WHERE admin_id = $1 AND revoked_at IS NULL`, [adminId]
    );
    return res.rows[0].n;
  }

  return {
    create, findValid, touch,
    revokeByTokenHash, revokeById, revokeAllForAdmin, purge,
    shiftClock, findRawById, countLiveForAdmin,
  };
}
