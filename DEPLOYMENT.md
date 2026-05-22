# KnozyBot Deployment Guide (Ubuntu)

KnozyBot ve KnozySunucu'yu aynı Ubuntu sunucusunda çalıştırmak için adım adım rehber.

## 📋 Ön Gereksinimler

- Ubuntu 20.04+
- Node.js v18+
- npm
- PM2 (process manager)
- Discord Bot Token

## 🚀 Kurulum Adımları

### 1. Klasör Yapısını Oluştur

```bash
mkdir -p ~/projects
cd ~/projects
```

### 2. KnozySunucu Klonla (varsa)

```bash
# Eğer KnozySunucu halihazırda yüklü değilse
git clone https://github.com/your-repo/KnozySunucu.git
cd KnozySunucu
npm install
npm start
```

KnozySunucu şu adreste çalışacak: `http://localhost:3001`

### 3. KnozyBot Kurulumu

```bash
cd ~/projects
git clone https://github.com/your-repo/KnozyBot.git
cd KnozyBot
npm install
```

### 4. Ortam Değişkenlerini Ayarla

```bash
cp .env.example .env
nano .env
```

Düzenlenecek değerler:

```env
# Discord Bot Token (Discord Developer Portal'dan al)
DISCORD_TOKEN=your_discord_bot_token_here

# Target Discord Sunucunun ID'si
TARGET_GUILD_ID=your_discord_guild_id

# KnozySunucu URL (aynı sunucu: localhost:3001)
PANEL_URL=http://localhost:3001

# Panel API Token (aşağıda oluşturacağız)
PANEL_API_TOKEN=knozy_bot_token_here
```

### 5. KnozySunucu'da API Token Oluştur

KnozySunucu'nın database'ine erişerek bot için token ekleyin:

```bash
# KnozySunucu dizininde
sqlite3 server/db/database.sqlite3
```

```sql
-- API token ekle
INSERT INTO api_tokens (name, token, created_at)
VALUES ('KnozyBot', 'knozy_bot_token_here', datetime('now'));

.exit
```

### 6. Bot Dizinini KnozySunucu'da Kaydet

KnozySunucu Panel'ine login edip "Discord" sekmesinde:
- Bot Dizini: `/home/ubuntu/projects/KnozyBot`

Veya database'e doğrudan:

```bash
sqlite3 ~/projects/KnozySunucu/server/db/database.sqlite3
```

```sql
INSERT INTO app_settings (key, value, updated_at)
VALUES ('discord_bot_dir', '/home/ubuntu/projects/KnozyBot', datetime('now'));

.exit
```

### 7. PM2 ile Bot'u Çalıştır

PM2 Kurulumu:

```bash
npm install -g pm2
```

Bot'u başlat:

```bash
cd ~/projects/KnozyBot
pm2 start index.js --name "KnozyBot" --env production
```

Log'ları görüntüle:

```bash
pm2 logs KnozyBot
```

Reboot'ta otomatik başlatma:

```bash
pm2 startup
pm2 save
```

### 8. Kontrol Et

KnozySunucu Panel'inde:
- Discord sekmesini aç
- "Status" butonuyla bot'un çalışıp çalışmadığını kontrol et

```bash
# CLI'dan kontrol
pm2 list
pm2 info KnozyBot
```

---

## 🔄 Güncellemeler

Bot kodunu güncellemek için:

```bash
cd ~/projects/KnozyBot
git pull origin main
npm install
pm2 restart KnozyBot
```

---

## 🐛 Troubleshooting

### Bot başlamıyor

```bash
# Log'ları kontrol et
pm2 logs KnozyBot

# Manual test
cd ~/projects/KnozyBot
npm start
# Hata mesajını oku
```

### API Token hatası

```
Error: Panel API Error: 401 Unauthorized
```

Token'ı kontrol et:

```bash
sqlite3 ~/projects/KnozySunucu/server/db/database.sqlite3
SELECT * FROM api_tokens;
```

### Discord Token hatası

```
Error: Missing required config: discord.token
```

`.env` dosyasını kontrol et, geçerli Discord bot token'ı eklendi mi?

Discord Developer Portal'da:
1. Applications → Select your bot
2. TOKEN kopyala
3. `.env` yapıştır

### localhost:3001 erişilemiyor

```bash
# KnozySunucu çalışıyor mu?
ps aux | grep node
# veya
pm2 list
```

---

## 📊 Directory Structure

```
~/projects/
├── KnozySunucu/
│   ├── server/
│   │   ├── db/database.sqlite3
│   │   ├── services/discordBotService.js (güncellenmiş)
│   │   └── routes/discord.js (güncellenmiş)
│   └── client/
└── KnozyBot/
    ├── .env (GITIGNORE'da)
    ├── index.js
    ├── core/
    ├── commands/
    ├── prefixCommands/
    ├── events/
    ├── tasks/
    ├── services/
    ├── utils/
    ├── components/
    └── logs/bot.log
```

---

## 🔐 Security Notes

- `.env` dosyasını hiçbir zaman git'e commit etmeyin
- API token'ı güvenli tutun (sadece KnozyBot'un erişebilmesi)
- Discord bot token'ını herkese vermeyin
- Production'da `NODE_ENV=production` olmalı

---

## 📞 API Endpoints

Bot, KnozySunucu'nun şu endpoint'lerini kullanır:

```
GET    /api/discord/bot-settings     → Bot ayarları oku
PUT    /api/discord/bot-settings     → Bot ayarları kaydet
GET    /api/discord/bot-status       → Bot durumu
POST   /api/discord/bot-command      → start/stop/restart
GET    /api/discord/bot-logs         → Log'ları oku
GET    /api/discord/whitelist        → Whitelist listesi
POST   /api/discord/whitelist        → Whitelist ekle
DELETE /api/discord/whitelist/:id    → Whitelist sil
GET    /api/discord/timed-roles      → Süreli roller
POST   /api/discord/timed-roles      → Rol ekle
DELETE /api/discord/timed-roles/:idx → Rol sil
```

---

## ✅ Kontrol Listesi

- [ ] Node.js v18+ kurulu
- [ ] npm kurulu
- [ ] KnozySunucu'da çalışıyor
- [ ] Discord bot token hazır
- [ ] `.env` dosyası hazırlanmış
- [ ] API token KnozySunucu'da oluşturulmuş
- [ ] Bot dizini KnozySunucu'da kaydedilmiş
- [ ] PM2 kurulu ve çalışıyor
- [ ] PM2 startup ayarlanmış
- [ ] Log'larda hata yok
- [ ] KnozySunucu'nda bot status "running" gösteriyor

---

**Sorun? Log'ları kontrol et:**
```bash
tail -f ~/projects/KnozyBot/logs/bot.log
```
