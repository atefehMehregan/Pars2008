/* ============================================================================
 * db/index.js — اتصال PostgreSQL
 * ----------------------------------------------------------------------------
 * تنها پایگاه داده پشتیبانی‌شده PostgreSQL است.
 *
 * قاعده‌های این لایه:
 *   * همه کوئری‌ها پارامتری‌اند ($1, $2, ...). چسباندن مقدار داخل رشته SQL
 *     ممنوع است؛ این تنها دفاع واقعی در برابر SQL injection است.
 *   * اتصال تنبل (lazy) ساخته می‌شود تا import کردن این ماژول به‌تنهایی
 *     تلاشی برای اتصال نکند — آزمون‌ها به همین وابسته‌اند.
 *   * هیچ اعتبارنامه‌ای در لاگ یا پیام خطا بیرون نمی‌رود.
 * ==========================================================================*/
import pg from 'pg';
import { config, assertDatabaseConfigured } from '../config/index.js';

/* BIGINT (int8) به‌صورت پیش‌فرض رشته برمی‌گردد چون ممکن است از
   Number.MAX_SAFE_INTEGER بزرگ‌تر باشد. مبلغ‌های ما (تومان) در این محدوده
   نیستند، پس تبدیل به عدد امن است و کار مصرف‌کننده را ساده می‌کند. */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

let pool = null;

/** رشته اتصال را برای نمایش/لاگ بی‌خطر می‌کند (رمز حذف می‌شود). */
export function redactConnectionString(url) {
  if (!url) return '(تعریف‌نشده)';
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    if (u.username) u.username = u.username ? '****' : '';
    return u.toString();
  } catch {
    /* اگر رشته قابل تجزیه نبود، هیچ بخشی از آن را برنمی‌گردانیم. */
    return '(رشته اتصال نامعتبر)';
  }
}

/** استخر اتصال را می‌سازد (یک بار). */
export function getPool() {
  if (pool) return pool;
  assertDatabaseConfigured();

  pool = new pg.Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl,
    max: config.database.poolMax,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
  });

  /* خطای استخر نباید کل پروسه را بکشد. */
  pool.on('error', (err) => {
    console.error('[db] خطای استخر اتصال:', err.message);
  });

  return pool;
}

/**
 * اجرای کوئری پارامتری.
 * @param {string} text با جای‌نگهدار $1، $2 ...
 * @param {Array} [params]
 */
export async function query(text, params) {
  return getPool().query(text, params);
}

/** یک سطر یا undefined. */
export async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

/** اجرای چند دستور داخل یک تراکنش. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* اتصال از دست رفته */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * بررسی سلامت پایگاه داده.
 * هرگز رشته اتصال یا اعتبارنامه برنمی‌گرداند — فقط وضعیت و زمان پاسخ.
 * @returns {Promise<{status:'up'|'down'|'not_configured', latencyMs?:number, error?:string}>}
 */
export async function checkDatabaseHealth() {
  if (!config.database.url) return { status: 'not_configured' };
  const started = Date.now();
  try {
    const result = await query('SELECT 1 AS ok');
    if (result.rows[0]?.ok !== 1) return { status: 'down', error: 'پاسخ غیرمنتظره' };
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (err) {
    /* فقط پیام کوتاه؛ هیچ جزئیات اتصالی بیرون نمی‌رود. */
    return { status: 'down', error: err.code || 'اتصال برقرار نشد' };
  }
}

/** بستن استخر — برای خاموش‌شدن تمیز و پایان آزمون‌ها. */
export async function closeDb() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/** فقط برای آزمون: آیا استخری ساخته شده است؟ */
export function isPoolCreated() {
  return pool !== null;
}
