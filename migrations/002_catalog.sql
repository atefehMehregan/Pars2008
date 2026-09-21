-- ============================================================================
-- 002_catalog.sql — اسکیمای کاتالوگ
-- ----------------------------------------------------------------------------
-- قاعده‌های این اسکیما:
--
--   * مبلغ‌ها BIGINT تومان‌اند. اعشار شناور برای پول هرگز، و رشتهٔ فارسیِ
--     قالب‌بندی‌شده هم هرگز — چون نه جمع‌پذیر است نه مرتب‌شدنی.
--   * زمان‌ها TIMESTAMPTZ و به وقت UTC. نمایش شمسی کار لایهٔ نمایش است.
--   * وضعیت‌ها TEXT + CHECK‌اند، نه ENUM بومی: افزودن مقدار تازه یک تغییر
--     یک‌خطی قید است، نه ALTER TYPE در یک مهاجرت جداگانه.
--   * شناسه‌ها BIGINT IDENTITY‌اند. کاتالوگ عمومی است و شمارهٔ پشت‌سرهم
--     چیزی لو نمی‌دهد؛ UUID فقط هزینهٔ ایندکس اضافه می‌کرد.
--
-- هیچ دادهٔ نمونه‌ای اینجا نیست — نه محصول، نه برند، نه دسته، نه خودرو.
-- ============================================================================

-- ------------------------------------------------------------------ دسته‌ها
-- parent_id خودارجاع است تا در صورت نیاز یک سطح دوم ممکن باشد. نسخه اول
-- تخت استفاده می‌شود؛ ساختار آماده است بدون اینکه امروز هزینه‌ای بدهد.
CREATE TABLE IF NOT EXISTS categories (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  parent_id   BIGINT      REFERENCES categories (id) ON DELETE RESTRICT,
  description TEXT,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT categories_slug_not_blank CHECK (length(btrim(slug)) > 0),
  CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id, sort_order);

-- ------------------------------------------------------------------- برندها
CREATE TABLE IF NOT EXISTS brands (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT        NOT NULL,
  slug       TEXT        NOT NULL,
  country    TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brands_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_slug ON brands (slug);

-- ------------------------------------------------------------------ خودروها
-- ستون‌های generation / year_from / year_to / engine_code عمدا NULL‌پذیرند.
-- نسخه اول تنها یک خودرو دارد و این محورها هیچ چیزی را فیلتر نمی‌کنند، پس
-- خالی می‌مانند. اگر بعدا خودروی دیگری اضافه شد، دقت با پر کردن همین
-- ستون‌ها می‌آید — نه با تغییر ساختار.
CREATE TABLE IF NOT EXISTS vehicles (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make         TEXT        NOT NULL,
  model        TEXT        NOT NULL,
  generation   TEXT,
  year_from    INTEGER,
  year_to      INTEGER,
  engine_code  TEXT,
  engine_label TEXT,
  slug         TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_year_range CHECK (year_from IS NULL OR year_to IS NULL OR year_to >= year_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_slug ON vehicles (slug);

-- ----------------------------------------------------------------- محصول‌ها
CREATE TABLE IF NOT EXISTS products (
  id                    BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  TEXT        NOT NULL,
  slug                  TEXT        NOT NULL,
  sku                   TEXT        NOT NULL,
  oem_number            TEXT,
  -- شکل نرمال‌شدهٔ شماره فنی: فقط حروف و رقم، بزرگ. کاربر «9678-191-580»
  -- یا «۹۶۷۸۱۹۱۵۸۰» می‌نویسد و باید همان قطعه پیدا شود.
  oem_number_normalized TEXT,
  brand_id              BIGINT      REFERENCES brands (id)     ON DELETE RESTRICT,
  category_id           BIGINT      NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,

  price_toman           BIGINT      NOT NULL,
  sale_price_toman      BIGINT,

  stock_qty             INTEGER     NOT NULL DEFAULT 0,
  -- «قابل سفارش» در این بازار یک وضعیت واقعی است و با موجودی صفر بیان نمی‌شود.
  availability          TEXT        NOT NULL DEFAULT 'in_stock',

  short_description     TEXT,
  description           TEXT,
  specs                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- جملهٔ سازگاری برای نمایش به مشتری. فیلتر ساختاری کار product_vehicle است.
  compatibility_note    TEXT,

  weight_grams          INTEGER,

  is_featured           BOOLEAN     NOT NULL DEFAULT FALSE,
  is_new                BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,

  -- متن نرمال‌شده برای جست‌وجو. لایهٔ مخزن آن را هنگام نوشتن می‌سازد، نه
  -- تریگر پایگاه داده: نرمال‌سازی فارسی یک‌جا در کد می‌ماند و آزمون‌پذیر است.
  search_text           TEXT        NOT NULL DEFAULT '',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT products_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT products_price_non_negative CHECK (price_toman >= 0),
  CONSTRAINT products_sale_below_price CHECK (
    sale_price_toman IS NULL OR (sale_price_toman >= 0 AND sale_price_toman < price_toman)
  ),
  CONSTRAINT products_stock_non_negative CHECK (stock_qty >= 0),
  CONSTRAINT products_weight_positive CHECK (weight_grams IS NULL OR weight_grams > 0),
  CONSTRAINT products_availability_known CHECK (
    availability IN ('in_stock', 'out_of_stock', 'on_order', 'discontinued')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku  ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_oem         ON products (oem_number_normalized);
CREATE INDEX IF NOT EXISTS idx_products_category    ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand       ON products (brand_id);
CREATE INDEX IF NOT EXISTS idx_products_active_new  ON products (is_active, created_at DESC);
-- جست‌وجوی تقریبی نام: سه‌نویسه‌ای، چون کاربر نام قطعه را ناقص می‌نویسد.
CREATE INDEX IF NOT EXISTS idx_products_search_trgm ON products USING GIN (search_text gin_trgm_ops);

-- -------------------------------------------------- سازگاری محصول با خودرو
-- چند-به-چند از همان روز اول، حتی با یک خودرو: یک جدول کوچک امروز، در برابر
-- یک مهاجرت دردسرساز فردا.
CREATE TABLE IF NOT EXISTS product_vehicle (
  product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles (id) ON DELETE RESTRICT,
  note       TEXT,
  PRIMARY KEY (product_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_product_vehicle_vehicle ON product_vehicle (vehicle_id);

-- ------------------------------------------------------------ تصویر محصول
-- image_id همان شناسه‌ای است که خط لولهٔ sharp می‌سازد. فایل اصل خصوصی
-- می‌ماند و مشتق‌های واترمارک‌خورده از /media/products سرو می‌شوند.
CREATE TABLE IF NOT EXISTS product_images (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  image_id   TEXT        NOT NULL,
  alt_text   TEXT,
  width      INTEGER,
  height     INTEGER,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  is_primary BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id, sort_order);
-- هر محصول حداکثر یک تصویر اصلی.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary
  ON product_images (product_id) WHERE is_primary;
