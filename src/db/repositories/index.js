/* ============================================================================
 * repositories/index.js — سیم‌کشی مخزن‌ها به اتصال تولید
 * ----------------------------------------------------------------------------
 * اینجا تنها جایی است که مخزن‌ها به لایهٔ اتصال واقعی وصل می‌شوند.
 * آزمون‌ها به‌جای این فایل، کارخانه‌ها را مستقیم صدا می‌زنند و یک
 * اجراکنندهٔ دیگر (PGlite) تزریق می‌کنند — بدون اینکه چیزی در
 * src/db/index.js عوض شود.
 * ==========================================================================*/
import * as db from '../index.js';
import { createCategoryRepository } from './categories.js';
import { createBrandRepository } from './brands.js';
import { createProductRepository } from './products.js';
import { createProductImageRepository } from './productImages.js';
import { createVehicleRepository } from './vehicles.js';

export const categories = createCategoryRepository(db);
export const brands = createBrandRepository(db);
export const products = createProductRepository(db);
export const productImages = createProductImageRepository(db);
export const vehicles = createVehicleRepository(db);

export {
  createCategoryRepository, createBrandRepository,
  createProductRepository, createProductImageRepository, createVehicleRepository,
};
