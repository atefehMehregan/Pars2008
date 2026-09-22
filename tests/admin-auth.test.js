/* ============================================================================
 * tests/admin-auth.test.js — آزمون احراز هویت مدیر (فاز ۲الف)
 * ----------------------------------------------------------------------------
 * اسکیما، هش رمز، چرخهٔ عمر نشست، محدودسازی ورود و رد پا.
 * مسیرهای HTTP در فاز ۲ب آزموده می‌شوند.
 *
 * یک پایگاه دادهٔ PGlite برای کل فایل، با TRUNCATE پیش از هر آزمون.
 * همهٔ داده‌ها ساختگی و فقط داخل همین فایل‌اند.
 * ==========================================================================*/
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/* NODE_ENV پیش از بار شدن config — ببینید توضیح در admin-routes.test.js. */
process.env.NODE_ENV = 'test';

const { createTestDb } = await import('./helpers/testDb.js');
const { createAdminUserRepository } = await import('../src/db/repositories/adminUsers.js');
const { createAdminSessionRepository } = await import('../src/db/repositories/adminSessions.js');
const { createLoginAttemptRepository } = await import('../src/db/repositories/loginAttempts.js');
const { createAuditLog, AUDIT_ACTIONS } = await import('../src/services/audit.js');
const { createAdminAuthService } = await import('../src/services/adminAuth.js');
const { hashPassword, verifyPassword, verifyDummy, passwordAlgorithmInfo } = await import('../src/services/password.js');
const { sha256 } = await import('../src/middleware/security.js');
const { config } = await import('../src/config/index.js');

const PASSWORD = 'correct-horse-9-battery';
let db, adminUsers, adminSessions, loginAttempts, audit, auth;

before(async () => {
  db = await createTestDb();
  adminUsers = createAdminUserRepository(db);
  adminSessions = createAdminSessionRepository(db);
  loginAttempts = createLoginAttemptRepository(db);
  audit = createAuditLog(db);
  auth = createAdminAuthService({ adminUsers, adminSessions, loginAttempts, audit });
});

after(async () => { if (db) await db.close(); });

beforeEach(async () => {
  await db.exec(`TRUNCATE admin_audit_log, admin_sessions, login_attempts, admin_users
                 RESTART IDENTITY CASCADE`);
});

/** یک مدیر آزمون می‌سازد. */
async function makeAdmin({ email = 'admin@example.test', password = PASSWORD, displayName = 'مدیر آزمون' } = {}) {
  return adminUsers.create({ email, passwordHash: await hashPassword(password), displayName });
}

/* ═══════════════════════════════════════════════════ ۱. اسکیما */

test('چهار جدول احراز هویت ساخته می‌شوند', async () => {
  const res = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' ORDER BY table_name`);
  const names = res.rows.map((r) => r.table_name);
  for (const t of ['admin_audit_log', 'admin_sessions', 'admin_users', 'login_attempts']) {
    assert.ok(names.includes(t), `${t} باید ساخته شود`);
  }
});

test('ایمیل بدون توجه به بزرگی/کوچکی حرف یکتاست', async () => {
  await makeAdmin({ email: 'Admin@Example.test' });
  await assert.rejects(
    () => makeAdmin({ email: 'admin@example.TEST' }),
    /duplicate key|unique/i, 'باید همان حساب شمرده شود'
  );
});

test('هشِ توکن نشست یکتاست', async () => {
  const admin = await makeAdmin();
  const base = {
    adminId: admin.id, tokenHash: 'same-hash', csrfHash: 'c',
    expiresAt: new Date(Date.now() + 3600_000),
  };
  await adminSessions.create({ ...base, id: crypto.randomUUID() });
  await assert.rejects(
    () => adminSessions.create({ ...base, id: crypto.randomUUID() }),
    /duplicate key|unique/i
  );
});

