#!/usr/bin/env bash
# ============================================================
# Pulse Signals — sobe backend (Python) + frontend (Vite)
# em sessões tmux separadas, independentes do terminal.
#
# Uso:
#   ./start_bot.sh            → modo DRY-RUN (recomendado p/ sombra)
#   ./start_bot.sh --live     → modo LIVE (envia ordens; use PRACTICE)
#   ./start_bot.sh status     → mostra as sessões
#   ./start_bot.sh stop       → encerra as sessões
# ============================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

SESSION_FE="pulse_frontend"
SESSION_BE="pulse_backend"

case "${1:-}" in
  status)
    tmux ls 2>/dev/null | grep -E "^${SESSION_FE}|^${SESSION_BE}" || \
      echo "Nenhuma sessão pulse_* ativa."
    exit 0
    ;;
  stop|down)
    tmux kill-session -t "$SESSION_FE" 2>/dev/null || true
    tmux kill-session -t "$SESSION_BE" 2>/dev/null || true
    echo "Sessões encerradas."
    exit 0
    ;;
esac

LIVE_FLAG=""
if [ "${1:-}" = "--live" ]; then
  LIVE_FLAG="--live"
  echo "[AVISO] Modo LIVE: o bot enviará ordens. Use conta PRACTICE."
else
  echo "[INFO] Modo DRY-RUN (sombra). Para LIVE: ./start_bot.sh --live"
fi

# Backend: tmux + venv
if tmux has-session -t "$SESSION_BE" 2>/dev/null; then
  echo "[backend] sessão '$SESSION_BE' já existe."
else
  tmux new-session -d -s "$SESSION_BE" -c "$PROJECT_DIR" \
    "./venv/bin/python main.py --ws-server ${LIVE_FLAG}; echo '[backend] processo encerrado. Ctrl-b d já desconectou.'; sleep 86400"
  echo "[backend] sessão '$SESSION_BE' iniciada (main.py --ws-server ${LIVE_FLAG:-})."
fi

# Frontend: tmux + npm run dev
if tmux has-session -t "$SESSION_FE" 2>/dev/null; then
  echo "[frontend] sessão '$SESSION_FE' já existe."
else
  tmux new-session -d -s "$SESSION_FE" -c "$PROJECT_DIR" \
    "npm run dev; echo '[frontend] processo encerrado.'; sleep 86400"
  echo "[frontend] sessão '$SESSION_FE' iniciada (npm run dev)."
fi

echo ""
echo "Sessões tmux ativas:"
tmux ls | grep pulse || true
echo ""
echo "Acompanhar logs:"
echo "  tmux attach -t $SESSION_BE     # backend (Ctrl-b d para sair)"
echo "  tmux attach -t $SESSION_FE     # frontend (Ctrl-b d para sair)"
echo ""
echo "Dashboard: http://$(hostname -I | awk '{print $1}'):5173"
