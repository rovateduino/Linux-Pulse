# Pulse Signals no Linux (local, sem VPS/Docker)

Guia rápido para rodar o projeto no Ubuntu/Debian exatamente como no Windows:
`python main.py` (bot/websocket) + `npm run dev` (Dashboard React).

## 1. Clonar e instalar

```bash
git clone <url-do-repo> pulse-signals
cd pulse-signals/deploy/linux
chmod +x setup_linux.sh start_bot.sh
./setup_linux.sh
```

O `setup_linux.sh` é **idempotente** — pode rodar de novo sem problemas.
Ele instala: Python 3 + venv, Node.js 22 LTS (NodeSource), tmux, dependências
do `requirements.txt` e `npm install`. Também ajusta o timezone do sistema
para `America/Sao_Paulo` (as sessões London/NY do robô dependem do relógio
correto; o Python usa o timezone do SO).

## 2. Subir o bot em background

```bash
./start_bot.sh            # modo DRY-RUN (sombra — recomendado)
./start_bot.sh --live     # modo LIVE (só com conta PRACTICE)
```

Isso cria duas sessões tmux independentes do terminal:

| Sessão tmux       | Processo                          |
|-------------------|-----------------------------------|
| `pulse_backend`   | `venv/bin/python main.py --ws-server [--live]` |
| `pulse_frontend`  | `npm run dev` (Vite, porta 5173)  |

Como é uma máquina **local**, acesse o Dashboard pelo IP da máquina na rede,
**não** por `localhost`:

```
http://192.168.1.100:5173
```

(descubra o IP com `hostname -I` — o próprio `start_bot.sh` imprime no final).

## 3. Operação do dia a dia

```bash
./start_bot.sh status   # lista as sessões ativas
./start_bot.sh stop     # encerra backend + frontend
```

Ver logs em tempo real:

```bash
tmux attach -t pulse_backend   # Ctrl-b d para sair sem matar
tmux attach -t pulse_frontend
```

Para ligar/desligar o PC: as sessões tmux **não sobrevivem a reboot**.
Depois de ligar, basta rodar `./start_bot.sh` de novo (idempotente).

## 4. Notas

- O bot precisa de acesso à IQ Option (login no terminal interativo na
  primeira execução pode ser pedido — abra `tmux attach -t pulse_backend`
  para responder prompts).
- `npm run dev` sobe o Vite; se quiser build de produção use
  `npm run build && npm run preview` dentro da sessão `pulse_frontend`.
- Dados persistidos (IndexedDB do navegador, EdgeBook, Playbook D shadow)
  ficam no navegador que acessar o Dashboard — use sempre o mesmo perfil.