test('حذف مدیر نشست‌هایش را می‌برد (CASCADE) ولی رد پا را نگه می‌دارد (SET NULL)', async () => {
  const admin = await makeAdmin();
  await adminSessions.create({
    id: crypto.randomUUID(), adminId: admin.id, tokenHash: 'h', csrfHash: 'c',
    expiresAt: new Date(Date.now() + 3600_000),
  });
  await audit.record({ adminId: admin.id, action: AUDIT_ACTIONS.LOGIN_SUCCESS });

  await db.query('DELETE FROM admin_users WHERE id = $1', [admin.id]);

  const sessions = await db.query('SELECT COUNT(*)::int AS n FROM admin_sessions');
  assert.equal(sessions.rows[0].n, 0, 'نشست‌ها باید حذف شوند');
  const logs = await db.query('SELECT admin_id FROM admin_audit_log');
  assert.equal(logs.rows.length, 1, 'رد پا باید بماند');
  assert.equal(logs.rows[0].admin_id, null, 'ولی بدون اشاره به حساب حذف‌شده');
});

test('هیچ مدیری در مهاجرت ساخته نمی‌شود', async () => {
  const fresh = await createTestDb();
  try {
    const r = await fresh.query('SELECT COUNT(*)::int AS n FROM admin_users');
    assert.equal(r.rows[0].n, 0, 'مهاجرت نباید حساب بسازد');
  } finally { await fresh.close(); }
});

/* ═══════════════════════════════════════════ ۲. هش کردن رمز */

test('Argon2id با پارامترهای پیکربندی‌شده هش می‌سازد', async () => {
  const h = await hashPassword(PASSWORD);
  assert.ok(h.startsWith('$argon2id$'), `باید argon2id باشد: ${h.slice(0, 20)}`);
  assert.match(h, new RegExp(`m=${config.argon.memoryCost},t=${config.argon.timeCost},p=${config.argon.parallelism}`));
  assert.ok(!h.includes(PASSWORD), 'رمز خام نباید داخل هش باشد');
});

test('دو بار هش کردن یک رمز، دو نتیجهٔ متفاوت می‌دهد (نمک تصادفی)', async () => {
  assert.notEqual(await hashPassword(PASSWORD), await hashPassword(PASSWORD));
});

test('سنجش رمز درست و غلط', async () => {
  const h = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(h, PASSWORD), true);
  assert.equal(await verifyPassword(h, PASSWORD + 'x'), false);
  assert.equal(await verifyPassword(h, ''), false);
});

test('هشِ خراب false می‌دهد، نه استثنا', async () => {
  /* @node-rs/argon2 روی رشتهٔ نامعتبر استثنا پرتاب می‌کند؛ سرویس باید
     آن را بگیرد وگرنه یک سطر خراب به خطای ۵۰۰ تبدیل می‌شود. */
  for (const bad of ['not-a-hash', '', '$argon2id$broken', null, undefined, 123]) {
    assert.equal(await verifyPassword(bad, PASSWORD), false, `ورودی ${JSON.stringify(bad)}`);
  }
});

test('رمز خالی قابل هش کردن نیست', async () => {
  await assert.rejects(() => hashPassword(''), /خالی/);
});

test('سنجش ساختگی همیشه false می‌دهد و پرتاب نمی‌کند', async () => {
  assert.equal(await verifyDummy('anything'), false);
  assert.equal(await verifyDummy(null), false);
});

test('اطلاعات الگوریتم گزارش می‌شود', () => {
  const info = passwordAlgorithmInfo();
  assert.equal(info.algorithm, 'argon2id');
  assert.equal(info.implementation, '@node-rs/argon2');
});

/* ═══════════════════════════════════════════════ ۳. ورود */

test('ورود درست، توکن و توکن CSRF می‌دهد', async () => {
  const admin = await makeAdmin();
  const res = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });

  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(typeof res.token, 'string');
  assert.ok(res.token.length >= 40, 'توکن باید به‌اندازهٔ کافی بلند باشد');
  assert.equal(typeof res.csrfToken, 'string');
  assert.equal(res.admin.id, admin.id);
  assert.equal(res.admin.email, 'admin@example.test');
});

