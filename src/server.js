/* ============================================================================
 * server.js — نقطه شروع سرویس
 * ----------------------------------------------------------------------------
 * ترتیب راه‌اندازی مهم است: اول پوشه‌های ذخیره‌سازی، بعد گوش دادن به پورت.
 * اتصال به پایگاه داده تنبل است و اولین کوئری آن را می‌سازد، پس نبودِ
 * پایگاه داده جلوی بالا آمدن سرویس را نمی‌گیرد — /health/db وضعیت را
 * گزارش می‌دهد.
 * ==========================================================================*/
import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { closeDb } from './db/index.js';

/** پوشه‌های ذخیره‌سازی باید وجود داشته باشند و بیرون از webroot بمانند. */
function ensureStorageDirs() {
  for (const dir of [config.storage.originals, config.storage.products, config.storage.receipts]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function start() {
  ensureStorageDirs();
  const app = createApp();

  const server = app.listen(config.port, config.host, () => {
    console.log(`[2008pars] روی http://${config.host}:${config.port} در حالت ${config.env}`);
    console.log(`[2008pars] ذخیره‌سازی: ${config.storage.root}`);
    console.log(`[2008pars] پایگاه داده: ${config.database.url ? 'پیکربندی شده' : 'پیکربندی نشده (DATABASE_URL خالی است)'}`);
  });

  async function shutdown(signal) {
    console.log(`[2008pars] ${signal} — بستن سرویس`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

/* اگر این فایل مستقیم اجرا شود سرویس بالا می‌آید؛ اگر فقط import شود
   (مثلا در آزمون) کاری نمی‌کند. */
const invoked = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invoked) {
  start().catch((err) => {
    console.error('[2008pars] راه‌اندازی شکست خورد:', err.message);
    process.exit(1);
  });
}
