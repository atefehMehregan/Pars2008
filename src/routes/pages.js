/* ============================================================================
 * routes/pages.js — صفحه‌های عمومی غیرکاتالوگی
 * ----------------------------------------------------------------------------
 * فعلا فقط صفحهٔ اصلی. مثل مسیریاب کاتالوگ، مخزن‌ها از بیرون تزریق
 * می‌شوند تا آزمون بتواند PGlite بدهد.
 *
 * همه GET و همه عمومی؛ هیچ مسیر تغییردهنده‌ای اینجا نیست.
 * ==========================================================================*/
import express from 'express';
import { createHomeController } from '../controllers/homeController.js';

export function createPageRouter(repositories) {
  const router = express.Router();
  const c = createHomeController(repositories);

  router.get('/', c.home);

  return router;
}
