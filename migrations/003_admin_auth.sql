-- ============================================================================
-- 003_admin_auth.sql — احراز هویت مدیر
-- ----------------------------------------------------------------------------
-- قاعده‌های این بخش:
--
--   * رمز هرگز اینجا نیست؛ فقط هش Argon2id آن.
--   * توکن نشست هم اینجا نیست؛ فقط SHA-256 آن. اگر پایگاه داده لو برود،
--     کسی نمی‌تواند با محتوای جدول جای مدیر جا بزند.
--   * یکتایی ایمیل روی lower(email) است، نه citext. دلیل: citext یک افزونه
--     است و اجازهٔ CREATE EXTENSION روی ارائه‌دهندهٔ تولید هنوز نامعلوم است.
--     ما از قبل pg_trgm را به آن اجازه گره زده‌ایم؛ گره زدن افزونهٔ دوم،
--     ریسک استقرار را بی‌دلیل دو برابر می‌کند. lower(email) هیچ افزونه‌ای
--     لازم ندارد و همه‌جا کار می‌کند.
--
-- هیچ مدیری اینجا ساخته نمی‌شود. حساب اول با «npm run admin:create» و
-- به‌صورت تعاملی ساخته می‌شود — نه با داده نمونه در مهاجرت، که یعنی یک
-- رمز عمومی‌ِ شناخته‌شده در مخزن.
-- ============================================================================

-- ------------------------------------------------------------------ مدیرها
CREATE TABLE IF NOT EXISTS admin_users (
  id                  BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email               TEXT        NOT NULL,
  password_hash       TEXT        NOT NULL,
  display_name        TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT admin_users_hash_not_blank  CHECK (length(btrim(password_hash)) > 0)
);
-- «Admin@Example.com» و «admin@example.com» یک حساب‌اند.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower ON admin_users (lower(email));

-- ---------------------------------------------------------------- نشست‌ها
-- دو ساعتِ انقضا با هم کار می‌کنند:
--   expires_at    سقف مطلق (پیش‌فرض ۱۲ ساعت از ورود)
--   last_seen_at  برای بی‌کاری (پیش‌فرض ۶۰ دقیقه)، با هر درخواست تازه می‌شود
-- شرط بی‌کاری در کوئری اعمال می‌شود، نه با ستون جداگانه، تا همیشه با
-- تنظیمات جاری سنجیده شود و تغییر تنظیم نیازی به مهاجرت نداشته باشد.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id           UUID        PRIMARY KEY,
  admin_id     BIGINT      NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,
  csrf_hash    TEXT        NOT NULL,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin   ON admin_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);
-- نشست‌های زنده معمولا انگشت‌شمارند؛ ایندکس جزئی همان‌ها را کوچک نگه می‌دارد.
CREATE INDEX IF NOT EXISTS idx_admin_sessions_live
  ON admin_sessions (admin_id) WHERE revoked_at IS NULL;

-- ------------------------------------------------- تلاش‌های ورود ناموفق
-- برای کند کردن حملهٔ جست‌وجوی فراگیر و پر کردن اعتبارنامه. شمارش در SQL و
-- با پنجرهٔ زمانی خود PostgreSQL انجام می‌شود تا به ساعت پروسهٔ برنامه
-- وابسته نباشد و با راه‌اندازی دوباره پاک نشود.
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier TEXT        NOT NULL,   -- ایمیل واردشده، نرمال‌شده
  ip         TEXT        NOT NULL,
  ok         BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts (identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip         ON login_attempts (ip, created_at);

-- ------------------------------------------------------------ رد پای مدیر
-- از همین فاز نوشته می‌شود، هرچند فعلا فقط رویدادهای ورود و خروج را دارد.
-- در سامانه‌ای که بعدا با پول سروکار پیدا می‌کند، نباید بازه‌ای وجود داشته
-- باشد که پرسش «چه کسی، چه وقت، چه کرد؟» بی‌پاسخ بماند.
--
-- admin_id با ON DELETE SET NULL: حذف حساب مدیر نباید تاریخچه را پاک کند.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id   BIGINT      REFERENCES admin_users (id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_action_not_blank CHECK (length(btrim(action)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin  ON admin_audit_log (admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log (entity, entity_id);
