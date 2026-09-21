/* ============================================================================
 * tests/helpers/testDb.js — پایگاه دادهٔ آزمون
 * ----------------------------------------------------------------------------
 * PGlite است: همان PostgreSQL (نسخه ۱۸) که به WebAssembly کامپایل شده، داخل
 * همین پروسه. پس SQL واقعا اجرا می‌شود — قیدها، ایندکس‌ها و افزونه‌ها همگی
 * همان رفتار PostgreSQL را دارند و آزمون چیزی را شبیه‌سازی نمی‌کند.
 *
 * فقط وابستگی توسعه است. لایهٔ اتصال تولید (src/db/index.js با pg.Pool)
 * دست‌نخورده می‌ماند و این فایل هرگز در مسیر تولید بار نمی‌شود.
 *
 * یک تفاوت آگاهانه: PGlite متد connect() ندارد، پس runMigrations() که روی
 * pool.connect() و قفل مشورتی بنا شده اینجا اجرا نمی‌شود. به‌جایش همان
 * فایل‌های مهاجرت — از طریق listMigrationFiles() که خودِ مهاجرت‌گر صادر
 * می‌کند — مستقیم اجرا می‌شوند. یعنی *SQL* کاملا آزموده می‌شود، ولی
 * قفل‌گذاری و دفترداری schema_migrations فقط روی PostgreSQL واقعی.
 * این محدودیت عمدی و مستند است.
 * ==========================================================================*/
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { listMigrationFiles } from '../../src/db/migrate.js';
import { ROOT } from '../../src/config/index.js';

const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

/**
 * یک پایگاه دادهٔ تازه با اسکیمای کامل می‌سازد.
 * هر فراخوانی نمونهٔ مستقل و در-حافظه می‌دهد، پس آزمون‌ها به هم نشت نمی‌کنند.
 *
 * @returns {Promise<{query, queryOne, exec, close, raw, appliedMigrations}>}
 */
export async function createTestDb({ applyMigrations = true } = {}) {
  /* pg_trgm در نسخهٔ پایه همراه نیست و باید صریح بار شود. */
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.waitReady;

  const applied = [];
  if (applyMigrations) {
    for (const filename of listMigrationFiles(MIGRATIONS_DIR)) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      try {
        await pg.exec(sql);
        applied.push(filename);
      } catch (err) {
        throw new Error(`مهاجرت ${filename} روی پایگاه دادهٔ آزمون شکست خورد: ${err.message}`);
      }
    }
  }

  /* رابطی هم‌شکل با src/db/index.js تا مخزن‌ها بدون تغییر کار کنند. */
  const api = {
    query: (text, params) => pg.query(text, params),
    async queryOne(text, params) {
      const r = await pg.query(text, params);
      return r.rows[0];
    },
    exec: (sql) => pg.exec(sql),
    close: () => pg.close(),
    raw: pg,
    appliedMigrations: applied,
  };
  return api;
}

/* ----------------------------------------------------- داده‌های آزمون -----
 * این مقدارها فقط داخل آزمون‌ها زندگی می‌کنند. هیچ‌کدام در مهاجرت، فایل
 * seed یا دادهٔ تولید نمی‌روند. عمدا خنثی و آشکارا ساختگی‌اند تا با
 * کاتالوگ واقعی اشتباه نشوند.
 * ------------------------------------------------------------------------*/

/** یک دستهٔ آزمون می‌سازد و شناسه‌اش را برمی‌گرداند. */
export async function insertCategory(db, { name = 'دستهٔ آزمون', slug = 'دسته-آزمون', sortOrder = 0, isActive = true } = {}) {
  const r = await db.query(
    `INSERT INTO categories (name, slug, sort_order, is_active)
     VALUES ($1,$2,$3,$4) RETURNING id`, [name, slug, sortOrder, isActive]
  );
  return r.rows[0].id;
}

export async function insertBrand(db, { name = 'برند آزمون', slug = 'برند-آزمون', isActive = true } = {}) {
  const r = await db.query(
    `INSERT INTO brands (name, slug, is_active) VALUES ($1,$2,$3) RETURNING id`,
    [name, slug, isActive]
  );
  return r.rows[0].id;
}

export async function insertVehicle(db, { make = 'سازندهٔ آزمون', model = 'مدل آزمون', slug = 'خودرو-آزمون', displayName = 'خودروی آزمون' } = {}) {
  const r = await db.query(
    `INSERT INTO vehicles (make, model, slug, display_name) VALUES ($1,$2,$3,$4) RETURNING id`,
    [make, model, slug, displayName]
  );
  return r.rows[0].id;
}

/**
 * یک محصول آزمون می‌سازد.
 * search_text و oem_number_normalized همان‌طور ساخته می‌شوند که لایهٔ
 * مخزن در تولید می‌سازد، تا آزمونِ جست‌وجو واقعی باشد.
 */
export async function insertProduct(db, {
  name = 'قطعهٔ آزمون', slug = 'قطعه-آزمون', sku = 'TEST-0001',
  oemNumber = null, categoryId, brandId = null, brandName = null,
  priceToman = 100000, salePriceToman = null, stockQty = 5,
  availability = 'in_stock', shortDescription = null,
  isActive = true, isFeatured = false, isNew = false,
} = {}) {
  const { buildSearchText, normalizeOem } = await import('../../src/services/slug.js');
  const r = await db.query(
    `INSERT INTO products
       (name, slug, sku, oem_number, oem_number_normalized, category_id, brand_id,
        price_toman, sale_price_toman, stock_qty, availability, short_description,
        is_active, is_featured, is_new, search_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [name, slug, sku, oemNumber, normalizeOem(oemNumber), categoryId, brandId,
     priceToman, salePriceToman, stockQty, availability, shortDescription,
     isActive, isFeatured, isNew,
     buildSearchText({ name, sku, oemNumber, brandName, shortDescription })]
  );
  return r.rows[0].id;
}
