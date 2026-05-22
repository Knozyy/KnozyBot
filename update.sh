#!/bin/bash
# KnozyBot - Güncelleme (git pull + npm install + restart)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "\n${CYAN}${BOLD}KnozyBot Güncelleniyor...${NC}\n"

# 1. Git pull
echo -e "${YELLOW}[1/3]${NC} Değişiklikler çekiliyor..."
git pull origin main

# 2. Bağımlılıkları güncelle
echo -e "${YELLOW}[2/3]${NC} Bağımlılıklar güncelleniyor..."
npm install --production --silent

# 3. Restart
echo -e "${YELLOW}[3/3]${NC} Bot yeniden başlatılıyor..."
if command -v pm2 &> /dev/null; then
    nohup bash -c "sleep 2 && pm2 restart knozy-bot" > /dev/null 2>&1 &
    echo -e "  → Restart 2 saniye içinde arka planda gerçekleşecek."
else
    echo "PM2 bulunamadı, manuel restart gerekli."
fi

echo -e "\n${GREEN}${BOLD}✓ Güncelleme tamamlandı! Bot birkaç saniye içinde yeniden başlayacak.${NC}\n"
