import { execSync, exec } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '../core/logger.js';

/**
 * Startup Health Check — VPS aktarımı, yeni kurulum veya güncelleme sonrası
 * tüm bağımlılıkları otomatik kontrol eder ve eksikleri kurar.
 *
 * Kontrol listesi:
 *  1. Node.js sürümü (≥18 gerekli)
 *  2. node_modules var mı, yoksa npm install çalıştır
 *  3. Puppeteer Chromium binary var mı, yoksa indir
 *  4. Linux sistem kütüphaneleri (libatk, libnss3 vb.) var mı, yoksa kur
 *  5. PM2 kurulu mu (opsiyonel uyarı)
 */

const REQUIRED_NODE_MAJOR = 18;

// Chromium'un Linux'ta ihtiyaç duyduğu sistem kütüphaneleri
const LINUX_DEPS = [
  'libnss3', 'libatk1.0-0', 'libatk-bridge2.0-0', 'libcups2',
  'libdrm2', 'libxkbcommon0', 'libxcomposite1', 'libxdamage1',
  'libxrandr2', 'libgbm1', 'libpango-1.0-0', 'libcairo2',
  'libasound2', 'libatspi2.0-0', 'libxshmfence1',
];

function runCmd(cmd, silent = true) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: silent ? 'pipe' : 'inherit',
    }).trim();
  } catch {
    return null;
  }
}

function runCmdAsync(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf8', timeout: 300_000 }, (err, stdout) => {
      resolve(err ? null : (stdout || '').trim());
    });
  });
}

function isLinux() {
  return process.platform === 'linux';
}

function isRoot() {
  return process.getuid?.() === 0;
}

// ─── Kontroller ─────────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < REQUIRED_NODE_MAJOR) {
    logger.error(`❌ Node.js v${REQUIRED_NODE_MAJOR}+ gerekli, mevcut: v${process.versions.node}`);
    return false;
  }
  logger.info(`✅ Node.js v${process.versions.node}`);
  return true;
}

function checkNodeModules(projectDir) {
  const nmPath = `${projectDir}/node_modules`;
  if (!existsSync(nmPath)) {
    logger.warn('⚠️  node_modules bulunamadı — npm install çalıştırılıyor…');
    const result = runCmd(`cd "${projectDir}" && npm install --production`, false);
    if (result === null) {
      logger.error('❌ npm install başarısız');
      return false;
    }
    logger.info('✅ npm install tamamlandı');
  } else {
    logger.info('✅ node_modules mevcut');
  }
  return true;
}

async function checkChromium() {
  try {
    // Puppeteer'ın Chromium yolunu bulmaya çalış
    const puppeteer = await import('puppeteer');
    const browserPath = puppeteer.default.executablePath?.() || puppeteer.executablePath?.();

    if (browserPath && existsSync(browserPath)) {
      logger.info(`✅ Chromium mevcut: ${browserPath}`);
      return true;
    }
  } catch {
    // import başarısız → node_modules eksik, zaten checkNodeModules yakalar
  }

  // Chromium bulunamadı — indir
  logger.warn('⚠️  Chromium bulunamadı — indiriliyor (bu birkaç dakika sürebilir)…');
  const result = runCmd('npx puppeteer browsers install chrome', false);
  if (result === null) {
    logger.error('❌ Chromium indirilemedi. Manuel: npx puppeteer browsers install chrome');
    return false;
  }
  logger.info('✅ Chromium indirildi');
  return true;
}

