#!/usr/bin/env bash
# ============================================================
# Pulse Signals — setup para Linux (Ubuntu/Debian)
# Idempotente: pode rodar várias vezes sem efeitos colaterais.
# Uso:  chmod +x setup_linux.sh && ./setup_linux.sh
# ============================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "==> Diretório do projeto: $PROJECT_DIR"

# ------------------------------------------------------------
# 1) Pacotes do sistema + Python + Node.js (NodeSource 22 LTS)
# ------------------------------------------------------------
if ! command -v apt-get >/dev/null 2>&1; then
  echo "[ERRO] Este script foi feito para Ubuntu/Debian (apt-get não encontrado)."
  exit 1
fi

echo "==> Atualizando pacotes do sistema..."
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Instalando Python3, venv, pip, git, tmux, curl..."
sudo apt-get install -y python3 python3-venv python3-pip git tmux curl ca-certificates gnupg

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -qE '^v(20|22|24)\.'; then
  echo "==> Instalando Node.js 22 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "==> Node.js já instalado: $(node --version)"
fi

# ------------------------------------------------------------
# 2) Ambiente virtual Python + dependências
# ------------------------------------------------------------
if [ ! -d "venv" ]; then
  echo "==> Criando ambiente virtual (venv)..."
  python3 -m venv venv
else
  echo "==> venv já existe, reutilizando."
fi

echo "==> Instalando dependências Python (requirements.txt)..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# ------------------------------------------------------------
# 3) Dependências do frontend
# ------------------------------------------------------------
echo "==> Instalando dependências Node (npm install)..."
npm install

# ------------------------------------------------------------
# 4) Timezone: America/Sao_Paulo (sessões London/NY do robô)
# ------------------------------------------------------------
CURRENT_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
if [ "$CURRENT_TZ" != "America/Sao_Paulo" ]; then
  echo "==> Configurando timezone para America/Sao_Paulo (atual: ${CURRENT_TZ:-desconhecido})..."
  sudo timedatectl set-timezone America/Sao_Paulo || \
    echo "[AVISO] timedatectl falhou; ajuste manualmente com: sudo timedatectl set-timezone America/Sao_Paulo"
else
  echo "==> Timezone já é America/Sao_Paulo."
fi

echo ""
echo "============================================================"
echo " Setup concluído."
echo " Próximo passo:  ./start_bot.sh"
echo " Dashboard:       http://<IP-DA-MAQUINA>:5173"
echo "============================================================"
