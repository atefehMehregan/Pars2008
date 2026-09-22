/* ============================================================================
 * controllers/adminCatalogController.js — مدیریت کاتالوگ
 * ----------------------------------------------------------------------------
 * کنترلر فقط HTTP می‌داند: پارامتر می‌خواند، سرویس فرم را صدا می‌زند،
 * مخزن را به کار می‌گیرد و قالب رندر می‌کند. نه SQL اینجا هست، نه منطق
 * احراز هویت، نه بررسی CSRF — آن‌ها لایهٔ خودشان را دارند.
 *
 * دو تصمیمِ رفتاری که در کل این فایل یکسان‌اند:
 *
 *   ۱. خطای اعتبارسنجی → ۴۲۲ و رندر دوبارهٔ *همان* فرم با مقدارهای
 *      فرستاده‌شده. هدایت، کار کاربر را دور می‌ریزد.
 *   ۲. موفقیت → هدایت ۳۰۳ به صفحهٔ بعد با یک *کد* پیام.
 *      ۳۰۳ تا رفرش مرورگر فرم را دوباره نفرستد، و کد به‌جای متن تا کسی
 *      نتواند با یک پیوند، پیام دلخواهش را داخل پنل نشان بدهد.
 * ==========================================================================*/
import { AUDIT_ACTIONS } from '../services/audit.js';
import { pageWindow } from '../services/pagination.js';
import { integer, oneOf, specsField, LIMITS } from '../services/validate.js';
import {
  parseProductForm, parseCategoryForm, parseBrandForm,
  parseProductListQuery, buildAdminQuery,
  changedFields, describeWriteError,
  PRODUCT_COLUMN_MAP, CATEGORY_COLUMN_MAP, BRAND_COLUMN_MAP,
  AVAILABILITY_VALUES, AVAILABILITY_LABELS,
  FLASH_SUCCESS, FLASH_ERRORS, DELETE_ERROR_CODES,
} from '../services/catalogAdminForm.js';

const BASE = '/admin/catalogue';
const PER_PAGE = 20;