test('ایمیل بدون توجه به بزرگی حرف و فاصله پذیرفته می‌شود', async () => {
  await makeAdmin({ email: 'admin@example.test' });
  const res = await auth.login({ email: '  Admin@Example.TEST  ', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(res.ok, true);
});

test('خودِ توکن هرگز ذخیره نمی‌شود — فقط SHA-256 آن', async () => {
  const admin = await makeAdmin();
  const res = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });

  const rows = await db.query('SELECT token_hash, csrf_hash FROM admin_sessions WHERE admin_id=$1', [admin.id]);
  const row = rows.rows[0];
  assert.notEqual(row.token_hash, res.token, 'توکن خام نباید ذخیره شود');
  assert.equal(row.token_hash, sha256(res.token), 'باید هش SHA-256 باشد');
  assert.equal(row.token_hash.length, 64);
  assert.notEqual(row.csrf_hash, res.csrfToken, 'توکن CSRF خام هم نباید ذخیره شود');
  assert.equal(row.csrf_hash, sha256(res.csrfToken));

  /* هیچ جای جدول نباید رشتهٔ خام توکن پیدا شود. */
  const all = JSON.stringify((await db.query('SELECT * FROM admin_sessions')).rows);
  assert.ok(!all.includes(res.token), 'توکن خام نباید هیچ‌جای سطر باشد');
});

test('رمز غلط و حساب ناموجود پیام یکسان می‌دهند', async () => {
  await makeAdmin();
  const wrongPassword = await auth.login({ email: 'admin@example.test', password: 'bad', ip: '1.1.1.1' });
  const noAccount = await auth.login({ email: 'ghost@example.test', password: 'bad', ip: '2.2.2.2' });

  assert.equal(wrongPassword.ok, false);
  assert.equal(noAccount.ok, false);
  assert.equal(wrongPassword.message, noAccount.message,
    'پیام باید یکی باشد تا وجود حساب لو نرود');
});

test('حساب غیرفعال نمی‌تواند وارد شود', async () => {
  const admin = await makeAdmin();
  await db.query('UPDATE admin_users SET is_active = FALSE WHERE id = $1', [admin.id]);
  const res = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'inactive');
});

test('ورودی خالی، تلاش ناموفق شمرده می‌شود', async () => {
  const res = await auth.login({ email: '', password: '', ip: '1.1.1.1' });
  assert.equal(res.ok, false);
  assert.equal(await loginAttempts.countFailures('', config.admin.lockout.windowMinutes), 1);
});

test('last_login_at پس از ورود موفق تازه می‌شود', async () => {
  const admin = await makeAdmin();
  assert.equal((await adminUsers.findById(admin.id)).last_login_at, null);
  await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.ok((await adminUsers.findById(admin.id)).last_login_at instanceof Date);
});

/* ══════════════════════════════════ ۴. تثبیت نشست و چرخش توکن */

test('ورود موفق، نشست‌های قبلی را باطل و توکن تازه می‌سازد', async () => {
  const admin = await makeAdmin();

  const first = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.ok(await auth.loadSession(first.token), 'نشست اول باید معتبر باشد');

  const second = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });

  assert.notEqual(second.token, first.token, 'توکن باید چرخانده شود');
  assert.notEqual(second.csrfToken, first.csrfToken, 'توکن CSRF هم باید تازه شود');
  assert.equal(await auth.loadSession(first.token), null, 'نشست قبلی باید باطل شده باشد');
  assert.ok(await auth.loadSession(second.token), 'نشست تازه باید معتبر باشد');
  assert.equal(await adminSessions.countLiveForAdmin(admin.id), 1, 'فقط یک نشست زنده');
});

/* ═════════════════════════════════════ ۵. چرخهٔ عمر نشست */

test('نشست معتبر، مدیر را برمی‌گرداند', async () => {
  const admin = await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);
  assert.equal(session.admin_id, admin.id);
  assert.equal(session.email, 'admin@example.test');
});