function checkLinuxDeps() {
  if (!isLinux()) {
    logger.info('✅ Sistem: Windows/macOS — Linux bağımlılık kontrolü atlanıyor');
    return true;
  }

  // dpkg varsa Debian/Ubuntu ailesi
  if (!runCmd('which dpkg')) {
    logger.info('✅ Sistem: dpkg bulunamadı (RPM tabanlı distro?), bağımlılık kontrolü atlanıyor');
    return true;
  }

  // 22.04 vs 24.04 uyumluluğu için libasound2 vs libasound2t64 tespiti yapalım
  const finalDeps = [...LINUX_DEPS];
  const alsaIndex = finalDeps.indexOf('libasound2');
  if (alsaIndex !== -1) {
    const hasT64 = runCmd('apt-cache show libasound2t64 2>/dev/null');
    if (hasT64) {
      finalDeps[alsaIndex] = 'libasound2t64';
    }
  }

  const missing = [];
  for (const dep of finalDeps) {
    const status = runCmd(`dpkg -s ${dep} 2>/dev/null | grep "Status:"`);
    if (!status || !status.includes('install ok installed')) {
      // Sadece apt reposunda mevcut olan paketleri listeye ekle (hata almamak için)
      if (runCmd(`apt-cache show ${dep} 2>/dev/null`)) {
        missing.push(dep);
      }
    }
  }

  if (missing.length === 0) {
    logger.info('✅ Linux sistem kütüphaneleri tamam');
    return true;
  }

  logger.warn(`⚠️  Eksik sistem kütüphaneleri: ${missing.join(', ')}`);

  if (isRoot()) {
    logger.info('🔧 Root olarak çalışıyor — otomatik kuruluyor…');
    const result = runCmd(`apt-get update -qq && apt-get install -y -qq ${missing.join(' ')}`, false);
    if (result === null) {
      logger.error(`❌ Otomatik kurulum başarısız. Manuel: apt-get install -y ${missing.join(' ')}`);
      return false;
    }
    logger.info('✅ Eksik kütüphaneler kuruldu');
    return true;
  }

  logger.warn(`⚠️  Root değilsiniz — kütüphaneleri manuel kurun:\n   sudo apt-get install -y ${missing.join(' ')}`);
  return false; // kritik değil, Puppeteer denemede hata verirse daha net anlaşılır
}

function checkPM2() {
  if (runCmd('which pm2') || runCmd('where pm2')) {
    logger.info('✅ PM2 kurulu');
    return true;
  }
  logger.warn('⚠️  PM2 bulunamadı — önerilir: npm install -g pm2');
  return true; // kritik değil
}

// ─── Test: Puppeteer gerçekten çalışıyor mu? ────────────────────────

async function testPuppeteerLaunch() {
  try {
    const pExtra = await import('puppeteer-extra');
    const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
    const puppeteer = pExtra.default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 15_000,
    });
    const version = await browser.version();
    await browser.close();
    logger.info(`✅ Puppeteer test geçti — ${version}`);
    return true;
  } catch (err) {
    logger.error(`❌ Puppeteer başlatılamadı: ${err.message}`);
    if (err.message.includes('shared libraries') || err.message.includes('libatk') || err.message.includes('libnss')) {
      logger.error('   → Eksik sistem kütüphaneleri var. Çalıştırın:');
      logger.error(`   sudo apt-get install -y ${LINUX_DEPS.join(' ')}`);
    }
    return false;
  }
}

// ─── Ana fonksiyon ──────────────────────────────────────────────────

export async function runStartupChecks(projectDir) {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('🔍 Başlangıç Kontrolleri');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const results = {
    node: checkNodeVersion(),
    modules: checkNodeModules(projectDir),
    pm2: checkPM2(),
  };

  // Linux sistem bağımlılıkları (Chromium'dan önce kontrol et)
  results.linuxDeps = checkLinuxDeps();

  // Chromium binary
  results.chromium = await checkChromium();

  // Gerçek launch testi (her şey varsa)
  if (results.chromium && results.linuxDeps) {
    results.puppeteerTest = await testPuppeteerLaunch();
  } else {
    results.puppeteerTest = false;
    logger.warn('⚠️  Puppeteer test atlanıyor — önce yukarıdaki sorunları çözün');
  }

  // Sonuç özeti
  const allCritical = results.node && results.modules;
  const puppeteerOk = results.puppeteerTest;

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (allCritical && puppeteerOk) {
    logger.info('✅ Tüm kontroller başarılı — bot hazır!');
  } else if (allCritical) {
    logger.warn('⚠️  Bot başlayabilir ama Puppeteer (ByNoGame) çalışmayabilir');
  } else {
    logger.error('❌ Kritik sorunlar var — bot düzgün çalışmayabilir');
  }
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return results;
}

export default { runStartupChecks };
