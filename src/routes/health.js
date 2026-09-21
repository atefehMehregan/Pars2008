/* ============================================================================
 * routes/health.js — بررسی سلامت
 * ----------------------------------------------------------------------------
 * /health        سبک و بدون وابستگی — برای ناظر بالا بودن سرویس.
 * /health/db     جداگانه، چون اتصال پایگاه داده ممکن است کند یا قطع باشد و
 *                نباید بررسی سادهٔ «سرویس بالاست؟» را کند یا خراب کند.
 *
 * هیچ‌کدام اعتبارنامه، رشته اتصال یا جزئیات محیط بیرون نمی‌دهند.
 * ==========================================================================*/
import express from 'express';
import { config } from '../config/index.js';
import { checkDatabaseHealth } from '../db/index.js';

export const healthRouter = express.Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: '2008pars',
    env: config.env,
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

healthRouter.get('/health/db', async (req, res, next) => {
  try {
    const health = await checkDatabaseHealth();
    const ok = health.status === 'up';
    res.status(ok ? 200 : 503).json({ ok, database: health });
  } catch (err) {
    next(err);
  }
});
