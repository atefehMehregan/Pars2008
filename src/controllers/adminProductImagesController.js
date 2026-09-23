/* ============================================================================
 * controllers/adminProductImagesController.js — مدیریت تصویر محصول
 * ----------------------------------------------------------------------------
 * کنترلر فقط HTTP می‌داند. پردازش تصویر کار services/images.js است،
 * نوشتن بایت کار services/storage.js، و ردیف‌ها کار مخزن.
 *
 * --------------------------------------------------------------------------
 * ترتیبِ «اول پایگاه داده، بعد فایل» — یک تصمیم آگاهانه
 *
 * در حذف، همیشه اول ردیف پاک می‌شود و بعد فایل. اگر پاک کردن فایل شکست
 * بخورد، نتیجه فایلِ یتیم روی دیسک است: فضای هدررفته، ولی هیچ ارجاع
 * شکسته‌ای در سایت نیست. ترتیب برعکس، حالت بدتری می‌ساخت — ردیفی که
 * به فایلِ نبوده اشاره می‌کند و در ویترین تصویر خراب نشان می‌دهد.
 *
 * در افزودن، ترتیب طبیعتا برعکس است (اول فایل، بعد ردیف)، پس اگر درج
 * ردیف شکست بخورد همان فایل‌های تازه‌نوشته پاک می‌شوند — جبرانِ صریح،
 * تا همان حالتِ یتیم پیش نیاید.
 * ==========================================================================*/
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { AUDIT_ACTIONS } from '../services/audit.js';
import { validateUploadedImage } from '../middleware/security.js';
import { processProductImage, inspectUploadedImage } from '../services/images.js';
import { assertImageId } from '../services/storage.js';

const BASE = '/admin/catalogue';

/* پیام‌های فلش — از فهرست سفید، مثل بقیهٔ بخش مدیر. متن دلخواه در
   نشانی یعنی هر کسی می‌تواند پیام خودش را داخل پنل نشان بدهد. */
export const IMAGE_FLASH = {
  uploaded: 'تصویرها بارگذاری شدند.',
  primary: 'تصویر اصلی عوض شد.',
  alt: 'متن جایگزین ذخیره شد.',
  reordered: 'ترتیب تصویرها ذخیره شد.',
  deleted: 'تصویر حذف شد.',
};

export const IMAGE_ERRORS = {
  not_found: 'محصول یا تصویر مورد نظر پیدا نشد.',
  none: 'فایلی انتخاب نشده بود.',
  full: 'ظرفیت تصویرهای این محصول پر است.',
};

/* واترمارک یک بار از دیسک خوانده و به PNG بزرگ تبدیل می‌شود. خط لولهٔ
   تصویر بعدا آن را برای هر اندازه کوچک می‌کند؛ اگر SVG را مستقیم
   می‌دادیم، sharp آن را با چگالی پیش‌فرض رستر می‌کرد و نتیجه در
   اندازه‌های بزرگ محو می‌شد. */
let watermarkPromise = null;
export function loadWatermark() {
  if (!config.images.watermarkEnabled) return Promise.resolve(null);
  if (!watermarkPromise) {
    watermarkPromise = fs.readFile(config.images.watermarkFile)
      .then((svg) => sharp(svg, { density: 900 }).resize({ width: 512 }).png().toBuffer())
      .catch((err) => {
        console.error('[images] واترمارک بار نشد:', err.message);
        return null;   // نبودِ واترمارک نباید جلوی آپلود را بگیرد
      });
  }
  return watermarkPromise;
}

