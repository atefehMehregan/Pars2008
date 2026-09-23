/* ============================================================================
 * controllers/homeController.js — صفحهٔ اصلی فروشگاه
 * ----------------------------------------------------------------------------
 * همان الگوی تزریق بقیهٔ کنترلرها: مخزن‌ها از بیرون می‌آیند، پس آزمون
 * می‌تواند PGlite بدهد و لایهٔ اتصال تولید دست‌نخورده بماند.
 *
 * قاعده‌ها:
 *   * هیچ SQL اینجا نیست. فقط متدهای موجود مخزن صدا زده می‌شوند؛ هیچ
 *     کوئری تازه‌ای برای صفحهٔ اصلی نوشته نشده است.
 *   * هیچ محصول، دسته یا برندی ساختگی نیست. اگر کاتالوگ خالی باشد،
 *     صفحه همان را صادقانه می‌گوید — نه کارت‌های نمونه.
 * ==========================================================================*/

/* تعداد قلم در هر قفسهٔ صفحهٔ اصلی. چهار ستون در دسکتاپ، دو ردیف. */
export const SHELF_SIZE = 8;

export function createHomeController({ products, categories, brands }) {
  /**
   * GET /
   *
   * سه قفسهٔ ممکن وجود دارد و عمدا همه با هم نشان داده نمی‌شوند:
   *
   *   «ویژه» و «تازه» قفسه‌های *انتخاب‌شده*‌اند و از پرچم‌های is_featured
   *   و is_new می‌آیند. «تازه‌ترین» فقط وقتی می‌آید که هیچ‌کدام از آن دو
   *   چیزی نداشته باشند.
   *
   * چرا؟ چون کاتالوگ کوچک است و یک محصولِ هم-ویژه-هم-تازه در غیر این صورت
   * سه بار پشت سر هم در یک صفحه تکرار می‌شد — که خرابی به نظر می‌رسد،
   * نه ویترین.
   */
  async function home(req, res, next) {
    try {
      const [featured, fresh, latest, categoryList, brandList] = await Promise.all([
        products.list({ filters: { isFeatured: true }, sort: 'newest', page: 1, perPage: SHELF_SIZE }),
        products.list({ filters: { isNew: true }, sort: 'newest', page: 1, perPage: SHELF_SIZE }),
        products.list({ sort: 'newest', page: 1, perPage: SHELF_SIZE }),
        categories.listWithCounts(),
        brands.listWithCounts(),
      ]);

      const featuredItems = featured.items;
      const freshItems = fresh.items;

      res.render('pages/home', {
        title: 'قطعات یدکی پژو ۲۰۰۸',
        metaDescription:
          'پارس ۲۰۰۸ — فروشگاه اینترنتی قطعات یدکی پژو ۲۰۰۸. جست‌وجو بر اساس نام قطعه، کد کالا یا شماره فنی.',
        featuredItems,
        freshItems,
        latestItems: (featuredItems.length === 0 && freshItems.length === 0) ? latest.items : [],
        categoryList,
        brandList,
        totalProducts: latest.total,
        catalogueEmpty: latest.total === 0,
      });
    } catch (err) {
      next(err);
    }
  }

  return { home };
}
