import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, '../data/donations.json');
const CONFIG_FILE = path.join(__dirname, '../data/donation.config.json');

// Karışmaya müsait karakterler yok (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_SEEN = 2000;
const MAX_PROCESSED = 500;

const DEFAULT_CONFIG = {
  // Bağış mesajında aranacak kod öneki: KNZ-XXXX
  codePrefix: 'KNZ',
  // /bagis ile alınan kodun geçerlilik süresi (saat)
  claimTtlHours: 72,
  // Kodsuz/eşleşmeyen bağışlarda admin kanalına bildirim için alt limit (₺)
  minNotifyAmount: 50,
  // Paketler: type 'timed_role' → Discord süreli rol, 'vip' → paneldeki VIP paketi
  packages: [
    {
      id: 'sunucu-uyelik',
      label: 'Sunucu Katılım Üyeliği (30 gün)',
      type: 'timed_role',
      roleId: 'ROL_ID_BURAYA',
      durationDays: 30,
      price: 150,
      stackable: true,
      enabled: false,
    },
    {
      id: 'vip',
      label: 'VIP Üyelik',
      type: 'vip',
      vipPackageId: 1,
      price: 250,
      stackable: true,
      enabled: false,
    },
  ],
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function emptyStore() {
  return { baselined: false, seen: {}, claims: [], processed: [] };
}

function generateCode(prefix, existingCodes) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let suffix = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    const code = `${prefix}-${suffix}`;
    if (!existingCodes.has(code)) return code;
  }
  throw new Error('Benzersiz kod üretilemedi');
}

export const donationStore = {
  /** Paket/sistem ayarlarını okur; dosya yoksa şablon oluşturur (paketler kapalı gelir). */
  getConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
      writeJson(CONFIG_FILE, DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const cfg = readJson(CONFIG_FILE, DEFAULT_CONFIG);
    return {
      ...DEFAULT_CONFIG,
      ...cfg,
      packages: Array.isArray(cfg.packages) ? cfg.packages : [],
    };
  },

  enabledPackages() {
    return this.getConfig().packages.filter((p) => p.enabled);
  },

  getPackage(id) {
    return this.getConfig().packages.find((p) => p.id === id) || null;
  },

  _load() {
    return readJson(STORE_FILE, emptyStore());
  },

  _save(store) {
    writeJson(STORE_FILE, store);
  },

  /**
   * İlk çalıştırmada mevcut bağış geçmişini "görüldü" sayar ki eski
   * bağışlara geriye dönük rol dağıtılmasın. Baseline alındıysa true döner.
   */
  ensureBaseline(donationIds) {
    const store = this._load();
    if (store.baselined) return false;
    const now = Date.now();
    for (const id of donationIds) store.seen[id] = now;
    store.baselined = true;
    this._save(store);
    return true;
  },

  isSeen(donationId) {
    return donationId in this._load().seen;
  },

  markSeen(donationId) {
    const store = this._load();
    store.seen[donationId] = Date.now();
    // En eski kayıtları buda
    const entries = Object.entries(store.seen);
    if (entries.length > MAX_SEEN) {
      entries.sort((a, b) => a[1] - b[1]);
      store.seen = Object.fromEntries(entries.slice(entries.length - MAX_SEEN));
    }
    this._save(store);
  },

  /** Kullanıcının bu paket için aktif claim'i varsa onu, yoksa yeni kod üretip döner. */
  createOrGetClaim(userId, packageId) {
    const config = this.getConfig();
    const store = this._load();
    const now = Date.now();

    const existing = store.claims.find(
      (c) => c.status === 'active' && c.userId === userId && c.packageId === packageId && c.expiresAt > now
    );
    if (existing) return { claim: existing, isNew: false };

    const activeCodes = new Set(store.claims.map((c) => c.code));
    const claim = {
      code: generateCode(config.codePrefix, activeCodes),
      userId,
      packageId,
      status: 'active',
      createdAt: now,
      expiresAt: now + config.claimTtlHours * 60 * 60 * 1000,
    };
    store.claims.push(claim);
    this._save(store);
    return { claim, isNew: true };
  },

  /** Mesaj içinde claim kodu arar (KNZ-7F3K, knz 7f3k, knz7f3k hepsi kabul). */
  findCodeInMessage(message) {
    const config = this.getConfig();
    const prefix = config.codePrefix.toUpperCase();
    const regex = new RegExp(`${prefix}[\\s-]?([${CODE_ALPHABET}]{4})`, 'i');
    const match = (message || '').toUpperCase().match(regex);
    return match ? `${prefix}-${match[1]}` : null;
  },

  findActiveClaimByCode(code) {
    const now = Date.now();
    return (
      this._load().claims.find((c) => c.status === 'active' && c.code === code && c.expiresAt > now) || null
    );
  },

  findAnyClaimByCode(code) {
    return this._load().claims.find((c) => c.code === code) || null;
  },

  completeClaim(code, donation, grantDetail) {
    const store = this._load();
    const claim = store.claims.find((c) => c.code === code && c.status === 'active');
    if (!claim) return null;
    claim.status = 'completed';
    claim.completedAt = Date.now();
    claim.donationId = donation.id;
    claim.donationAmount = donation.amount;

    store.processed.push({
      donationId: donation.id,
      code,
      userId: claim.userId,
      packageId: claim.packageId,
      amount: donation.amount,
      nickName: donation.nickName,
      grantDetail: grantDetail || '',
      ts: Date.now(),
    });
    if (store.processed.length > MAX_PROCESSED) {
      store.processed = store.processed.slice(store.processed.length - MAX_PROCESSED);
    }

    // Tamamlanan/süresi geçen eski claim'leri buda (son 200 kalsın)
    const inactive = store.claims.filter((c) => c.status !== 'active');
    if (inactive.length > 200) {
      const keep = new Set(inactive.slice(inactive.length - 200));
      store.claims = store.claims.filter((c) => c.status === 'active' || keep.has(c));
    }

    this._save(store);
    return claim;
  },

  /** Süresi geçen claim'leri expired yapar, listesini döner. */
  expireOldClaims() {
    const store = this._load();
    const now = Date.now();
    const expired = [];
    for (const claim of store.claims) {
      if (claim.status === 'active' && claim.expiresAt <= now) {
        claim.status = 'expired';
        expired.push(claim);
      }
    }
    if (expired.length) this._save(store);
    return expired;
  },
};

export default donationStore;
