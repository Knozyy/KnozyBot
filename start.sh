#!/bin/bash
# KnozyBot - Hızlı Başlatma
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
NC='\033[0m'
BOLD='\033[1m'

if command -v pm2 &> /dev/null; then
    pm2 start index.js --name knozy-bot --env production 2>/dev/null || pm2 restart knozy-bot
    echo -e "${GREEN}${BOLD}✓ KnozyBot başlatıldı (PM2)${NC}"
    echo "  Loglar: pm2 logs knozy-bot"
else
    echo -e "${GREEN}${BOLD}✓ KnozyBot başlatılıyor...${NC}"
    node index.js
fi
