/* ============================================================================
 * routes/catalog.js — مسیرهای عمومی کاتالوگ
 * ----------------------------------------------------------------------------
 * همه GET و همه عمومی. هیچ مسیر تغییردهنده‌ای در این فاز نیست، پس CSRF
 * اینجا نقشی ندارد (میان‌افزار آن روی درخواست‌های GET خودش رد می‌شود).
 *
 * نشانی‌ها فارسی‌اند: /category/لوازم-ترمز
 * Express مقدار :slug را خودش percent-decode می‌کند؛ نرمال‌سازی فارسی در
 * کنترلر انجام می‌شود تا ی/ک عربی هم به همان دسته برسد.
 * ==========================================================================*/
import express from 'express';
import { createCatalogController } from '../controllers/catalogController.js';

export function createCatalogRouter(repositories) {
  const router = express.Router();
  const c = createCatalogController(repositories);

  router.get('/products', c.shop);
  router.get('/search', c.search);
  router.get('/category/:slug', c.category);
  router.get('/brand/:slug', c.brand);
  router.get('/product/:slug', c.product);

  return router;
}