export function createAdminCatalogController({ repositories, audit }) {
  const { products, categories, brands } = repositories;

  /* ------------------------------------------------------- کمکی‌ها ---- */

  /** پیام فلش، فقط از فهرست سفید. */
  function readFlash(req) {
    const ok = FLASH_SUCCESS[req.query?.flash];
    if (ok) return { type: 'success', text: ok };
    const bad = FLASH_ERRORS[req.query?.error];
    if (bad) return { type: 'error', text: bad };
    return null;
  }

  /** ثبت رد پا. هرگز عملیات اصلی را نمی‌شکند (خود سرویس تضمین می‌کند). */
  function record(req, action, entity, entityId, fields) {
    return audit.record({
      adminId: req.admin?.id ?? null,
      action,
      entity,
      entityId,
      /* فقط *نام* فیلدها. مقدارها — قیمت، توضیح، هر چیز دیگر — در رد پا
         جایی ندارند. */
      detail: { fields },
      ip: req.clientIp,
    });
  }

  function paginate(result, path, query) {
    if (result.pageCount <= 1) return null;
    const link = (p) => path + buildAdminQuery({ ...query, page: p });
    return {
      page: result.page,
      pageCount: result.pageCount,
      total: result.total,
      prevUrl: result.page > 1 ? link(result.page - 1) : null,
      nextUrl: result.page < result.pageCount ? link(result.page + 1) : null,
      pages: pageWindow(result.page, result.pageCount).map((p) => ({
        number: p, url: link(p), isCurrent: p === result.page,
      })),
    };
  }

  /** خطای مخزن → یا خطای فیلد، یا کد پیام برای هدایت. */
  function asFieldError(err, errors) {
    const described = describeWriteError(err);
    if (!described) return false;                  // ناشناخته: بده به errorHandler
    errors[described.field || '_general'] = described.message;
    return true;
  }

  const deleteErrorCode = (err) =>
    DELETE_ERROR_CODES[err?.constraint] || (err?.code === 'fk_restrict' ? 'blocked' : null);

  /* ==================================================== محصول‌ها ====== */

  async function productSelects() {
    const [cats, brs] = await Promise.all([categories.adminList(), brands.adminList()]);
    return { categoryOptions: cats, brandOptions: brs };
  }

  function emptyProduct() {
    return {
      name: '', slug: '', sku: '', oemNumber: '', categoryId: null, brandId: null,
      priceToman: '', salePriceToman: '', stockQty: 0, availability: 'in_stock',
      shortDescription: '', description: '', compatibilityNote: '', specs: {},
      weightGrams: '', isFeatured: false, isNew: false, isActive: true,
    };
  }

  /**
   * بدنهٔ فرستاده‌شده → شکل فرم.
   * ردیف‌های مشخصات از دو آرایهٔ موازی می‌آیند ولی قالب یک شیء می‌خواهد؛
   * بدون این تبدیل، رندر دوبارهٔ فرم پس از خطا مشخصات را گم می‌کرد.
   */
  function productBodyToForm(body = {}) {
    return { ...body, specs: specsField(body.specKey, body.specValue).value };
  }

  /** ردیف پایگاه داده → شکل فرم، تا ویرایش همان مقدارها را نشان بدهد. */
  function productToForm(row) {
    return {
      name: row.name, slug: row.slug, sku: row.sku,
      oemNumber: row.oem_number ?? '',
      categoryId: row.category_id, brandId: row.brand_id,
      priceToman: row.price_toman, salePriceToman: row.sale_price_toman ?? '',
      stockQty: row.stock_qty, availability: row.availability,
      shortDescription: row.short_description ?? '',
      description: row.description ?? '',
      compatibilityNote: row.compatibility_note ?? '',
      specs: row.specs ?? {},
      weightGrams: row.weight_grams ?? '',
      isFeatured: row.is_featured, isNew: row.is_new, isActive: row.is_active,
    };
  }

  async function renderProductForm(res, {
    status = 200, mode, values, errors = {}, warnings = [], product = null,
  }) {
    const selects = await productSelects();
    return res.status(status).render('pages/admin/products/form', {
      title: mode === 'new' ? 'محصول تازه' : 'ویرایش محصول',
      mode,
      values,
      errors,
      warnings,
      product,
      availabilityValues: AVAILABILITY_VALUES,
      availabilityLabels: AVAILABILITY_LABELS,
      ...selects,
      flash: null,
    });
  }

  async function productIndex(req, res, next) {
    try {
      const { q, category, brand, active, page } = parseProductListQuery(req.query);
      const result = await products.adminList({
        filters: {
          term: q || null,
          categoryId: category,
          brandId: brand,
          isActive: active === null ? undefined : active,
        },
        page,
        perPage: PER_PAGE,
      });
      const selects = await productSelects();
      const query = {
        q,
        category,
        brand,
        active: active === null ? '' : (active ? 'yes' : 'no'),
      };

      res.render('pages/admin/products/index', {
        title: 'محصول‌ها',
        result,
        items: result.items,
        filters: query,
        queryString: buildAdminQuery({ ...query, page }),
        pagination: paginate(result, `${BASE}/products`, query),
        availabilityLabels: AVAILABILITY_LABELS,
        ...selects,
        flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  async function productNew(req, res, next) {
    try {
      await renderProductForm(res, { mode: 'new', values: emptyProduct() });
    } catch (err) { next(err); }
  }

  async function productCreate(req, res, next) {
    try {
      const { values, errors, warnings } = parseProductForm(req.body);
      if (Object.keys(errors).length) {
        return renderProductForm(res, { status: 422, mode: 'new', values: productBodyToForm(req.body), errors, warnings });
      }
      let id;
      try {
        id = await products.create(values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return renderProductForm(res, { status: 422, mode: 'new', values: productBodyToForm(req.body), errors, warnings });
      }
      await record(req, AUDIT_ACTIONS.PRODUCT_CREATED, 'product', id, Object.keys(PRODUCT_COLUMN_MAP));
      res.redirect(303, `${BASE}/products/${id}/edit?flash=created`);
    } catch (err) { next(err); }
  }

  async function productEdit(req, res, next) {
    try {
      const row = await products.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/products?error=not_found`);
      const selects = await productSelects();
      res.status(200).render('pages/admin/products/form', {
        title: 'ویرایش محصول',
        mode: 'edit',
        values: productToForm(row),
        errors: {},
        warnings: [],
        product: row,
        availabilityValues: AVAILABILITY_VALUES,
        availabilityLabels: AVAILABILITY_LABELS,
        ...selects,
        flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  async function productUpdate(req, res, next) {
    try {
      const previous = await products.findById(req.params.id);
      if (!previous) return res.redirect(303, `${BASE}/products?error=not_found`);

      const { values, errors, warnings } = parseProductForm(req.body);
      const reshow = () => renderProductForm(res, {
        status: 422, mode: 'edit', values: productBodyToForm(req.body), errors, warnings, product: previous,
      });
      if (Object.keys(errors).length) return reshow();

      const changed = changedFields(previous, values, PRODUCT_COLUMN_MAP);
      try {
        await products.update(previous.id, values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return reshow();
      }
      await record(req, AUDIT_ACTIONS.PRODUCT_UPDATED, 'product', previous.id, changed);
      res.redirect(303, `${BASE}/products/${previous.id}/edit?flash=updated`);
    } catch (err) { next(err); }
  }

  /** فعال/غیرفعال — راه اصلی و بازگشت‌پذیرِ بازنشسته کردن محصول. */
  async function productSetActive(req, res, next) {
    try {
      const wanted = String(req.body?.isActive) === 'yes';
      const row = await products.setActive(req.params.id, wanted);
      const back = buildAdminQuery(listQueryFromBody(req.body));
      const sep = back ? '&' : '?';
      if (!row) return res.redirect(303, `${BASE}/products${back}${sep}error=not_found`);

      await record(req, AUDIT_ACTIONS.PRODUCT_ACTIVE_CHANGED, 'product', row.id, ['isActive']);
      const flash = row.is_active ? 'activated' : 'deactivated';
      res.redirect(303, `${BASE}/products${back}${sep}flash=${flash}`);
    } catch (err) { next(err); }
  }

  async function productStock(req, res, next) {
    try {
      const qty = integer(req.body?.stockQty, { label: 'موجودی', min: 0, max: LIMITS.STOCK_MAX });
      const avail = oneOf(req.body?.availability, AVAILABILITY_VALUES,
        { label: 'وضعیت', required: false });
      const back = buildAdminQuery(listQueryFromBody(req.body));
      const sep = back ? '&' : '?';

      if (qty.error || avail.error) {
        return res.redirect(303, `${BASE}/products${back}${sep}error=bad_stock`);
      }
      const row = await products.adjustStock(req.params.id, {
        stockQty: qty.value, availability: avail.value,
      });
      if (!row) return res.redirect(303, `${BASE}/products${back}${sep}error=not_found`);

      await record(req, AUDIT_ACTIONS.PRODUCT_STOCK_CHANGED, 'product', row.id,
        ['stockQty', 'availability']);
      res.redirect(303, `${BASE}/products${back}${sep}flash=stock`);
    } catch (err) { next(err); }
  }

  /**
   * حذف دائمی.
   *
   * جدا از «غیرفعال کردن» و پشت یک تأیید صریح. بدون کادر تأیید، هیچ
   * حذفی انجام نمی‌شود — و این بررسی سمت سرور است، نه فقط در قالب:
   * تأییدِ فقط-در-مرورگر، تأیید نیست.
   */
  async function productDelete(req, res, next) {
    try {
      const row = await products.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/products?error=not_found`);

      if (String(req.body?.confirm) !== 'yes') {
        const selects = await productSelects();
        return res.status(422).render('pages/admin/products/form', {
          title: 'ویرایش محصول',
          mode: 'edit',
          values: productToForm(row),
          errors: { _delete: 'برای حذف دائمی باید کادر تأیید را علامت بزنید.' },
          warnings: [],
          product: row,
          availabilityValues: AVAILABILITY_VALUES,
          availabilityLabels: AVAILABILITY_LABELS,
          ...selects,
          flash: null,
        });
      }

      try {
        await products.remove(row.id);
      } catch (err) {
        const code = deleteErrorCode(err);
        if (!code) return next(err);
        return res.redirect(303, `${BASE}/products/${row.id}/edit?error=${code}`);
      }
      await record(req, AUDIT_ACTIONS.PRODUCT_DELETED, 'product', row.id, ['id']);
      res.redirect(303, `${BASE}/products?flash=deleted`);
    } catch (err) { next(err); }
  }

  /** پارامترهای فهرست که فرم‌های کوچک با خود حمل می‌کنند. */
  function listQueryFromBody(body = {}) {
    const { q, category, brand, active, page } = parseProductListQuery(body);
    return { q, category, brand, active: active === null ? '' : (active ? 'yes' : 'no'), page };
  }

  /* ==================================================== دسته‌ها ======== */

  async function categoryIndex(req, res, next) {
    try {
      res.render('pages/admin/categories/index', {
        title: 'دسته‌ها',
        items: await categories.adminList(),
        flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  async function renderCategoryForm(res, { status = 200, mode, values, errors = {}, category = null }) {
    const all = await categories.adminList();
    /* دستهٔ در حال ویرایش نمی‌تواند والد خودش باشد. */
    const parentOptions = category ? all.filter((c) => String(c.id) !== String(category.id)) : all;
    return res.status(status).render('pages/admin/categories/form', {
      title: mode === 'new' ? 'دستهٔ تازه' : 'ویرایش دسته',
      mode, values, errors, category, parentOptions, flash: null,
    });
  }

  const categoryToForm = (row) => ({
    name: row.name, slug: row.slug, parentId: row.parent_id,
    description: row.description ?? '', sortOrder: row.sort_order, isActive: row.is_active,
  });

  async function categoryNew(req, res, next) {
    try {
      await renderCategoryForm(res, {
        mode: 'new',
        values: { name: '', slug: '', parentId: null, description: '', sortOrder: 0, isActive: true },
      });
    } catch (err) { next(err); }
  }

  async function categoryCreate(req, res, next) {
    try {
      const { values, errors } = parseCategoryForm(req.body);
      if (Object.keys(errors).length) {
        return renderCategoryForm(res, { status: 422, mode: 'new', values: req.body, errors });
      }
      let id;
      try {
        id = await categories.create(values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return renderCategoryForm(res, { status: 422, mode: 'new', values: req.body, errors });
      }
      await record(req, AUDIT_ACTIONS.CATEGORY_CREATED, 'category', id, Object.keys(CATEGORY_COLUMN_MAP));
      res.redirect(303, `${BASE}/categories?flash=created`);
    } catch (err) { next(err); }
  }

  async function categoryEdit(req, res, next) {
    try {
      const row = await categories.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/categories?error=not_found`);
      const all = await categories.adminList();
      res.status(200).render('pages/admin/categories/form', {
        title: 'ویرایش دسته',
        mode: 'edit',
        values: categoryToForm(row),
        errors: {},
        category: row,
        parentOptions: all.filter((c) => String(c.id) !== String(row.id)),
        flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  async function categoryUpdate(req, res, next) {
    try {
      const previous = await categories.findById(req.params.id);
      if (!previous) return res.redirect(303, `${BASE}/categories?error=not_found`);

      const { values, errors } = parseCategoryForm(req.body);

      /* حلقهٔ درخت. قید پایگاه داده فقط «والد خودش» را می‌گیرد؛
         الف ← ب ← الف را باید اینجا گرفت. */
      if (values.parentId) {
        if (String(values.parentId) === String(previous.id)) {
          errors.parentId = 'یک دسته نمی‌تواند والد خودش باشد.';
        } else if (await categories.wouldCreateCycle(previous.id, values.parentId)) {
          errors.parentId = 'این انتخاب حلقه می‌سازد: دستهٔ والد، خودش زیرمجموعهٔ همین دسته است.';
        }
      }

      const reshow = () => renderCategoryForm(res, {
        status: 422, mode: 'edit', values: req.body, errors, category: previous,
      });
      if (Object.keys(errors).length) return reshow();

      const changed = changedFields(previous, values, CATEGORY_COLUMN_MAP);
      try {
        await categories.update(previous.id, values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return reshow();
      }
      await record(req, AUDIT_ACTIONS.CATEGORY_UPDATED, 'category', previous.id, changed);
      res.redirect(303, `${BASE}/categories?flash=updated`);
    } catch (err) { next(err); }
  }

  async function categorySetActive(req, res, next) {
    try {
      const wanted = String(req.body?.isActive) === 'yes';
      const row = await categories.setActive(req.params.id, wanted);
      if (!row) return res.redirect(303, `${BASE}/categories?error=not_found`);
      await record(req, AUDIT_ACTIONS.CATEGORY_ACTIVE_CHANGED, 'category', row.id, ['isActive']);
      res.redirect(303, `${BASE}/categories?flash=${row.is_active ? 'activated' : 'deactivated'}`);
    } catch (err) { next(err); }
  }

  async function categoryDelete(req, res, next) {
    try {
      const row = await categories.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/categories?error=not_found`);
      if (String(req.body?.confirm) !== 'yes') {
        return renderCategoryForm(res, {
          status: 422, mode: 'edit', values: categoryToForm(row), category: row,
          errors: { _delete: 'برای حذف دائمی باید کادر تأیید را علامت بزنید.' },
        });
      }
      try {
        await categories.remove(row.id);
      } catch (err) {
        const code = deleteErrorCode(err);
        if (!code) return next(err);
        return res.redirect(303, `${BASE}/categories?error=${code}`);
      }
      await record(req, AUDIT_ACTIONS.CATEGORY_DELETED, 'category', row.id, ['id']);
      res.redirect(303, `${BASE}/categories?flash=deleted`);
    } catch (err) { next(err); }
  }

  /* ==================================================== برندها ======== */

  async function brandIndex(req, res, next) {
    try {
      res.render('pages/admin/brands/index', {
        title: 'برندها',
        items: await brands.adminList(),
        flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  const brandToForm = (row) => ({
    name: row.name, slug: row.slug, country: row.country ?? '', isActive: row.is_active,
  });

  function renderBrandForm(res, { status = 200, mode, values, errors = {}, brand = null, flash = null }) {
    return res.status(status).render('pages/admin/brands/form', {
      title: mode === 'new' ? 'برند تازه' : 'ویرایش برند',
      mode, values, errors, brand, flash,
    });
  }

  async function brandNew(req, res, next) {
    try {
      renderBrandForm(res, { mode: 'new', values: { name: '', slug: '', country: '', isActive: true } });
    } catch (err) { next(err); }
  }

  async function brandCreate(req, res, next) {
    try {
      const { values, errors } = parseBrandForm(req.body);
      if (Object.keys(errors).length) {
        return renderBrandForm(res, { status: 422, mode: 'new', values: req.body, errors });
      }
      let id;
      try {
        id = await brands.create(values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return renderBrandForm(res, { status: 422, mode: 'new', values: req.body, errors });
      }
      await record(req, AUDIT_ACTIONS.BRAND_CREATED, 'brand', id, Object.keys(BRAND_COLUMN_MAP));
      res.redirect(303, `${BASE}/brands?flash=created`);
    } catch (err) { next(err); }
  }

  async function brandEdit(req, res, next) {
    try {
      const row = await brands.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/brands?error=not_found`);
      renderBrandForm(res, {
        mode: 'edit', values: brandToForm(row), brand: row, flash: readFlash(req),
      });
    } catch (err) { next(err); }
  }

  async function brandUpdate(req, res, next) {
    try {
      const previous = await brands.findById(req.params.id);
      if (!previous) return res.redirect(303, `${BASE}/brands?error=not_found`);

      const { values, errors } = parseBrandForm(req.body);
      const reshow = () => renderBrandForm(res, {
        status: 422, mode: 'edit', values: req.body, errors, brand: previous,
      });
      if (Object.keys(errors).length) return reshow();

      const changed = changedFields(previous, values, BRAND_COLUMN_MAP);
      try {
        await brands.update(previous.id, values);
      } catch (err) {
        if (!asFieldError(err, errors)) return next(err);
        return reshow();
      }

      /* تغییر نام برند، متن جست‌وجوی محصول‌هایش را کهنه می‌کند: نام
         قدیمی داخل search_text می‌ماند و محصول با نام تازه پیدا نمی‌شود.
         بازسازی فقط وقتی لازم است که نام واقعا عوض شده باشد. */
      if (changed.includes('name')) {
        await products.refreshSearchTextForBrand(previous.id);
      }

      await record(req, AUDIT_ACTIONS.BRAND_UPDATED, 'brand', previous.id, changed);
      res.redirect(303, `${BASE}/brands?flash=updated`);
    } catch (err) { next(err); }
  }

  async function brandSetActive(req, res, next) {
    try {
      const wanted = String(req.body?.isActive) === 'yes';
      const row = await brands.setActive(req.params.id, wanted);
      if (!row) return res.redirect(303, `${BASE}/brands?error=not_found`);
      await record(req, AUDIT_ACTIONS.BRAND_ACTIVE_CHANGED, 'brand', row.id, ['isActive']);
      res.redirect(303, `${BASE}/brands?flash=${row.is_active ? 'activated' : 'deactivated'}`);
    } catch (err) { next(err); }
  }

  async function brandDelete(req, res, next) {
    try {
      const row = await brands.findById(req.params.id);
      if (!row) return res.redirect(303, `${BASE}/brands?error=not_found`);
      if (String(req.body?.confirm) !== 'yes') {
        return renderBrandForm(res, {
          status: 422, mode: 'edit', values: brandToForm(row), brand: row,
          errors: { _delete: 'برای حذف دائمی باید کادر تأیید را علامت بزنید.' },
        });
      }
      try {
        await brands.remove(row.id);
      } catch (err) {
        const code = deleteErrorCode(err);
        if (!code) return next(err);
        return res.redirect(303, `${BASE}/brands?error=${code}`);
      }
      await record(req, AUDIT_ACTIONS.BRAND_DELETED, 'brand', row.id, ['id']);
      res.redirect(303, `${BASE}/brands?flash=deleted`);
    } catch (err) { next(err); }
  }

  return {
    productIndex, productNew, productCreate, productEdit, productUpdate,
    productSetActive, productStock, productDelete,
    categoryIndex, categoryNew, categoryCreate, categoryEdit, categoryUpdate,
    categorySetActive, categoryDelete,
    brandIndex, brandNew, brandCreate, brandEdit, brandUpdate,
    brandSetActive, brandDelete,
  };
}