test('توکن ناشناس یا خالی null می‌دهد', async () => {
  await makeAdmin();
  await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(await auth.loadSession('made-up-token'), null);
  assert.equal(await auth.loadSession(''), null);
  assert.equal(await auth.loadSession(null), null);
});

test('نشست باطل‌شده رد می‌شود', async () => {
  await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  await auth.logout(token);
  assert.equal(await auth.loadSession(token), null);
});

test('نشست پس از سقف مطلق رد می‌شود', async () => {
  await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);

  /* انقضا را به گذشته می‌بریم. */
  await adminSessions.shiftClock(session.id, { expiresMinutesFromNow: -1 });
  assert.equal(await auth.loadSession(token), null, 'نشست منقضی نباید معتبر باشد');
});

test('نشست پس از بی‌کاری رد می‌شود', async () => {
  await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);

  /* آخرین فعالیت را فراتر از پنجرهٔ بی‌کاری عقب می‌بریم. */
  await adminSessions.shiftClock(session.id, { lastSeenMinutesAgo: config.admin.idleMinutes + 5 });
  assert.equal(await auth.loadSession(token), null, 'نشست بی‌کار نباید معتبر باشد');
});

test('فعالیت، ساعت بی‌کاری را عقب می‌برد', async () => {
  await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);

  /* نزدیک مرز، ولی نه فراتر از آن. */
  await adminSessions.shiftClock(session.id, { lastSeenMinutesAgo: config.admin.idleMinutes - 5 });
  const before = (await adminSessions.findRawById(session.id)).last_seen_at;

  assert.ok(await auth.loadSession(token), 'هنوز باید معتبر باشد');
  await new Promise((r) => setTimeout(r, 60));   // touch غیرهمزمان است

  const after = (await adminSessions.findRawById(session.id)).last_seen_at;
  assert.ok(after > before, 'last_seen_at باید تازه شده باشد');
});

test('غیرفعال کردن مدیر، نشست زنده‌اش را بلافاصله بی‌اثر می‌کند', async () => {
  const admin = await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.ok(await auth.loadSession(token));

  await db.query('UPDATE admin_users SET is_active = FALSE WHERE id = $1', [admin.id]);
  assert.equal(await auth.loadSession(token), null, 'نباید تا انقضا صبر کند');
});

test('خروج، نشست را در پایگاه داده باطل می‌کند', async () => {
  await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);

  assert.equal(await auth.logout(token), true);
  assert.ok((await adminSessions.findRawById(session.id)).revoked_at, 'revoked_at باید پر شود');
  assert.equal(await auth.logout(token), false, 'خروج دوباره اثری ندارد');
});

test('نظافت، نشست‌های منقضی را پاک می‌کند', async () => {
  const admin = await makeAdmin();
  const { token } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);
  await adminSessions.shiftClock(session.id, { expiresMinutesFromNow: -10 });

  assert.ok(await adminSessions.purge() >= 1);
  assert.equal(await adminSessions.countLiveForAdmin(admin.id), 0);
});

/* ══════════════════════════════════════ ۶. CSRF گره‌خورده به نشست */

test('توکن CSRF درست پذیرفته و غلط رد می‌شود', async () => {
  await makeAdmin();
  const { token, csrfToken } = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(token);

  assert.equal(auth.csrfMatchesSession(session, csrfToken), true);
  assert.equal(auth.csrfMatchesSession(session, 'wrong-token'), false);
  assert.equal(auth.csrfMatchesSession(session, ''), false);
  assert.equal(auth.csrfMatchesSession(session, null), false);
  assert.equal(auth.csrfMatchesSession(null, csrfToken), false);
});

