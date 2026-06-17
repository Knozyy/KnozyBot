import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { execSync } from 'child_process';
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
 *
 * Otomatik bağımlılık kurulumu: Chromium açılamazsa eksik Linux
 * kütüphanelerini otomatik kurar ve tekrar dener.
 */

const REQUIRED_KEYS = ['_id', 'nickName', 'message', 'amount', 'date'];

// Chromium'un Linux'ta ihtiyaç duyduğu tüm sistem kütüphaneleri
const LINUX_DEPS = [
  'libnss3', 'libatk1.0-0', 'libatk-bridge2.0-0', 'libcups2',
  'libdrm2', 'libxkbcommon0', 'libxcomposite1', 'libxdamage1',
  'libxrandr2', 'libgbm1', 'libpango-1.0-0', 'libcairo2',
  'libasound2', 'libatspi2.0-0', 'libxshmfence1',
  'libx11-xcb1', 'libxcb-dri3-0', 'libxss1', 'libgtk-3-0',
  'libgdk-pixbuf2.0-0', 'fonts-liberation', 'xdg-utils',
];

let depsInstalled = false; // bir kere kurulduysa tekrar deneme

function tryInstallLinuxDeps() {
  if (depsInstalled || process.platform !== 'linux') return false;
  depsInstalled = true; // tekrar girmeyi önle

  try {
    const uid = process.getuid?.();
    if (uid !== 0) {
      logger.error('❌ Chromium sistem kütüphaneleri eksik ve root değilsiniz. Manuel kurun:');
      logger.error(`   sudo apt-get install -y ${LINUX_DEPS.join(' ')}`);
      return false;
    }

    // 22.04 vs 24.04 uyumluluğu için mevcut paketleri filtrele (örn: libasound2 vs libasound2t64)
    const availableDeps = [];
    for (const dep of LINUX_DEPS) {
      try {
        execSync(`apt-cache show ${dep}`, { stdio: 'ignore' });
        availableDeps.push(dep);
      } catch {
        // Eğer libasound2 bulunamazsa libasound2t64 alternatifini dene
        if (dep === 'libasound2') {
          try {
            execSync('apt-cache show libasound2t64', { stdio: 'ignore' });
            availableDeps.push('libasound2t64');
          } catch {}
        }
      }
    }

    if (availableDeps.length === 0) {
      logger.error('❌ Kurulacak hiçbir bağımlılık paketi bulunamadı.');
      return false;
    }

    logger.info('🔧 Chromium için eksik sistem kütüphaneleri otomatik kuruluyor…');
    logger.info(`📦 Kurulacak paketler: ${availableDeps.join(', ')}`);

    execSync(`apt-get update -qq && apt-get install -y -qq ${availableDeps.join(' ')}`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    logger.info('✅ Sistem kütüphaneleri kuruldu!');
    return true;
  } catch (err) {
    logger.error(`❌ Otomatik kurulum başarısız: ${err.message}`);
    logger.error(`   Manuel kurun: apt-get install -y ${LINUX_DEPS.join(' ')}`);
    return false;
  }
}

// ─── Tarayıcı instance yönetimi ─────────────────────────────────────
let browserInstance = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 dk boşta → kapat
let idleChecker = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--window-size=1920,1080',
  '--lang=tr-TR,tr',
];

function setupIdleChecker() {
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
}

async function getBrowser() {
  // Mevcut instance hâlâ açıksa tekrar kullan
  if (browserInstance) {
    try {
      if (browserInstance.isConnected()) {
        browserLastUsed = Date.now();
        return browserInstance;
      }
    } catch {
      // bağlantı kopmuş
    }
    browserInstance = null;
  }

  // İlk deneme
  logger.info('🌐 Puppeteer tarayıcı başlatılıyor…');
  try {
    browserInstance = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
  } catch (err) {
    // Shared library hatası → otomatik kur ve tekrar dene
    if (err.message.includes('shared libraries') || err.message.includes('cannot open') || err.message.includes('ENOENT')) {
      logger.warn(`⚠️ Chromium başlatılamadı (eksik kütüphane): ${err.message.split('\n')[0]}`);

      const installed = tryInstallLinuxDeps();
      if (installed) {
        logger.info('🔄 Kütüphaneler kuruldu, Chromium tekrar deneniyor…');
        browserInstance = await puppeteer.launch({ headless: 'new', args: LAUNCH_ARGS });
      } else {
        throw err; // kuralamadıysak hata fırlat
      }
    } else {
      throw err;
    }
  }

  browserLastUsed = Date.now();
  setupIdleChecker();

  // Beklenmedik kapanmada referansı temizle
  browserInstance.on('disconnected', () => {
    browserInstance = null;
  });

  logger.info('✅ Puppeteer tarayıcı hazır');
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

      // NOT: Sayfa alt kaynaklarını (resim, stil vb.) engellemek Cloudflare/WAF sisteminin 
      // tarayıcı davranış analizi tarafından bot olarak algılanmasına yol açabilir.
      // Bu yüzden tüm kaynakların doğal bir tarayıcı gibi yüklenmesine izin veriyoruz.

      // Sayfaya git
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
    } catch (err) {
      // Hata anındaki sayfa durumunu analiz et
      let pageTitle = 'Bilinmiyor';
      let currentUrl = 'Bilinmiyor';
      let pageContentSnippet = '';
      try {
        pageTitle = await page.title();
        currentUrl = page.url();
        const bodyText = await page.evaluate(() => document.body?.innerText || '');
        pageContentSnippet = bodyText.slice(0, 300).replace(/\n/g, ' ');
        
        // Ekran görüntüsü al ve kaydet
        const fs = await import('fs');
        const path = await import('path');
        const errorImgPath = path.join(process.cwd(), 'data', 'bynogame_error.png');
        
        if (!fs.existsSync(path.dirname(errorImgPath))) {
          fs.mkdirSync(path.dirname(errorImgPath), { recursive: true });
        }
        await page.screenshot({ path: errorImgPath });
        logger.warn(`📸 Hata anı ekran görüntüsü kaydedildi: ${errorImgPath}`);
      } catch (e) {
        logger.debug?.(`Hata detayı toplanamadı: ${e.message}`);
      }

      logger.warn(`❌ ByNoGame Sayfa Yükleme Hatası Detayları:`, {
        url: currentUrl,
        title: pageTitle,
        snippet: pageContentSnippet,
      });

      throw err;
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
