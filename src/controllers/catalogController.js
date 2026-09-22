/* ============================================================================
 * controllers/catalogController.js — صفحه‌های کاتالوگ
 * ----------------------------------------------------------------------------
 * همان الگوی تزریق فاز ۱الف: مخزن‌ها از بیرون داده می‌شوند، پس آزمون
 * می‌تواند PGlite بدهد بدون اینکه چیزی در لایهٔ اتصال تولید عوض شود.
 *
 * قاعده‌ها:
 *   * هیچ SQL اینجا نیست. کنترلر فقط پارامتر می‌خواند، مخزن را صدا می‌زند
 *     و مدل قالب را می‌سازد.
 *   * نشانیِ ناشناس ۴۰۴ می‌دهد، نه فهرست خالی — «دستهٔ لوازم ترمز وجود
 *     ندارد» و «دستهٔ لوازم ترمز خالی است» دو چیز متفاوت‌اند و کاربر باید
 *     تفاوتشان را ببیند.
 *   * مبلغ خام (عدد) به قالب می‌رود؛ قالب‌بندی فارسی کار فیلتر نمایش است.
 * ==========================================================================*/
import { notFound } from '../middleware/security.js';
import { normalizeSlugParam } from '../services/slug.js';
import { parseListingQuery, parseSearchTerm, parsePage, PER_PAGE } from '../services/catalogQuery.js';
import { buildPagination } from '../services/pagination.js';

export function createCatalogController({ products, categories, brands }) {
  /**
   * مدل مشترک همهٔ صفحه‌های فهرست.
   * دسته‌ها و برندها برای نوار کناری لازم‌اند و در هر سه صفحه یکی هستند.
   */
  async function listingChrome() {
    const [categoryList, brandList] = await Promise.all([
      categories.listWithCounts(),
      brands.listWithCounts(),
    ]);
    return { categoryList, brandList };
  }

  /** حل نشانی برند به شناسه، برای فیلتر. */
  async function resolveBrandFilter(brandSlug) {
    if (!brandSlug) return { brandId: undefined, brand: null };
    const brand = await brands.findBySlug(normalizeSlugParam(brandSlug));
    return { brandId: brand?.id, brand };
  }

  /* ------------------------------------------------- GET /products */

  async function shop(req, res) {
    const q = parseListingQuery(req.query);
    const { brandId, brand } = await resolveBrandFilter(q.brandSlug);

    const result = await products.list({
      filters: { brandId, availability: q.availability },
      sort: q.sort,
      page: q.page,
      perPage: PER_PAGE,
    });

    const chrome = await listingChrome();
    res.render('pages/shop', {
      title: 'همهٔ محصولات',
      heading: 'همهٔ محصولات',
      ...chrome,
      result,
      activeBrand: brand,
      query: q,
      pagination: buildPagination(result, '/products', {
        sort: q.sort, availability: q.availability, brand: q.brandSlug,
      }),
      /* کاتالوگ اصلا خالی است، یا فقط این فیلتر نتیجه ندارد؟ */
      catalogueEmpty: result.total === 0 && !brandId && !q.availability,
    });
  }

  /* -------------------------------------------- GET /category/:slug */

  async function category(req, res) {
    const slug = normalizeSlugParam(req.params.slug);
    const cat = slug ? await categories.findBySlug(slug) : null;
    if (!cat) return notFound(req, res);

    const q = parseListingQuery(req.query);
    const { brandId, brand } = await resolveBrandFilter(q.brandSlug);

    const result = await products.list({
      filters: { categoryId: cat.id, brandId, availability: q.availability },
      sort: q.sort,
      page: q.page,
      perPage: PER_PAGE,
    });

    const chrome = await listingChrome();
    res.render('pages/category', {
      title: cat.name,
      heading: cat.name,
      category: cat,
      ...chrome,
      result,
      activeBrand: brand,
      query: q,
      pagination: buildPagination(result, `/category/${encodeURIComponent(cat.slug)}`, {
        sort: q.sort, availability: q.availability, brand: q.brandSlug,
      }),
      catalogueEmpty: false,
    });
  }

  /* ----------------------------------------------- GET /brand/:slug */

  async function brand(req, res) {
    const slug = normalizeSlugParam(req.params.slug);
    const found = slug ? await brands.findBySlug(slug) : null;
    if (!found) return notFound(req, res);

    const q = parseListingQuery(req.query);
    const result = await products.list({
      filters: { brandId: found.id, availability: q.availability },
      sort: q.sort,
      page: q.page,
      perPage: PER_PAGE,
    });

    const chrome = await listingChrome();
    res.render('pages/shop', {
      title: `محصولات ${found.name}`,
      heading: `محصولات ${found.name}`,
      ...chrome,
      result,
      activeBrand: found,
      query: q,
      pagination: buildPagination(result, `/brand/${encodeURIComponent(found.slug)}`, {
        sort: q.sort, availability: q.availability,
      }),
      catalogueEmpty: false,
    });
  }

  /* --------------------------------------------- GET /product/:slug */

  async function product(req, res) {
    const slug = normalizeSlugParam(req.params.slug);
    const item = slug ? await products.findBySlug(slug) : null;
    if (!item) return notFound(req, res);

    const [images, vehicles] = await Promise.all([
      products.imagesFor(item.id),
      products.vehiclesFor(item.id),
    ]);

    /* specs یک شیء JSONB است؛ به زوج‌های کلید/مقدار تبدیل می‌شود تا قالب
       بتواند بدون منطق اضافه آن را جدول کند. */
    const specs = item.specs && typeof item.specs === 'object'
      ? Object.entries(item.specs).map(([key, value]) => ({ key, value }))
      : [];

    res.render('pages/product', {
      title: item.name,
      metaDescription: item.short_description || item.name,
      product: item,
      images,
      vehicles,
      specs,
      discountPercent: item.sale_price_toman
        ? Math.round((1 - item.sale_price_toman / item.price_toman) * 100)
        : 0,
    });
  }

  /* ------------------------------------------------- GET /search */

  async function search(req, res) {
    const term = parseSearchTerm(req.query.q);
    const page = parsePage(req.query.page);

    const result = term
      ? await products.search({ term, page, perPage: PER_PAGE })
      : { items: [], total: 0, page: 1, perPage: PER_PAGE, pageCount: 1, matchedBy: 'none' };

    const chrome = await listingChrome();
    res.render('pages/search', {
      title: term ? `جست‌وجو: ${term}` : 'جست‌وجو',
      term,
      ...chrome,
      result,
      pagination: buildPagination(result, '/search', { q: term }),
    });
  }

  return { shop, category, brand, product, search };
}
