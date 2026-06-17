import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { logger } from '../core/logger.js';

puppeteer.use(StealthPlugin());

/**
 * ByNoGame donate sayfası okuyucu — Puppeteer (headless Chrome) ile.
 *
 * ByNoGame Cloudflare WAF koruması kullandığından basit HTTP istekleri
 * (axios vb.) 403 hatası alıyor. Puppeteer gerçek bir tarayıcı açarak
 * Cloudflare challenge'ını geçer. puppeteer-extra-plugin-stealth ise
 * otomasyon izlerini (navigator.webdriver, Chrome DevTools Protocol
 * sızıntıları vb.) gizleyerek "bot" olarak algılanmayı önler.
 *
 * Performans: Tarayıcı instance'ı cache'lenir — her 2dk'da yeni
 * Chrome açmak yerine aynı instance tekrar kullanılır. 10dk boşta
 * kalırsa otomatik kapanır, sonraki çağrıda yenisi açılır.
 */

const REQUIRED_KEYS = ['_id', 'nickName', 'message', 'amount', 'date'];

// ─── Tarayıcı instance yönetimi ─────────────────────────────────────
let browserInstance = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 dk boşta → kapat
let idleChecker = null;

async function getBrowser() {
  // Mevcut instance hâlâ açıksa tekrar kullan
  if (browserInstance) {
    try {
      if (browserInstance.isConnected()) {
        browserLastUsed = Date.now();
        return browserInstance;
      }
    } catch {
      // bağlantı kopmuş, yenisini aç
    }
    browserInstance = null;
  }

  logger.debug?.('Puppeteer tarayıcı başlatılıyor…');
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--window-size=1920,1080',
      '--lang=tr-TR,tr',
    ],
  });

  browserLastUsed = Date.now();

  // Boşta kalınca otomatik kapat
  if (idleChecker) clearInterval(idleChecker);
  idleChecker = setInterval(() => {
    if (!browserInstance) {
      clearInterval(idleChecker);
      idleChecker = null;
      return;
    }
    if (Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
      logger.debug?.('Puppeteer tarayıcı boşta — kapatılıyor');
      browserInstance.close().catch(() => {});
      browserInstance = null;
      clearInterval(idleChecker);
      idleChecker = null;
    }
  }, 60_000);

  // Beklenmedik kapanmada referansı temizle
  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  logger.debug?.('Puppeteer tarayıcı hazır');
  return browserInstance;
}

// ─── HTML parse ─────────────────────────────────────────────────────
function extractPayload(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NUXT_DATA__ bloğu bulunamadı (sayfa yapısı değişmiş olabilir)');
  return JSON.parse(match[1]);
}

function resolvePrimitive(data, idx) {
  if (typeof idx !== 'number' || idx < 0 || idx >= data.length) return undefined;
  const v = data[idx];
  return v !== null && typeof v === 'object' ? undefined : v;
}

function parseDonations(html) {
  const data = extractPayload(html);
  const seen = new Set();
  const donations = [];

  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!REQUIRED_KEYS.every((k) => k in item)) continue;

    const id = resolvePrimitive(data, item._id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    donations.push({
      id,
      opId: resolvePrimitive(data, item.opId),
      nickName: resolvePrimitive(data, item.nickName) || 'Anonim',
      message: resolvePrimitive(data, item.message) || '',
      amount: Number(resolvePrimitive(data, item.amount)) || 0,
      date: resolvePrimitive(data, item.date) || resolvePrimitive(data, item.createdAt) || null,
      isDeleted: resolvePrimitive(data, item.isDeleted) === true,
      muted: resolvePrimitive(data, item.muted) === true,
    });
  }

  donations.sort((a, b) => new Date(a.date) - new Date(b.date));
  return donations;
}

// ─── Ana modül ──────────────────────────────────────────────────────
export const bynoDonations = {
  /**
   * Donate sayfasından bağış listesini çeker (Puppeteer ile).
   * @param {string} url donate.bynogame.com/donatelist/<uuid> adresi
   * @returns {Promise<Array<{id, nickName, message, amount, date, isDeleted, muted}>>}
   */
  async fetchDonations(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      // Gerçekçi tarayıcı profili
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      });

      // Gereksiz kaynakları engelle → daha hızlı yükleme
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Sayfaya git, Nuxt verisi yüklenene kadar bekle
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      // __NUXT_DATA__ script'inin DOM'a eklenmesini bekle
      await page.waitForSelector('script#__NUXT_DATA__', { timeout: 15_000 });

      const html = await page.content();
      const donations = parseDonations(html);

      logger.debug?.('ByNoGame bağış listesi çekildi (Puppeteer)', { count: donations.length });
      return donations;
    } finally {
      // Sayfayı kapat, tarayıcıyı açık tut (cache)
      await page.close().catch(() => {});
    }
  },

  /** Tarayıcıyı manuel kapatmak için (graceful shutdown) */
  async closeBrowser() {
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
    if (idleChecker) {
      clearInterval(idleChecker);
      idleChecker = null;
    }
  },

  // Test edilebilirlik için dışa açık
  parseDonations,
};

export default bynoDonations;
