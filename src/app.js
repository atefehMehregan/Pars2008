/* ============================================================================
 * app.js — ساخت برنامه Express
 * ----------------------------------------------------------------------------
 * این فایل فقط برنامه را می‌سازد و برمی‌گرداند؛ به پورتی گوش نمی‌دهد.
 * راه‌اندازی در server.js است. این جدایی باعث می‌شود آزمون‌ها بتوانند
 * برنامه را بدون بالا آوردن سرور واقعی بسازند.
 * ==========================================================================*/
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import nunjucks from 'nunjucks';
import path from 'node:path';
import { config, ROOT } from './config/index.js';
import { extraSecurityHeaders, csrfToken, notFound, errorHandler } from './middleware/security.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { healthRouter } from './routes/health.js';
import { pageRouter } from './routes/pages.js';
import { faDigits, formatToman, formatJalali } from './services/format.js';

export function createApp() {
  const app = express();

  /* پشت پراکسی (IIS/ARR یا Nginx) آی‌پی واقعی در X-Forwarded-For است. */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /* ---------------------------------------------------------- قالب‌ها */
  /* Nunjucks به‌جای EJS انتخاب شده است: وراثت قالب (extends/block) برای
     یک فروشگاه چندصفحه‌ای تمیزتر از کنار هم چیدن partial است، و
     autoescape به‌صورت پیش‌فرض روشن است که یک لایه دفاع در برابر XSS
     می‌دهد بدون اینکه به یادآوری برنامه‌نویس وابسته باشد. */
  const viewsDir = path.join(ROOT, 'src', 'views');
  const njk = nunjucks.configure(viewsDir, {
    autoescape: true,
    express: app,
    /* watch به chokidar نیاز دارد و برای ما ارزشی ندارد: noCache در حالت
       توسعه خودش باعث می‌شود تغییر قالب بلافاصله دیده شود. یک وابستگی کمتر. */
    noCache: !config.isProd,
  });
  app.set('view engine', 'njk');

  /* کمک‌کننده‌های نمایش فارسی — مقدار خام در پایگاه داده می‌ماند و
     تبدیل فقط در لحظه نمایش انجام می‌شود. */
  njk.addFilter('faDigits', faDigits);
  njk.addFilter('toman', formatToman);
  njk.addFilter('jalali', formatJalali);

  /* ------------------------------------------------------- میان‌افزارها */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],   // بازبینی شود وقتی CSS نهایی آمد
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    /* HSTS فقط در تولید و پشت HTTPS معنا دارد. */
    hsts: config.isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(extraSecurityHeaders);

  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(generalLimiter);

  /* آی‌پی یک بار حساب می‌شود تا همه‌جا یکسان باشد. */
  app.use((req, res, next) => {
    req.clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    next();
  });

  app.use(csrfToken);

  /* متغیرهای مشترک همه قالب‌ها. */
  app.use((req, res, next) => {
    res.locals.storeName = 'پارس ۲۰۰۸';
    res.locals.storeNameLatin = '2008Pars';
    res.locals.currentPath = req.path;
    res.locals.year = new Date().getFullYear();
    next();
  });

  /* --------------------------------------------------- فایل‌های استاتیک */
  app.use(express.static(path.join(ROOT, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    etag: true,
  }));

  /* مشتقات تصویر محصول عمدا عمومی‌اند (واترمارک‌خورده).
     originals و receipts هرگز اینجا سرو نمی‌شوند. */
  app.use('/media/products', express.static(config.storage.products, {
    maxAge: config.isProd ? '30d' : 0,
    index: false,
    dotfiles: 'deny',
  }));

  /* ------------------------------------------------------------ مسیرها */
  app.use('/', healthRouter);
  app.use('/', pageRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