test('توکن CSRF یک نشست، روی نشست دیگر کار نمی‌کند', async () => {
  await makeAdmin({ email: 'a@example.test' });
  await makeAdmin({ email: 'b@example.test' });

  const a = await auth.login({ email: 'a@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const b = await auth.login({ email: 'b@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const sessionB = await auth.loadSession(b.token);

  assert.equal(auth.csrfMatchesSession(sessionB, a.csrfToken), false,
    'توکن CSRF نشست دیگر باید رد شود');
  assert.equal(auth.csrfMatchesSession(sessionB, b.csrfToken), true);
});

test('توکن CSRF پس از چرخش نشست بی‌اعتبار می‌شود', async () => {
  await makeAdmin();
  const first = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const second = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const session = await auth.loadSession(second.token);

  assert.equal(auth.csrfMatchesSession(session, first.csrfToken), false,
    'توکن CSRF قدیمی پس از ورود دوباره نباید کار کند');
});

/* ═════════════════════════════════ ۷. محدودسازی ورود */

test('پس از N تلاش ناموفق، همان شناسه قفل می‌شود', async () => {
  await makeAdmin();
  const max = config.admin.lockout.maxPerIdentifier;

  for (let i = 0; i < max; i++) {
    const r = await auth.login({ email: 'admin@example.test', password: 'bad', ip: '1.1.1.1' });
    assert.equal(r.ok, false);
  }
  /* حالا حتی با رمز درست هم باید قفل باشد. */
  const locked = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'locked_out');
});

test('قفل روی آی‌پی جداگانه اعمال می‌شود', async () => {
  await makeAdmin();
  const maxIp = config.admin.lockout.maxPerIp;
  /* شناسه‌های متفاوت، ولی یک آی‌پی — الگوی پر کردن اعتبارنامه. */
  for (let i = 0; i < maxIp; i++) {
    await auth.login({ email: `user${i}@example.test`, password: 'bad', ip: '9.9.9.9' });
  }
  const blocked = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '9.9.9.9' });
  assert.equal(blocked.reason, 'locked_out');
});

test('قفل شدن یک حساب، حساب دیگر را قفل نمی‌کند', async () => {
  await makeAdmin({ email: 'a@example.test' });
  await makeAdmin({ email: 'b@example.test' });
  for (let i = 0; i < config.admin.lockout.maxPerIdentifier; i++) {
    await auth.login({ email: 'a@example.test', password: 'bad', ip: '1.1.1.1' });
  }
  const other = await auth.login({ email: 'b@example.test', password: PASSWORD, ip: '2.2.2.2' });
  assert.equal(other.ok, true, 'حساب دیگر از آی‌پی دیگر نباید قفل باشد');
});

test('ورود موفق، تلاش موفق ثبت می‌کند و قفل نمی‌سازد', async () => {
  await makeAdmin();
  for (let i = 0; i < 10; i++) {
    const r = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
    assert.equal(r.ok, true, `ورود ${i + 1} باید موفق باشد`);
  }
  assert.equal(await loginAttempts.countFailures('admin@example.test', 15), 0);
});

test('آستانه‌ها از config می‌آیند، نه سخت‌کد', async () => {
  const custom = { maxPerIdentifier: 2, maxPerIp: 100, windowMinutes: 15 };
  await loginAttempts.record('x@example.test', '1.1.1.1', false);
  assert.equal(await loginAttempts.isBlocked('x@example.test', '1.1.1.1', custom), false);
  await loginAttempts.record('x@example.test', '1.1.1.1', false);
  assert.equal(await loginAttempts.isBlocked('x@example.test', '1.1.1.1', custom), true);
});

test('تلاش‌های خارج از پنجرهٔ زمانی شمرده نمی‌شوند', async () => {
  await loginAttempts.record('old@example.test', '1.1.1.1', false);
  await db.query(`UPDATE login_attempts SET created_at = now() - INTERVAL '60 minutes'`);
  assert.equal(
    await loginAttempts.isBlocked('old@example.test', '1.1.1.1',
      { maxPerIdentifier: 1, maxPerIp: 1, windowMinutes: 15 }),
    false, 'تلاش کهنه نباید بشمارد'
  );
});

/* ══════════════════════════════════════════════ ۸. رد پا */

