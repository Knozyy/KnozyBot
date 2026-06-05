# KnozyBot + KnozySunucu — Proje Özeti

**Son Güncelleme:** 2026-05-23
**Repolar:** [Knozyy/KnozyBot](https://github.com/Knozyy/KnozyBot) · [Knozyy/KnozySunucu](https://github.com/Knozyy/KnozySunucu)

---

## 🏗️ Genel Mimari

```
                  ┌─────────────────────────────────┐
                  │   Ubuntu Sunucu (localhost)     │
                  │                                 │
   Discord  ◄────►│  ┌───────────┐   REST API     │
   Sunucusu      │  │ KnozyBot  │ ◄─────────► ┌──────────────┐
                  │  │ (Node.js) │  :3001       │ KnozySunucu  │
                  │  │ PM2       │              │ (Panel)      │
                  │  └───────────┘              │ Express + DB │
                  │                              └──────┬───────┘
                  │                                     │ spawn
                  │                              ┌──────▼───────┐
                  │                              │ Minecraft    │
                  │                              │ Java Process │
                  │                              └──────────────┘
                  └─────────────────────────────────┘
```

**Önemli:** KnozyBot artık Minecraft'a **direkt RCON** ile değil, **KnozySunucu API'si üzerinden** bağlanıyor. RCON yönetimi tamamen KnozySunucu'da.

---

## 📋 Bu Oturumda Yapılanlar

### 1. KnozyBot API Entegrasyonu Hataları Düzeltildi

| # | Dosya | Hata | Çözüm |
|---|---|---|---|
| 1 | `services/PanelAPI.js` | `getAllServers()` `{ servers: [...] }` objesi döndürüyordu, kod dizi bekliyordu | `response.data.servers \|\| []` |
| 2 | `services/PanelAPI.js` | `getServerStatus()` field isimleri uyuşmuyordu | `playerCount→onlinePlayers`, normalize edildi |
| 3 | `services/PanelAPI.js` | `getAllServersStatus()` `/api/servers/status-all` yok | Mevcut endpoint'lerle yeniden yazıldı |
| 4 | `services/PanelAPI.js` | `addWhitelist()` `nickname` gönderiyordu | `mcNick` olarak düzeltildi |
| 5 | `services/PanelAPI.js` | `addTimedRole()` field isimleri yanlış + `guild_id` eksik | `user_id`, `guild_id`, `durationDays/Hours` |

### 2. Discord Bot Status Metni Ayarı

Panelden değiştirilebilir özelleştirme:

- **`KnozySunucu/client/src/pages/DiscordPage.jsx`** — "Discord Status Metni" input alanı eklendi
- **`KnozyBot/events/ready.js`** — başlangıçta panelden okur
- **`KnozyBot/tasks/presenceUpdate.js`** — her 30sn güncellerken panelden gelen metni kullanır
- Boş bırakılırsa: otomatik `5/20 oyuncu` formatı

### 3. KnozySunucu API Düzeltmeleri

- `routes/minecraft.js` — `/api/minecraft/status` response'una sunucu adı (`name`) eklendi

### 4. Bağımsız Yönetim Scriptleri

**KnozyBot için yeni:**
- `start.sh` — PM2 ile başlatır
- `stop.sh` — PM2 ile durdurur
- `update.sh` — git pull + npm install + restart

**KnozySunucu mevcutlar:** `start.sh`, `stop.sh`, `update.sh` (sadece kendi panelini yönetir)

### 5. UI Bug Fix — MainLayout NAV

**Sorun:** Discord Bot menüsü sidebar'da gözükmüyordu.

**Sebep:** İki farklı layout dosyası vardı; aktif olan `MainLayout.jsx`'in NAV listesinde Discord yoktu (`Sidebar.jsx` kullanılmıyor).

**Çözüm:**
- `MainLayout.jsx` NAV'ına Discord Bot satırı eklendi
- `hoodoo/icons.jsx` dosyasına `Chat` ikonu eklendi

### 6. Dark Mode Düzeltmesi

**Sorun:** HooDoo paneli her zaman koyu ama Tailwind `.dark` class'ı aktif değildi → DiscordPage açık renkli görünüyordu.

**Çözüm:**
- `context/ThemeContext.jsx` → varsayılan `dark`
- `index.html` → FOUC önleyici inline script

### 7. GitHub Push

- Yeni repo: `Knozyy/KnozyBot` (private) oluşturuldu
- İlk commit + scripts + fix'ler push edildi
- KnozySunucu'ya tüm değişiklikler push edildi

---

## 🤖 KnozyBot Yapısı

```
KnozyBot/
├── 📄 index.js                    # Entry point
├── 📄 config.js                   # Config loader (.env → app config)
├── 📄 package.json
├── 📄 .env.example                # Şablon
├── 📄 .gitignore
├── 📄 README.md
├── 📄 DEPLOYMENT.md               # Ubuntu kurulum rehberi
├── 📄 STATUS.md                   # Proje durumu
├── 📄 PROJECT.md                  # Bu dosya
├── 📄 start.sh / stop.sh / update.sh
│
├── 📁 core/
│   ├── KnozyBot.js                # Bot sınıfı (loader sistemi)
│   ├── logger.js                  # Winston logger
│   └── errors.js                  # Custom errors
│
├── 📁 services/
│   ├── PanelAPI.js                # KnozySunucu REST client
│   ├── Cache.js                   # TTL cache
│   └── embeds.js                  # Discord embed builders
│
├── 📁 commands/                   # Slash komutlar
│   ├── oyuncular.js               # /oyuncular [server]
│   ├── istatistik.js              # /istatistik [server]
│   └── whitelist.js               # /whitelist kayit|bilgi|listele
│
├── 📁 prefixCommands/             # Admin komutlar (!prefix)
│   ├── wl.js                      # !wl ekle|sil|sync-mc|rol-kontrol|liste
│   ├── geciciRol.js               # !gecici-rol @user @role <süre> <birim>
│   └── sync.js                    # !sync (slash komut sync)
│
├── 📁 events/
│   ├── ready.js                   # Bot hazır olunca
│   ├── interactionCreate.js       # Slash + autocomplete
│   └── messageCreate.js           # Prefix + night guard
│
├── 📁 tasks/                      # Background görevler
│   ├── presenceUpdate.js          # 30sn — Bot status
│   ├── dashboardUpdate.js         # 60sn — Dashboard embed
│   ├── timedRolesCheck.js         # 60sn — Süreli rol kontrolü
│   ├── nightlyCleanup.js          # 00:00 — Whitelist temizliği
│   ├── serverHealthMonitor.js     # 2dk — Sunucu sağlığı
│   └── panelHeartbeat.js          # 5dk — Panel bağlantı + cache
│
├── 📁 components/
│   ├── WhitelistPaginator.js
│   └── ConfirmDialog.js
│
├── 📁 utils/
│   ├── checks.js                  # Permission helpers
│   ├── formatters.js              # Text formatlar
│   └── constants.js               # Renk, emoji, sabitler
│
├── 📁 data/                       # Local persistent data
│   ├── settings.cache.json
│   └── nightguard.json
│
└── 📁 logs/
    └── bot.log
```

### KnozyBot Özellikleri

- **5 Slash Komut:** `/oyuncular`, `/istatistik`, `/whitelist` (3 alt komut)
- **3 Prefix Komut:** `!wl`, `!gecici-rol`, `!sync`
- **6 Background Task:** presence, dashboard, roles, cleanup, health, heartbeat
- **Gece Koruma Sistemi:** Belirli saatler arası uyarı
- **Süreli Roller:** Belirli süre sonra otomatik kaldırma
- **Cache Sistemi:** API çağrılarını minimize eder
- **Error Handling:** Graceful degradation
- **Logging:** Winston (file + console)

---

## 🖥️ KnozySunucu Yapısı

```
KnozySunucu/
├── 📄 setup.sh / start.sh / stop.sh / update.sh
├── 📄 .env.example
│
├── 📁 server/                     # Backend (Node.js + Express)
│   ├── index.js                   # Entry point (port 3001)
│   ├── db/database.sqlite3        # SQLite veritabanı
│   │
│   ├── routes/
│   │   ├── auth.js                # JWT auth
│   │   ├── minecraft.js           # MC start/stop/players/status
│   │   ├── servers.js             # Sunucu CRUD
│   │   ├── discord.js             # Bot API + whitelist/roller
│   │   ├── modpacks.js
│   │   ├── files.js / mods.js / worlds.js
│   │   ├── backup.js / scheduler.js
│   │   ├── users.js / apiTokens.js / audit.js
│   │   ├── automation.js / macros.js / templates.js
│   │   ├── notifications.js / push.js
│   │   └── ...
│   │
│   ├── services/
│   │   ├── minecraftService.js    # MC Java process yönetimi
│   │   ├── serverRegistry.js      # Çoklu sunucu instance'ları
│   │   ├── discordBotService.js   # Bot yönetimi
│   │   ├── webhookService.js      # Discord webhooks
│   │   ├── timedWhitelistService.js
│   │   └── ...
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js      # JWT + API token
│   │   └── requireRole.js
│   │
│   └── public/                    # Frontend build çıktısı (cp ile)
│
└── 📁 client/                     # Frontend (React + Vite)
    ├── index.html
    ├── vite.config.js
    │
    └── src/
        ├── App.jsx                # Route tanımları
        ├── main.jsx
        │
        ├── pages/
        │   ├── DashboardPage.jsx
        │   ├── ConsolePage.jsx    # MC konsol (LIVE)
        │   ├── TerminalPage.jsx
        │   ├── PlayersPage.jsx
        │   ├── WorldsPage.jsx
        │   ├── FilesPage.jsx
        │   ├── ModpacksPage.jsx / ModsPage.jsx
        │   ├── SchedulerPage.jsx / BackupPage.jsx
        │   ├── DiscordPage.jsx    # 🆕 Discord Bot yönetim sayfası
        │   ├── ServersPage.jsx / SettingsPage.jsx
        │   └── ...
        │
        ├── components/
        │   ├── layout/
        │   │   └── MainLayout.jsx # ✅ Aktif layout (HooDoo theme)
        │   ├── Dashboard/widgets/
        │   └── CommandPalette/
        │
        ├── context/
        │   ├── AuthContext.jsx    # JWT yönetimi + canAccess()
        │   ├── ThemeContext.jsx   # Dark mode (varsayılan dark)
        │   └── I18nContext.jsx    # tr/en
        │
        ├── hoodoo/                  # HooDoo design system
        │   ├── tokens.js          # Renk paleti (sabit dark)
        │   ├── icons.jsx          # Custom SVG ikonlar
        │   ├── primitives.jsx
        │   └── charts.jsx
        │
        └── services/
            └── api.js             # Axios instance
```

### KnozySunucu Discord Sayfası Özellikleri

| Sekme | İçerik |
|---|---|
| **Whitelist** | Kayıt listesi, arama, ekle/sil |
| **Süreli Roller** | Rol ekle/sil, süre takibi |
| **RCON Kuyruğu** | Bekleyen MC komutları |
| **Durum Mesajları** | Sunucu mesajları |
| **Gece Koruması** | Gece mod ayarları (NightGuard) |
| **Oyuncu Grafiği** | 24 saatlik aktivite grafiği |
| **Webhook** | Discord bildirim URL'si |
| **⚙️ Ayarlar** | Bot dizini + **Discord Status Metni** |

---

## 🔌 API Endpoints (KnozySunucu)

### Discord Bot
```
GET    /api/discord/status           → Bot çalışıyor mu?
POST   /api/discord/start            → Bot başlat
POST   /api/discord/stop             → Bot durdur
GET    /api/discord/logs             → Son loglar
GET    /api/discord/bot-settings     → Panel ayarlarını oku (status_text vb.)
PUT    /api/discord/bot-settings     → Bot ayarlarını kaydet
GET    /api/discord/bot-status       → Bot detaylı durum
POST   /api/discord/bot-command      → start/stop/restart

GET    /api/discord/whitelist        → Whitelist listesi
POST   /api/discord/whitelist        → { userId, mcNick }
DELETE /api/discord/whitelist/:id

GET    /api/discord/timed-roles
POST   /api/discord/timed-roles      → { user_id, guild_id, role_id, durationDays, durationHours }
DELETE /api/discord/timed-roles/:idx

GET    /api/discord/rcon-queue
DELETE /api/discord/rcon-queue

GET    /api/discord/status-messages
POST   /api/discord/status-messages
DELETE /api/discord/status-messages

GET    /api/discord/webhook-config
PUT    /api/discord/webhook-config
POST   /api/discord/webhook-test

GET    /api/discord/player-history
```

### Minecraft
```
GET    /api/minecraft/status?serverId=X
POST   /api/minecraft/start|stop|restart
POST   /api/minecraft/command
GET    /api/minecraft/players
GET    /api/minecraft/properties
PUT    /api/minecraft/properties
GET    /api/minecraft/logs
GET    /api/minecraft/auto-restart
```

### Sunucular
```
GET    /api/servers
POST   /api/servers
PUT    /api/servers/:id
POST   /api/servers/:id/activate
POST   /api/servers/:id/start|stop|restart
```

### Auth
```
POST   /api/auth/login
POST   /api/auth/register
GET    /api/auth/me
POST   /api/auth/golden-key

GET    /api/tokens                   → API token CRUD
POST   /api/tokens
DELETE /api/tokens/:id
```

---

## 🚀 Deployment

### Sunucu Gereksinimleri
- Ubuntu 20.04+
- Node.js v18+
- npm
- PM2
- screen (MC sunucu yönetimi için)

### Hızlı Kurulum

```bash
# KnozySunucu
cd ~/Panel/KnozySunucu
./update.sh                # git pull + build + restart

# KnozyBot
cd ~/projects/KnozyBot
git clone https://github.com/Knozyy/KnozyBot.git .
npm install
cp .env.example .env
nano .env                  # Token + API token ekle
./start.sh
pm2 startup && pm2 save
```

### Yönetim Komutları
```bash
# KnozySunucu
~/Panel/KnozySunucu/start.sh
~/Panel/KnozySunucu/stop.sh
~/Panel/KnozySunucu/update.sh

# KnozyBot
~/projects/KnozyBot/start.sh
~/projects/KnozyBot/stop.sh
~/projects/KnozyBot/update.sh

# PM2 izleme
pm2 list
pm2 logs knozy-sunucu
pm2 logs knozy-bot
```

---

## 🔐 Güvenlik

- `.env` dosyası `.gitignore`'da
- API token'lar `knozy_` ile başlamalı (`authMiddleware` kontrolü)
- KnozyBot panel'e Bearer token ile bağlanır
- Discord token sadece bot'ta, Panel bunu görmez
- JWT secret KnozySunucu `.env`'inde
- Whitelist + süreli roller SQLite'da

---

## 📊 Son Commit Geçmişi

**KnozySunucu:**
- `15f89fc` fix: dark mode varsayılan açık (HODO panel her zaman koyu)
- `b7c22cc` fix: MainLayout NAV'ına Discord Bot eklendi
- `1448112` fix: test yorumu kaldırıldı (build hatası düzeltildi)
- `8d8083b` start/stop/update: KnozyBot bağımlılığı kaldırıldı
- `13b56f8` Discord bot: status text setting + minecraft status name fix

**KnozyBot:**
- `4990914` start/stop/update scriptleri eklendi
- `b01f4c3` Initial commit: KnozyBot v2

---

## ⚠️ Bilinen Notlar

- Bot ilk başladığında panel API'ye bağlanır, başarısız olursa cache'den devam eder
- `presenceUpdate` her 30sn'de bir cache'den okur (5dk TTL)
- KnozySunucu Minecraft'ı Java process olarak yönetir, RCON ayrı bir kanaldan
- Aynı makinede çalışıyorsa `PANEL_URL=http://localhost:3001`
- DiscordPage HooDoo theme değil Tailwind kullanıyor — bu yüzden `.dark` class gerekli

---

**Tüm sistem production'da çalışmaya hazır 🚀**
