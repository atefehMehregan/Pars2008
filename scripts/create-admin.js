#!/usr/bin/env node
/* ============================================================================
 * scripts/create-admin.js — ساخت حساب مدیر
 * ----------------------------------------------------------------------------
 * تنها راه ساختن حساب مدیر. عمدا تعاملی است.
 *
 * چرا از راه مهاجرت نه؟ چون یعنی یک هشِ رمزِ شناخته‌شده داخل مخزن — یعنی
 * هر کسی که کد را دیده، رمز اولین مدیر را می‌داند.
 *
 * چرا از راه متغیر محیطی یا آرگومان خط فرمان نه؟ چون آرگومان‌ها در خروجی
 * `ps` برای همهٔ کاربران سیستم دیده می‌شوند، و متغیر محیطی در crash dump و
 * فهرست پروسه نشت می‌کند. رمز فقط از stdin و بدون بازتاب خوانده می‌شود.
 *
 * اجرا:  npm run admin:create
 * ==========================================================================*/
import readline from 'node:readline';
import { getPool, closeDb } from '../src/db/index.js';
import { createAdminUserRepository } from '../src/db/repositories/adminUsers.js';
import { createAuditLog, AUDIT_ACTIONS } from '../src/services/audit.js';
import { hashPassword } from '../src/services/password.js';
import { normalizeEmail } from '../src/services/adminAuth.js';

const MIN_PASSWORD_LENGTH = 12;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

/**
 * خواندن رمز بدون نمایش آن روی صفحه.
 * اگر ورودی ترمینال واقعی نباشد (مثلا در CI یا pipe)، به‌جای بازتاب دادن
 * رمز، با خطا متوقف می‌شود — بهتر است دستور شکست بخورد تا اینکه رمز در
 * لاگ ساخت بنشیند.
 */
function askSecret(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error(
      'ورودی ترمینال نیست. این دستور باید به‌صورت تعاملی اجرا شود تا رمز بازتاب داده نشود.'
    ));
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let value = '';
    const onData = (char) => {
      switch (char) {
        case '\n': case '\r': case '':      // پایان
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          break;
        case '':                             // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          reject(new Error('لغو شد.'));
          break;
        case '': case '\b':                  // backspace
          value = value.slice(0, -1);
          break;
        default:
          /* نویسه‌های کنترلی نادیده گرفته می‌شوند. */
          if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

function validatePassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `رمز باید دست‌کم ${MIN_PASSWORD_LENGTH} نویسه باشد.`;
  }
  if (password.length > 200) return 'رمز بیش از حد بلند است.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'رمز باید هم حرف و هم رقم داشته باشد.';
  }
  return null;
}

async function main() {
  console.log('\n=== ساخت حساب مدیر ۲۰۰۸پارس ===\n');

  /* پیش از هر پرسشی، از برقرار بودن اتصال مطمئن می‌شویم تا کاربر رمز را
     بی‌جهت وارد نکند. */
  const pool = getPool();
  await pool.query('SELECT 1');

  const db = { query: (text, params) => pool.query(text, params) };
  const adminUsers = createAdminUserRepository(db);
  const audit = createAuditLog(db);

  const rawEmail = await ask('ایمیل: ');
  const email = normalizeEmail(rawEmail);
  if (!email || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    throw new Error('قالب ایمیل درست نیست.');
  }
  if (await adminUsers.findByEmail(email)) {
    throw new Error('حسابی با این ایمیل از قبل وجود دارد.');
  }

  const displayName = (await ask('نام نمایشی (اختیاری): ')).trim() || null;

  const password = await askSecret(`رمز عبور (دست‌کم ${MIN_PASSWORD_LENGTH} نویسه): `);
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);

  const confirm = await askSecret('تکرار رمز عبور: ');
  if (password !== confirm) throw new Error('تکرار رمز با رمز یکی نیست.');

  const passwordHash = await hashPassword(password);
  const created = await adminUsers.create({ email, passwordHash, displayName });

  await audit.record({
    adminId: created.id,
    action: AUDIT_ACTIONS.ADMIN_CREATED,
    entity: 'admin_users',
    entityId: created.id,
    detail: { email: created.email, via: 'cli' },
  });

  console.log(`\nحساب ساخته شد: ${created.email} (شناسه ${created.id})`);
  console.log('حالا می‌توانید از /admin/login وارد شوید.\n');
}

main()
  .catch((err) => {
    console.error(`\nخطا: ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
