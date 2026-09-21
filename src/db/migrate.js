/* ============================================================================
 * db/migrate.js — اجرای مهاجرت‌های پایگاه داده
 * ----------------------------------------------------------------------------
 * چرا دست‌ساز و نه یک کتابخانه؟ مهاجرت‌ها فایل‌های ساده SQL‌اند و شفافیت
 * کامل مهم‌تر از امکانات اضافه است: هر کسی با خواندن پوشه migrations دقیقا
 * می‌داند چه چیزی روی پایگاه داده اجرا می‌شود. یک وابستگی کمتر هم یعنی یک
 * چیز کمتر برای نگهداری و به‌روزرسانی.
 *
 * قاعده‌ها:
 *   * فایل‌ها به ترتیب نام اجرا می‌شوند: 001_...sql، 002_...sql و ...
 *   * هر فایل دقیقا یک بار اجرا می‌شود؛ نامش در جدول schema_migrations می‌ماند.
 *   * هر فایل داخل یک تراکنش اجرا می‌شود: یا کامل اعمال می‌شود یا هیچ.
 *   * قفل مشورتی گرفته می‌شود تا دو نمونه هم‌زمان مهاجرت اجرا نکنند.
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { getPool, closeDb } from './index.js';
import { ROOT } from '../config/index.js';

const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const LOCK_ID = 20_080_001; // دلخواه ولی ثابت، فقط بین نمونه‌های همین سرویس

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

/** فهرست فایل‌های مهاجرت، مرتب‌شده. */
export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * مهاجرت‌های اجرانشده را اعمال می‌کند.
 * @returns {Promise<{applied:string[], skipped:string[]}>}
 */
export async function runMigrations({ log = console.log } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  const applied = [];
  const skipped = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(CREATE_TABLE);

    const done = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );

    for (const filename of listMigrationFiles()) {
      if (done.has(filename)) { skipped.push(filename); continue; }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
        log(`  اعمال شد: ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`مهاجرت ${filename} شکست خورد: ${err.message}`);
      }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch { /* اتصال رفته */ }
    client.release();
  }

  return { applied, skipped };
}

/* اجرای مستقیم از خط فرمان: node src/db/migrate.js */
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  try {
    const { applied, skipped } = await runMigrations();
    console.log(`\nمهاجرت‌ها: ${applied.length} اعمال شد، ${skipped.length} از قبل اعمال شده بود.`);
  } catch (err) {
    console.error('[migrate] خطا:', err.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
