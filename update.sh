#!/bin/bash
# KnozyBot - Güncelleme (git pull + npm install + bağımlılık kontrolü + restart)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "\n${CYAN}${BOLD}KnozyBot Güncelleniyor...${NC}\n"

# 1. Git pull
echo -e "${YELLOW}[1/5]${NC} Değişiklikler çekiliyor..."
git pull origin main

# 2. Bağımlılıkları güncelle
echo -e "${YELLOW}[2/5]${NC} npm bağımlılıkları güncelleniyor..."
npm install --production --silent

# 3. Chromium kontrolü
echo -e "${YELLOW}[3/5]${NC} Chromium tarayıcı kontrolü..."
if node -e "const p = require('puppeteer'); const fs = require('fs'); const ep = p.executablePath(); if(!fs.existsSync(ep)){process.exit(1)}" 2>/dev/null; then
    echo -e "  ${GREEN}✓ Chromium mevcut${NC}"
else
    echo -e "  ${YELLOW}→ Chromium indiriliyor (bu birkaç dakika sürebilir)...${NC}"
    npx puppeteer browsers install chrome
    echo -e "  ${GREEN}✓ Chromium indirildi${NC}"
fi

# 4. Linux sistem bağımlılıkları (sadece Debian/Ubuntu)
echo -e "${YELLOW}[4/5]${NC} Sistem bağımlılıkları kontrolü..."
if [[ "$(uname)" == "Linux" ]] && command -v dpkg &> /dev/null; then
    DEPS=(libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
          libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2
          libasound2 libatspi2.0-0 libxshmfence1)
    MISSING=()
    for dep in "${DEPS[@]}"; do
        if ! dpkg -s "$dep" &>/dev/null; then
            MISSING+=("$dep")
        fi
    done
    if [ ${#MISSING[@]} -eq 0 ]; then
        echo -e "  ${GREEN}✓ Tüm sistem kütüphaneleri mevcut${NC}"
    else
        echo -e "  ${YELLOW}→ Eksik kütüphaneler: ${MISSING[*]}${NC}"
        if [ "$(id -u)" -eq 0 ]; then
            echo -e "  → Otomatik kuruluyor..."
            apt-get update -qq && apt-get install -y -qq "${MISSING[@]}"
            echo -e "  ${GREEN}✓ Eksik kütüphaneler kuruldu${NC}"
        else
            echo -e "  ${RED}→ Root değilsiniz. Manuel kurun:${NC}"
            echo -e "    sudo apt-get install -y ${MISSING[*]}"
        fi
    fi
else
    echo -e "  ${GREEN}✓ Linux dışı sistem veya dpkg yok — atlanıyor${NC}"
fi

# 5. Restart
echo -e "${YELLOW}[5/5]${NC} Bot yeniden başlatılıyor..."
if command -v pm2 &> /dev/null; then
    nohup bash -c "sleep 2 && pm2 restart KnozyBot" > /dev/null 2>&1 &
    echo -e "  → Restart 2 saniye içinde arka planda gerçekleşecek."
else
    echo "PM2 bulunamadı, manuel restart gerekli."
fi

echo -e "\n${GREEN}${BOLD}✓ Güncelleme tamamlandı! Bot birkaç saniye içinde yeniden başlayacak.${NC}\n"
