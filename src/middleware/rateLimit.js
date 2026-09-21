/* ============================================================================
 * middleware/rateLimit.js — محدودیت نرخ درخواست
 * ----------------------------------------------------------------------------
 * فاز ۰: محدودکننده‌ها تعریف می‌شوند تا مسیرهای حساس بعدا فقط به آن‌ها
 * وصل شوند. ذخیره‌سازی در حافظه است که برای یک نمونه سرور کافی است؛
 * اگر روزی چند نمونه اجرا شد باید به یک store مشترک منتقل شود.
 * ==========================================================================*/
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

const windowMs = config.rateLimit.windowMinutes * 60 * 1000;

function build(max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    /* در حالت آزمون خاموش است تا آزمون‌ها به هم نخورند. */
    skip: () => config.isTest,
    message: { ok: false, message },
  });
}

/** محدودیت عمومی همه مسیرها — سخاوتمند، فقط جلوی سوءاستفاده آشکار. */
export const generalLimiter = build(
  config.rateLimit.generalMax,
  'تعداد درخواست‌ها زیاد بود. کمی صبر کنید.'
);

/** ورود — سخت‌گیرانه. در فاز احراز هویت استفاده می‌شود. */
export const loginLimiter = build(
  config.rateLimit.loginMax,
  'تلاش‌های ناموفق زیاد بود. چند دقیقه صبر کنید.'
);

/** آپلود رسید پرداخت — سخت‌گیرانه. در فاز سفارش استفاده می‌شود. */
export const uploadLimiter = build(
  config.rateLimit.uploadMax,
  'تعداد بارگذاری‌ها زیاد بود. کمی صبر کنید.'
);
