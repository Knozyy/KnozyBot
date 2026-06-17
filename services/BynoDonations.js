import axios from 'axios';
import { logger } from '../core/logger.js';

/**
 * ByNoGame donate sayfası okuyucu.
 *
 * ByNoGame'in resmi API'si yok; ancak donate listesi sayfası server-rendered
 * Nuxt uygulaması ve tüm bağış verisi HTML içindeki __NUXT_DATA__ script
 * bloğunda (devalue formatında) gömülü geliyor. HTML parslamak yerine bu
 * JSON payload'ı çözüyoruz — sayfa tasarımı değişse bile veri formatı
 * Nuxt'a bağlı olduğundan çok daha dayanıklı.
 *
 * devalue formatı: tek bir düz dizi; objelerin alan değerleri dizideki
 * başka indekslere işaret eder. Örn: { nickName: 41 } → data[41] === "Knozy"
 */

const REQUIRED_KEYS = ['_id', 'nickName', 'message', 'amount', 'date'];

function extractPayload(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NUXT_DATA__ bloğu bulunamadı (sayfa yapısı değişmiş olabilir)');
  return JSON.parse(match[1]);
}

// Bir devalue indeksini çöz; sadece primitif değerler için (string/number/bool)
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

  // En yeni en üstte gelir; işleme sırası için eskiden yeniye çevir
  donations.sort((a, b) => new Date(a.date) - new Date(b.date));
  return donations;
}

export const bynoDonations = {
  /**
   * Donate sayfasından bağış listesini çeker.
   * @param {string} url donate.bynogame.com/donatelist/<uuid> adresi
   * @returns {Promise<Array<{id, nickName, message, amount, date, isDeleted, muted}>>}
   */
  async fetchDonations(url) {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        // Tam tarayıcı kimliği — "bot" içeren UA bazı WAF'larca (Cloudflare) engellenebilir
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        Accept: 'text/html',
      },
      // 5xx vb. durumlarda axios zaten throw eder
    });

    const donations = parseDonations(response.data);
    logger.debug?.('ByNoGame bağış listesi çekildi', { count: donations.length });
    return donations;
  },

  // Test edilebilirlik için dışa açık
  parseDonations,
};

export default bynoDonations;