test('ورود موفق، خروج و شکست همگی ثبت می‌شوند', async () => {
  const admin = await makeAdmin();

  await auth.login({ email: 'admin@example.test', password: 'bad', ip: '1.1.1.1' });
  assert.equal(await audit.countByAction(AUDIT_ACTIONS.LOGIN_FAILED), 1);

  const ok = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(await audit.countByAction(AUDIT_ACTIONS.LOGIN_SUCCESS), 1);

  await auth.logout(ok.token, { adminId: admin.id, ip: '1.1.1.1' });
  assert.equal(await audit.countByAction(AUDIT_ACTIONS.LOGOUT), 1);

  const rows = await audit.recent();
  assert.equal(rows[0].action, AUDIT_ACTIONS.LOGOUT, 'تازه‌ترین رویداد اول');
  assert.equal(rows[0].ip, '1.1.1.1');
});

test('رد پا هرگز رمز یا توکن ذخیره نمی‌کند', async () => {
  await makeAdmin();
  const res = await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' });
  const all = JSON.stringify((await db.query('SELECT * FROM admin_audit_log')).rows);
  assert.ok(!all.includes(PASSWORD), 'رمز نباید در رد پا باشد');
  assert.ok(!all.includes(res.token), 'توکن نشست نباید در رد پا باشد');
  assert.ok(!all.includes(res.csrfToken), 'توکن CSRF نباید در رد پا باشد');
});

test('قفل شدن هم ثبت می‌شود', async () => {
  await makeAdmin();
  for (let i = 0; i <= config.admin.lockout.maxPerIdentifier; i++) {
    await auth.login({ email: 'admin@example.test', password: 'bad', ip: '1.1.1.1' });
  }
  assert.ok(await audit.countByAction(AUDIT_ACTIONS.LOGIN_BLOCKED) >= 1);
});

/* ═══════════════════════════════════════ ۹. مخزن حساب مدیر */

test('حساب مدیر ساخته می‌شود و هش رمز بیرون داده نمی‌شود', async () => {
  const created = await makeAdmin();
  assert.equal(created.password_hash, undefined, 'create نباید هش را برگرداند');
  assert.equal((await adminUsers.findById(created.id)).password_hash, undefined);
  assert.equal((await adminUsers.findByEmail('admin@example.test')).password_hash, undefined);
  /* فقط مسیر ورود هش را می‌بیند. */
  assert.ok((await adminUsers.findForLogin('admin@example.test')).password_hash);
});

test('تغییر رمز، رمز قبلی را بی‌اعتبار می‌کند', async () => {
  const admin = await makeAdmin();
  const newHash = await hashPassword('brand-new-password-42');
  assert.equal(await adminUsers.updatePassword(admin.id, newHash), true);

  assert.equal((await auth.login({ email: 'admin@example.test', password: PASSWORD, ip: '1.1.1.1' })).ok,
    false, 'رمز قدیمی نباید کار کند');
  assert.equal((await auth.login({ email: 'admin@example.test', password: 'brand-new-password-42', ip: '2.2.2.2' })).ok,
    true, 'رمز تازه باید کار کند');
});

test('شمارش حساب‌ها و جست‌وجوی ناموجود', async () => {
  assert.equal(await adminUsers.countAll(), 0);
  await makeAdmin();
  assert.equal(await adminUsers.countAll(), 1);
  assert.equal(await adminUsers.findByEmail('nobody@example.test'), null);
  assert.equal(await adminUsers.findForLogin(''), null);
});

/* ═════════════════════════════ ۱۰. اسکریپت ساخت حساب */

test('اسکریپت ساخت حساب، رمز را از آرگومان خط فرمان نمی‌خواند', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/create-admin.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('process.argv'),
    'رمز هرگز نباید از argv بیاید — در خروجی ps برای همه دیده می‌شود');
  assert.ok(!/process\.env\.(ADMIN_)?PASSWORD/.test(src),
    'رمز نباید از متغیر محیطی بیاید');
  assert.ok(src.includes('setRawMode'), 'رمز باید بدون بازتاب خوانده شود');
  assert.ok(src.includes('isTTY'), 'ورودی غیرترمینال باید رد شود، نه اینکه رمز را بازتاب بدهد');
});