export function createAdminProductImagesController({ repositories, storage, audit }) {
  const { products, productImages } = repositories;

  const backTo = (id, suffix = '') => `${BASE}/products/${id}/images${suffix}`;

  function readFlash(req) {
    const ok = IMAGE_FLASH[req.query?.flash];
    if (ok) return { type: 'success', text: ok };
    const bad = IMAGE_ERRORS[req.query?.error];
    if (bad) return { type: 'error', text: bad };
    return null;
  }

  function record(req, action, entityId, fields) {
    return audit.record({
      adminId: req.admin?.id ?? null,
      action,
      entity: 'product_image',
      entityId,
      /* فقط نام فیلدها و شمارش — هیچ محتوایی در رد پا نمی‌رود. */
      detail: { fields },
      ip: req.clientIp,
    });
  }

  /** مدل مشترک صفحهٔ مدیریت تصویر. */
  async function renderManager(req, res, { status = 200, product, errors = [], flash = null }) {
    const images = await productImages.listForProduct(product.id);
    return res.status(status).render('pages/admin/products/images', {
      title: 'تصویرهای محصول',
      product,
      images: images.map((img) => ({
        ...img,
        thumbUrl: storage.publicUrl(img.image_id, 'thumb', 'jpg'),
        cardUrl: storage.publicUrl(img.image_id, 'card', 'jpg'),
      })),
      imageCount: images.length,
      maxImages: config.uploads.maxImagesPerProduct,
      maxFiles: config.uploads.maxFilesPerRequest,
      maxMegabytes: Math.round(config.uploads.maxImageBytes / (1024 * 1024)),
      minDimension: config.uploads.minImageDimension,
      uploadErrors: errors,
      flash: flash ?? readFlash(req),
    });
  }

  async function loadProduct(req, res) {
    const product = await products.findById(req.params.id);
    if (!product) {
      res.redirect(303, `${BASE}/products?error=not_found`);
      return null;
    }
    return product;
  }

  /* ------------------------------- GET /products/:id/images -------- */

  async function index(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;
      return await renderManager(req, res, { product });
    } catch (err) { return next(err); }
  }

  /* ------------------------------ POST /products/:id/images -------- */

  async function upload(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;

      /* خطای خودِ Multer (حجم، تعداد، فیلد ناشناخته). */
      if (req.uploadError) {
        return await renderManager(req, res, {
          status: req.uploadError.status, product, errors: [req.uploadError.message],
        });
      }

      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.redirect(303, backTo(product.id, '?error=none'));
      }

      const existing = await productImages.countForProduct(product.id);
      const room = config.uploads.maxImagesPerProduct - existing;
      if (room <= 0) {
        return res.redirect(303, backTo(product.id, '?error=full'));
      }

      const watermark = await loadWatermark();
      const errors = [];
      let saved = 0;

      for (const [i, file] of files.entries()) {
        if (saved >= room) {
          errors.push(`ظرفیت پر شد؛ ${files.length - saved} فایل ذخیره نشد.`);
          break;
        }

        const label = `فایل ${i + 1}`;

        /* لایهٔ ۱ — اندازه و بایت‌های ابتدایی. نه پسوند، نه mimetype
           مرورگر. */
        const basic = validateUploadedImage(file.buffer);
        if (!basic.ok) { errors.push(`${label}: ${basic.message}`); continue; }

        /* لایهٔ ۲ — ابعاد واقعی، که رمزگشایی لازم دارد. */
        const inspected = await inspectUploadedImage(file.buffer);
        if (!inspected.ok) { errors.push(`${label}: ${inspected.message}`); continue; }

        /* لایهٔ ۳ — رمزگذاری دوباره، واترمارک، حذف فراداده. */
        let processed;
        try {
          processed = await processProductImage(file.buffer, { watermark, storage });
        } catch (err) {
          console.error('[images] پردازش شکست خورد:', err.message);
          errors.push(`${label}: پردازش تصویر ممکن نشد.`);
          continue;
        }

        /* جبران: اگر درج ردیف شکست بخورد، فایل‌های تازه پاک می‌شوند تا
           چیزی یتیم نماند. */
        try {
          await productImages.add({
            productId: product.id,
            imageId: processed.id,
            width: inspected.meta.width,
            height: inspected.meta.height,
            isPrimary: existing === 0 && saved === 0,
          });
        } catch (err) {
          console.error('[images] درج ردیف شکست خورد، فایل‌ها پاک می‌شوند:', err.message);
          await storage.removeImage(processed.id).catch(() => {});
          errors.push(`${label}: ذخیرهٔ اطلاعات تصویر ممکن نشد.`);
          continue;
        }

        await record(req, AUDIT_ACTIONS.PRODUCT_IMAGE_ADDED, product.id, ['imageId']);
        saved += 1;
      }

      /* اگر محصول به هر دلیل بی‌تصویرِ اصلی ماند، جانشین انتخاب می‌شود. */
      await productImages.promotePrimaryIfMissing(product.id);

      if (errors.length) {
        return await renderManager(req, res, {
          status: 422, product, errors,
          flash: saved > 0 ? { type: 'success', text: `${saved} تصویر ذخیره شد.` } : null,
        });
      }
      return res.redirect(303, backTo(product.id, '?flash=uploaded'));
    } catch (err) { return next(err); }
  }

  /* ------------------- POST /products/:id/images/:imageId/primary -- */

  async function setPrimary(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;

      const ok = await productImages.setPrimary(product.id, req.params.imageId);
      if (!ok) return res.redirect(303, backTo(product.id, '?error=not_found'));

      await record(req, AUDIT_ACTIONS.PRODUCT_IMAGE_PRIMARY, product.id, ['isPrimary']);
      return res.redirect(303, backTo(product.id, '?flash=primary'));
    } catch (err) { return next(err); }
  }

  /* ----------------------- POST /products/:id/images/:imageId/alt -- */

  async function updateAlt(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;

      const text = String(req.body?.altText ?? '').slice(0, 300);
      const row = await productImages.updateAlt(product.id, req.params.imageId, text);
      if (!row) return res.redirect(303, backTo(product.id, '?error=not_found'));

      await record(req, AUDIT_ACTIONS.PRODUCT_IMAGE_UPDATED, product.id, ['altText']);
      return res.redirect(303, backTo(product.id, '?flash=alt'));
    } catch (err) { return next(err); }
  }

  /* --------------------------- POST /products/:id/images/reorder --- */

  async function reorder(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;

      const raw = req.body?.order;
      const list = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => typeof v === 'string')
        .filter((v) => { try { assertImageId(v); return true; } catch { return false; } })
        .slice(0, config.uploads.maxImagesPerProduct);

      await productImages.reorder(product.id, list);
      await record(req, AUDIT_ACTIONS.PRODUCT_IMAGE_UPDATED, product.id, ['sortOrder']);
      return res.redirect(303, backTo(product.id, '?flash=reordered'));
    } catch (err) { return next(err); }
  }

  /* -------------------- POST /products/:id/images/:imageId/delete -- */

  async function remove(req, res, next) {
    try {
      const product = await loadProduct(req, res);
      if (!product) return undefined;

      /* اول ردیف. اگر پاک کردن فایل بعدا شکست بخورد، فایلِ یتیم می‌ماند
         که فقط فضا می‌گیرد — نه ارجاع شکسته در ویترین. */
      const row = await productImages.remove(product.id, req.params.imageId);
      if (!row) return res.redirect(303, backTo(product.id, '?error=not_found'));

      await storage.removeImage(row.image_id).catch((err) =>
        console.error('[images] فایل یتیم ماند:', row.image_id, err.message));

      /* حذف تصویر اصلی → کم‌ترین sort_order جانشین می‌شود. */
      await productImages.promotePrimaryIfMissing(product.id);

      await record(req, AUDIT_ACTIONS.PRODUCT_IMAGE_DELETED, product.id, ['imageId']);
      return res.redirect(303, backTo(product.id, '?flash=deleted'));
    } catch (err) { return next(err); }
  }

  return { index, upload, setPrimary, updateAlt, reorder, remove };
}
