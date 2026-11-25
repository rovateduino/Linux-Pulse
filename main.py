"""Conector IQ Option para exportar candles e receber comandos do PULSE SIGNALS."""

from __future__ import annotations

import argparse
import asyncio
import csv
import getpass
import json
import logging
import math
import os
import re
import secrets
import socket
import sys
import threading
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit


BATCH_SIZE = 1_000
MAX_BATCH_ATTEMPTS = 3
CSV_PATH = Path(__file__).resolve().with_name("candles_historico.csv")
TIMEFRAMES = {"M1": 60, "M5": 300}
CSV_COLUMNS = (
    "timestamp_utc",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "source",
    "asset",
    "timeframe",
    "period_start_utc",
    "period_end_utc",
)
MAX_DAILY_LOSS = 50.0
MAX_STAKE = 10.0
DAILY_LOSS_PATH = Path(__file__).resolve().with_name("daily_loss.json")
PAPER_PAYOUT = 0.85
# 1 minuto (60 s): expiração mínima aceita pelo turbo nos pares normais e OTC.
TRADE_EXPIRATION_MINUTES = 1
# Blitz: contrato de 60 s (M1), operado pela myiq (a iqoptionapi não o suporta).
BLITZ_DURATION_SECONDS = 60
# Rede de segurança: espera extra antes de deduzir o resultado pelo saldo.
BLITZ_FALLBACK_WAIT_SECONDS = 5
SUSPENDED_ASSET_MESSAGE = (
    "O ativo está suspenso na corretora. O robô tentará novamente no próximo sinal."
)
CANNOT_PURCHASE_MESSAGE = "[AVISO] Ativo indisponível no momento da compra. Pulando..."

# Conexão IQ Option.
# A biblioteca iqoptionapi não trata falhas de rede: get_ssid() devolve a
# exceção (ex.: ConnectTimeout) e connect() tenta acessar response.cookies,
# gerando AttributeError. Além disso, vários métodos usam `while True` sem
# timeout. Centralizamos aqui o diagnóstico, o limite de tempo e as tentativas.
IQ_AUTH_HOST = "auth.iqoption.com"
IQ_AUTH_PORT = 443
IQ_CONNECT_ATTEMPTS = 3
IQ_CONNECT_TIMEOUT_SECONDS = 90.0
IQ_CONNECT_RETRY_DELAY_SECONDS = 3.0
IQ_NETWORK_PROBE_TIMEOUT_SECONDS = 8.0
IQ_BALANCE_TIMEOUT_SECONDS = 30.0
IQ_CANDLES_TIMEOUT_SECONDS = 60.0
IQ_SETTLEMENT_BASE_TIMEOUT_SECONDS = 120.0

# Lista oficial monitorada: 8 OTC + 24 normais.
OTC_ASSETS = (
    "EURUSD-OTC",
    "GBPUSD-OTC",
    "USDJPY-OTC",
    "EURGBP-OTC",
    "EURJPY-OTC",
    "GBPJPY-OTC",
    "AUDCAD-OTC",
    "NZDUSD-OTC",
)
NORMAL_ASSETS = (
    "EURUSD",
    "EURGBP",
    "GBPUSD",
    "USDJPY",
    "NZDUSD",
    "AUDUSD",
    "USDCAD",
    "EURJPY",
    "GBPJPY",
    "CHFJPY",
    "EURCHF",
    "EURAUD",
    "AUDCAD",
    "AUDJPY",
    "AUDNZD",
    "CADCHF",
    "CADJPY",
    "EURCAD",
    "GBPAUD",
    "GBPCAD",
    "GBPCHF",
    "NZDCAD",
    "NZDJPY",
    "NZDCHF",
)
OFFICIAL_ASSETS = OTC_ASSETS + NORMAL_ASSETS
ASSETS_POLL_INTERVAL = 60.0
REAL_CANDLES_COUNT = 300
REAL_CANDLES_TIMEFRAME = "M1"
REAL_CANDLES_TIMEFRAME_SECONDS = 60
# M15 com histórico profundo: o Playbook D precisa de ~800 velas M15
# (200 horas H1) para a EMA200-H1 ficar válida desde o primeiro ciclo.
REAL_CANDLES_M15_TIMEFRAME = "M15"
REAL_CANDLES_M15_TIMEFRAME_SECONDS = 900
REAL_CANDLES_M15_COUNT = 1200
REAL_CANDLES_INTERVAL = 60.0
logger = logging.getLogger("pulse_signals.bot")
_iqoption_get_ssid_patched = False


class IQOptionConnectionError(RuntimeError):
    """Falha de rede/autenticação ao falar com a IQ Option."""


_websocket_loop: asyncio.AbstractEventLoop | None = None
_websocket_ready = threading.Event()
_websocket_server_thread: threading.Thread | None = None
_websocket_start_error: list[Exception] = []
_account_type = "PRACTICE"
_session_token: str | None = None
_startup_allow_live = False
_assets_poll_stop = threading.Event()
_assets_poll_thread: threading.Thread | None = None
_assets_payload_logged = False
_real_candles_stop = threading.Event()
_real_candles_thread: threading.Thread | None = None
# Cliente myiq (assíncrono) usado apenas para ordens Blitz, que a iqoptionapi
# não suporta. Roda num loop asyncio dedicado (thread daemon).
_myiq_client: Any = None
_myiq_loop: asyncio.AbstractEventLoop | None = None
_myiq_ready = threading.Event()
_myiq_start_error: list[Exception] = []
_myiq_start_lock = threading.Lock()
_myiq_session_lock = threading.Lock()
# Falhas de conexão/autenticação da myiq em que vale a pena reconectar e
# reenviar a ordem. Timeouts de liquidação NÃO entram aqui para evitar ordem
# duplicada quando a corretora já aceitou a compra.
_MYIQ_RETRYABLE_MARKERS = (
    "not connected",
    "unauthenticated",
    "authentication",
    "invalid token",
    "token expired",
    "token",
    "ssid",
    "websocket",
    "connection reset",
    "connection closed",
    "connectionerror",
)


class WebSocketHub:
    def __init__(self) -> None:
        self.connections: set[Any] = set()
        self.recent_messages: list[dict[str, Any]] = []

    async def connect(self, websocket: Any) -> None:
        await websocket.accept()
        self.connections.add(websocket)
        try:
            for message in self.recent_messages:
                await websocket.send_json(message)
        except Exception as error:  # noqa: BLE001 - cliente pode cair durante o replay
            logger.info("Cliente WebSocket desconectou durante o replay: %s", error)
            self.disconnect(websocket)

    def disconnect(self, websocket: Any) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        self.recent_messages.append(message)
        del self.recent_messages[:-100]
        # Um cliente desconectado (ex.: reload do React) não pode derrubar o
        # envio para os demais nem gerar WebSocketDisconnected no terminal.
        for websocket in tuple(self.connections):
            try:
                await websocket.send_json(message)
            except Exception as error:  # noqa: BLE001 - remove apenas o cliente ruim
                logger.info("Removendo cliente WebSocket desconectado: %s", error)
                self.disconnect(websocket)


websocket_hub = WebSocketHub()

STRATEGY_LOG_FILE_NAMES = {
    "sweep_reclaim": "sweep_reclaim.log.txt",
    "legacy": "legacy.log.txt",
    "next": "next.log.txt",
    "orb-rvol": "orb_rvol.log.txt",
    "vwap-trend": "vwap_trend.log.txt",
    "vwap-reversion": "vwap_reversion.log.txt",
    "liquidity-sweep": "liquidity_sweep.log.txt",
    "closing-momentum": "closing_momentum.log.txt",
}


class StrategyLogWriter:
    """Append validated strategy evaluations as JSONL in the project root."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(__file__).resolve().parent if root is None else root
        self._lock = threading.Lock()
        self._loaded_strategies: set[str] = set()
        self._seen_keys: dict[str, set[str]] = {}

    def _load_existing_keys(self, strategy: str, path: Path) -> None:
        if strategy in self._loaded_strategies:
            return
        keys: set[str] = set()
        if path.exists():
            with path.open("r", encoding="utf-8") as log_file:
                for line_number, line in enumerate(log_file, start=1):
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning(
                            "Ignorando linha JSONL inválida em %s:%s.",
                            path.name,
                            line_number,
                        )
                        continue
                    key = record.get("evaluation_key") if isinstance(record, dict) else None
                    if isinstance(key, str):
                        keys.add(key)
        self._seen_keys[strategy] = keys
        self._loaded_strategies.add(strategy)

    @staticmethod
    def _normalize_event(event: Any) -> dict[str, Any]:
        if not isinstance(event, dict):
            raise ValueError("Evento de estratégia inválido.")

        strategy = event.get("strategy")
        if strategy not in STRATEGY_LOG_FILE_NAMES:
            raise ValueError("Estratégia de log não permitida.")

        asset = event.get("asset")
        if (
            not isinstance(asset, str)
            or re.fullmatch(r"[A-Z0-9._-]{1,32}", asset) is None
        ):
            raise ValueError("Ativo inválido no evento de log.")

        timeframe = event.get("timeframe")
        if timeframe not in {"M1", "M5", "M15"}:
            raise ValueError("Timeframe inválido no evento de log.")

        mode = event.get("mode")
        expected_mode = "isolated" if strategy == "sweep_reclaim" else "standard"
        if mode != expected_mode:
            raise ValueError("Modo incompatível com a estratégia de log.")

        candle_time = event.get("candle_time")
        if candle_time is not None and (
            isinstance(candle_time, bool)
            or not isinstance(candle_time, (int, float))
            or not math.isfinite(candle_time)
            or candle_time <= 0
        ):
            raise ValueError("Horário do candle inválido no evento de log.")

        result = event.get("result")
        if result not in {"signal", "no_signal"}:
            raise ValueError("Resultado inválido no evento de log.")

        reason = event.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("Motivo ausente no evento de log.")

        direction = event.get("direction")
        if direction not in {None, "UP", "DOWN", "long", "short"}:
            raise ValueError("Direção inválida no evento de log.")

        details = event.get("details", {})
        if not isinstance(details, dict):
            raise ValueError("Detalhes inválidos no evento de log.")

        safe_details: dict[str, Any] = {}
        if strategy == "sweep_reclaim":
            level_type = details.get("level_type")
            if level_type not in {None, "high", "low"}:
                raise ValueError("Nível varrido inválido no evento de log.")
            safe_details["level_type"] = level_type
            for name in ("swept_level", "atr", "sweep_distance", "wick_fraction"):
                value = details.get(name)
                if value is not None and (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                ):
                    raise ValueError(f"Campo numérico inválido no log: {name}.")
                safe_details[name] = value
            reclaim_confirmed = details.get("reclaim_confirmed")
            if not isinstance(reclaim_confirmed, bool):
                raise ValueError("Confirmação de reclaim inválida no log.")
            safe_details["reclaim_confirmed"] = reclaim_confirmed
        elif strategy == "legacy":
            phase = details.get("phase")
            playbook = details.get("playbook")
            selected_engine = details.get("selected_engine")
            output_selected = details.get("output_selected")
            if phase not in {"OBSERVANDO", "ATENCAO", "ENTRAR", "EM_ANDAMENTO", "RESULTADO"}:
                raise ValueError("Fase legada inválida no evento de log.")
            if playbook not in {None, "A", "B"}:
                raise ValueError("Playbook legado inválido no evento de log.")
            if selected_engine not in {"legacy", "next"}:
                raise ValueError("Motor ativo inválido no evento de log.")
            if not isinstance(output_selected, bool):
                raise ValueError("Estado de seleção do legado inválido no log.")
            safe_details = {
                "phase": phase,
                "playbook": playbook,
                "selected_engine": selected_engine,
                "output_selected": output_selected,
            }
        elif strategy == "next":
            candidate_count = details.get("candidate_count")
            if (
                isinstance(candidate_count, bool)
                or not isinstance(candidate_count, int)
                or candidate_count < 0
            ):
                raise ValueError("Contagem de candidatos inválida no log.")
            safe_details = {"candidate_count": candidate_count}
        else:
            candidate_found = details.get("candidate_found")
            gate_allowed = details.get("gate_allowed")
            bucket = details.get("bucket")
            module_reasons = details.get("module_reasons", [])
            if not isinstance(candidate_found, bool) or not isinstance(gate_allowed, bool):
                raise ValueError("Estado do candidato inválido no log.")
            if bucket is not None and (
                not isinstance(bucket, str) or len(bucket) > 160
            ):
                raise ValueError("Bucket inválido no evento de log.")
            if (
                not isinstance(module_reasons, list)
                or len(module_reasons) > 8
                or not all(isinstance(item, str) for item in module_reasons)
            ):
                raise ValueError("Motivos do módulo inválidos no evento de log.")
            safe_details = {
                "candidate_found": candidate_found,
                "gate_allowed": gate_allowed,
                "bucket": bucket,
                "module_reasons": [item[:200] for item in module_reasons],
            }

        timestamp_key = "none" if candle_time is None else str(candle_time)
        evaluation_key = f"{strategy}|{asset}|{timeframe}|{timestamp_key}"
        return {
            "evaluation_key": evaluation_key,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
                "+00:00", "Z"
            ),
            "asset": asset,
            "timeframe": timeframe,
            "strategy": strategy,
            "mode": mode,
            "candle_time": candle_time,
            "result": result,
            "direction": direction,
            "reason": reason.strip()[:512],
            "details": safe_details,
        }

    def append(self, event: Any) -> dict[str, Any]:
        record = self._normalize_event(event)
        strategy = record["strategy"]
        path = self.root / STRATEGY_LOG_FILE_NAMES[strategy]
        with self._lock:
            self._load_existing_keys(strategy, path)
            key = record["evaluation_key"]
            if key in self._seen_keys[strategy]:
                return {"key": key, "written": True, "duplicate": True}

            with path.open("a", encoding="utf-8", newline="\n") as log_file:
                log_file.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
                log_file.write("\n")
                log_file.flush()

            self._seen_keys[strategy].add(key)
            return {"key": key, "written": True, "duplicate": False}


strategy_log_writer = StrategyLogWriter()


def validate_account_mode(
    account: str, *, live: bool, allow_real_trading: bool
) -> None:
    if account.strip().upper() != "REAL":
        return
    if not allow_real_trading:
        raise RuntimeError(
            "Conta REAL bloqueada por padrão. Defina ALLOW_REAL_TRADING=1 "
            "e inicie com --live para continuar."
        )
    if not live:
        raise RuntimeError(
            "Conta REAL exige iniciar o processo com --live, além da "
            "confirmação no terminal."
        )


def require_authenticated_action(
    action: Any,
    authenticated: bool,
    *,
    live: Any = None,
) -> None:
    if (
        action == "execute_trade"
        or (action == "set_live_mode" and live is True)
    ) and not authenticated:
        raise PermissionError(
            "Autenticação obrigatória: informe o token de sessão em Configurações."
        )


def generate_session_token() -> str:
    global _session_token
    _session_token = secrets.token_urlsafe(16)
    return _session_token


def _session_token_matches(candidate: Any) -> bool:
    return (
        isinstance(candidate, str)
        and candidate.isascii()
        and _session_token is not None
        and secrets.compare_digest(candidate, _session_token)
    )


def create_websocket_app() -> Any:
    try:
        from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    except ImportError as error:
        raise RuntimeError(
            "Dependências do servidor WebSocket ausentes. Instale-as com: "
            "python -m pip install -r requirements.txt"
        ) from error

    @asynccontextmanager
    async def lifespan(_app: Any):
        global _websocket_loop
        _websocket_loop = asyncio.get_running_loop()
        _websocket_ready.set()
        try:
            yield
        finally:
            _websocket_loop = None
            _websocket_ready.clear()

    app = FastAPI(lifespan=lifespan)

    async def websocket_endpoint(websocket: Any) -> None:
        authenticated = False
        unauthenticated_notice_sent = False
        origin = websocket.headers.get("origin")
        if origin:
            try:
                hostname = urlsplit(origin).hostname
            except ValueError:
                await websocket.close(code=1008)
                return
            if hostname not in {"localhost", "127.0.0.1", "::1"}:
                await websocket.close(code=1008)
                return

        try:
            await websocket_hub.connect(websocket)
            await websocket.send_json(
                {
                    "type": "mode_changed",
                    "live": _active_trader.live if _active_trader is not None else False,
                }
            )
        except WebSocketDisconnect:
            websocket_hub.disconnect(websocket)
            return
        except Exception as error:  # noqa: BLE001 - cliente caiu durante o handshake
            logger.info("Cliente WebSocket desconectou no handshake: %s", error)
            websocket_hub.disconnect(websocket)
            return

        try:
            while True:
                try:
                    raw_message = await websocket.receive_text()
                except WebSocketDisconnect:
                    # Reload/fechamento do React: encerra o endpoint sem erro.
                    break
                except (OSError, RuntimeError) as error:
                    logger.info("Conexão WebSocket encerrada: %s", error)
                    break
                try:
                    command = json.loads(raw_message)
                    if not isinstance(command, dict):
                        continue
                    action = command.get("action")
                    if action == "auth":
                        authenticated = _session_token_matches(command.get("token"))
                        await websocket.send_json(
                            {
                                "type": "auth_result",
                                "authenticated": authenticated,
                                **(
                                    {}
                                    if authenticated
                                    else {
                                        "reason": "Token de sessão inválido ou ausente."
                                    }
                                ),
                            }
                        )
                        continue
                    if action == "log_strategy_evaluation":
                        client_key = command.get("key")
                        try:
                            result = await asyncio.to_thread(
                                strategy_log_writer.append,
                                command.get("event"),
                            )
                        except (TypeError, ValueError) as error:
                            logger.warning("Evento de log de estratégia recusado: %s", error)
                            result = {
                                "key": client_key if isinstance(client_key, str) else "",
                                "written": False,
                                "duplicate": False,
                                "reason": "Evento de log inválido.",
                            }
                        except OSError:
                            logger.exception("Falha ao gravar arquivo de log da estratégia.")
                            result = {
                                "key": client_key if isinstance(client_key, str) else "",
                                "written": False,
                                "duplicate": False,
                                "reason": "Falha ao gravar arquivo de log da estratégia.",
                            }
                        await websocket.send_json(
                            {"type": "strategy_log_result", **result}
                        )
                        continue
                    try:
                        require_authenticated_action(
                            action,
                            authenticated,
                            live=command.get("live"),
                        )
                    except PermissionError as error:
                        if not unauthenticated_notice_sent:
                            logger.warning(
                                "Comando WebSocket recusado: cliente não autenticado."
                            )
                            await websocket.send_json(
                                {
                                    "type": "auth_result",
                                    "authenticated": False,
                                    "reason": str(error),
                                }
                            )
                            unauthenticated_notice_sent = True
                        continue
                    if action == "set_live_mode":
                        try:
                            live = command.get("live")
                            if not isinstance(live, bool):
                                raise ValueError("O modo LIVE deve ser true ou false.")
                            await asyncio.to_thread(set_live_mode, live)
                        except Exception as error:
                            logger.warning("Alteração do modo de execução recusada: %s", error)
                            await websocket.send_json(
                                {"type": "mode_error", "reason": str(error)}
                            )
                            continue
                        await websocket_hub.broadcast(
                            {"type": "mode_changed", "live": live}
                        )
                        continue
                    if action != "execute_trade":
                        continue
                    if _active_trader is None:
                        raise RuntimeError("Bot não está conectado à IQ Option.")
                    asset = command.get("asset")
                    direction = command.get("direction")
                    amount = command.get("amount")
                    if not isinstance(asset, str) or not isinstance(direction, str):
                        raise ValueError("Ativo ou direção inválidos.")
                    if isinstance(amount, bool) or not isinstance(amount, (int, float)):
                        raise ValueError("Stake inválida.")
                    result = await asyncio.to_thread(
                        place_trade,
                        asset,
                        direction,
                        float(amount),
                        TRADE_EXPIRATION_MINUTES,
                    )
                    await publish_skipped_trade_result(result)
                except WebSocketDisconnect:
                    break
                except Exception as error:
                    logger.error("Comando de operação recusado ou falhou: %s", error)
                    await websocket_hub.broadcast(
                        {"type": "trade_error", "reason": str(error)}
                    )
        finally:
            websocket_hub.disconnect(websocket)

    # Healthcheck usado pelo terminal/navegador para evitar erros 404.
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # FastAPI resolves WebSocket parameters from runtime annotation objects.
    websocket_endpoint.__annotations__["websocket"] = WebSocket
    app.websocket("/ws")(websocket_endpoint)

    return app


def start_websocket_server() -> threading.Thread:
    global _websocket_server_thread
    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError(
            "Dependência uvicorn ausente. Instale-a com: "
            "python -m pip install -r requirements.txt"
        ) from error

    _websocket_ready.clear()
    _websocket_start_error.clear()

    def serve() -> None:
        try:
            uvicorn.run(
                create_websocket_app(),
                host="127.0.0.1",
                port=8000,
                log_level="info",
            )
        except Exception as error:
            _websocket_start_error.append(error)
            _websocket_ready.set()

    _websocket_server_thread = threading.Thread(
        target=serve,
        name="pulse-signals-websocket",
        daemon=True,
    )
    _websocket_server_thread.start()
    if not _websocket_ready.wait(timeout=15):
        raise RuntimeError("Tempo esgotado ao iniciar o servidor WebSocket em 127.0.0.1:8000.")
    if _websocket_start_error:
        raise RuntimeError(f"Falha ao iniciar o servidor WebSocket: {_websocket_start_error[0]}")
    if not _websocket_server_thread.is_alive():
        raise RuntimeError("O servidor WebSocket encerrou durante a inicialização.")
    return _websocket_server_thread


def publish_websocket(message: dict[str, Any], *, required: bool = False) -> None:
    loop = _websocket_loop
    if loop is None or not loop.is_running():
        if required:
            raise RuntimeError(
                "O WebSocket não está disponível; a operação real foi bloqueada."
            )
        logger.info("WebSocket offline; evento não transmitido: %s", message)
        return

    future = asyncio.run_coroutine_threadsafe(websocket_hub.broadcast(message), loop)
    try:
        future.result(timeout=5)
    except TimeoutError as error:
        if required:
            raise RuntimeError(
                "Tempo esgotado ao transmitir evento pelo WebSocket."
            ) from error
        logger.warning("Tempo esgotado ao transmitir evento pelo WebSocket: %s", message)
    except Exception as error:  # noqa: BLE001 - cliente desconectado não derruba o bot
        if required:
            raise
        logger.info("Evento não transmitido (WebSocket instável): %s", error)


async def publish_skipped_trade_result(result: dict[str, Any]) -> None:
    """Notifica o frontend quando a corretora não aceita a ordem."""
    if result.get("result") != "SKIPPED":
        return
    message = {
        "type": "trade_result",
        "asset": result["asset"],
        "direction": result["direction"],
        "result": "SKIPPED",
        "pnl": float(result.get("pnl", 0.0)),
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
            "+00:00", "Z"
        ),
    }
    reason = result.get("reason")
    if isinstance(reason, str) and reason.strip():
        message["reason"] = reason.strip()
    await websocket_hub.broadcast(message)


def publish_balance(client: Any) -> None:
    try:
        balance = float(client.get_balance())
        if not math.isfinite(balance) or balance < 0:
            raise ValueError("A API retornou um saldo inválido.")
        publish_websocket(
            {
                "type": "account_balance",
                "balance": round(balance, 2),
                "currency": "USD",
                "account_type": _account_type,
            }
        )
    except Exception as error:
        logger.error("Falha ao atualizar o saldo via WebSocket: %s", error)


def _is_suspended_asset_error(payload: Any) -> bool:
    """Detecta a recusa da IQ Option por ativo suspenso (ex.: 'active is suspended')."""
    return "suspended" in str(payload).lower()


def report_suspended_asset() -> None:
    """Registra no terminal e avisa o app que a ordem não foi enviada (ativo suspenso)."""
    logger.error("[ERRO] Ativo suspenso: Não foi possível enviar a ordem.")
    try:
        publish_websocket({"type": "trade_error", "message": SUSPENDED_ASSET_MESSAGE})
    except Exception as error:
        logger.warning("Não foi possível avisar o app sobre o ativo suspenso: %s", error)


def _is_cannot_purchase_error(payload: Any) -> bool:
    """Detecta a recusa 'Cannot purchase an option (asset not available)'."""
    return "cannot purchase" in str(payload).lower()


def _is_unavailable_asset_error(payload: Any) -> bool:
    message = str(payload).lower()
    return (
        _is_cannot_purchase_error(payload)
        or _is_suspended_asset_error(payload)
        or any(
            phrase in message
            for phrase in (
                "asset not available",
                "asset unavailable",
                "active not available",
                "market is closed",
                "market closed",
            )
        )
    )


class _AssetUnavailableError(RuntimeError):
    """Recusa da corretora que permite tentar o ativo OTC correspondente."""


def report_cannot_purchase() -> None:
    """Loga a recusa da corretora sem interromper o bot."""
    logger.warning(CANNOT_PURCHASE_MESSAGE)


def _iter_active_entries(node: Any) -> Iterator[dict[str, Any]]:
    """Percorre o payload de inicialização e devolve os dicionários de ativos."""
    if isinstance(node, dict):
        if (
            isinstance(node.get("name"), str)
            and "enabled" in node
            and "is_suspended" in node
        ):
            yield node
            return
        for value in node.values():
            yield from _iter_active_entries(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_active_entries(item)


def _normalize_active_symbol(name: Any) -> str:
    """Normaliza o nome do ativo.

    O payload real traz nomes como ``front.EURUSD-OTC`` e ``front.EURUSD-op``
    (par normal, sufixo ``-op``). Convertemos ambos para o símbolo oficial
    (``EURUSD-OTC`` e ``EURUSD``).
    """
    symbol = str(name).strip().upper()
    if "." in symbol:
        symbol = symbol.rsplit(".", 1)[-1].strip()
    if symbol.endswith("-OP"):
        symbol = symbol[:-3]
    return symbol


def _get_asset_type(client: Any, asset: str) -> str:
    """Detecta em qual seção a IQ Option lista o ativo (blitz/turbo/binary).

    O resultado define a camada de execução: ativos ``blitz`` são enviados
    pela ``myiq`` (que suporta esse contrato); ``turbo``/``binary`` seguem
    pela ``iqoptionapi``.
    """
    target = _normalize_active_symbol(asset)
    try:
        payload = _call_with_timeout(
            client.get_all_init_v2,
            IQ_CANDLES_TIMEOUT_SECONDS,
            description="ao consultar o catálogo de ativos da IQ Option",
        )
    except Exception as error:
        logger.warning("Não foi possível detectar o tipo do ativo %s: %s", target, error)
        return "turbo"
    if not isinstance(payload, dict):
        return "turbo"
    for section in ("blitz", "turbo", "binary"):
        node = payload.get(section)
        if not isinstance(node, dict):
            continue
        for active in _iter_active_entries(node):
            if _normalize_active_symbol(active.get("name", "")) == target:
                return section
    return "turbo"


def _select_balance_id(balances: list[Any], account: str) -> int:
    """Escolhe o ID de saldo da myiq (type 1 = REAL, 4 = PRACTICE)."""
    wanted_type = 1 if account == "REAL" else 4
    for balance in balances:
        if int(getattr(balance, "type", 0)) == wanted_type:
            return int(balance.id)
    if not balances:
        raise RuntimeError("A myiq não retornou nenhum saldo para seleção.")
    return int(balances[0].id)


def _myiq_session_is_active(client: Any) -> bool:
    """True quando token, WebSocket e saldo da myiq parecem utilizáveis."""
    if client is None:
        return False
    ws = getattr(client, "ws", None)
    try:
        connected = bool(getattr(ws, "is_connected", False))
    except Exception:  # noqa: BLE001 - estado da lib pode variar
        connected = False
    return (
        connected
        and bool(getattr(client, "ssid", None))
        and getattr(client, "active_balance_id", None) is not None
    )


def _myiq_error_is_retryable(error: BaseException) -> bool:
    """Identifica erros de sessão/token/WebSocket que permitem reenviar a ordem."""
    text = f"{type(error).__name__}: {error}".lower()
    return any(marker in text for marker in _MYIQ_RETRYABLE_MARKERS)


async def _refresh_myiq_session_async(
    client: Any, account: str, *, force: bool
) -> None:
    """Renova o token/WebSocket da myiq e revalida saldo + catálogo Blitz."""
    ws = getattr(client, "ws", None)
    if force:
        # Fecha a conexão antiga para encerrar o monitor da lib antes de
        # iniciar uma nova sessão limpa.
        try:
            if ws is not None:
                await ws.close()
        except Exception:  # noqa: BLE001 - seguimos para um start() limpo
            pass
    await client.start()
    balances = await client.get_balances()
    await client.change_balance(_select_balance_id(balances, account))
    # Repopula o cache usado por buy_blitz (profit_percent/ids).
    await client.get_actives("blitz")


def _ensure_myiq_session(client: Any, *, force: bool = False) -> bool:
    """Garante sessão ativa na myiq antes de consultar ativos ou comprar.

    Retorna True quando precisou reconectar. Roda no loop asyncio dedicado da
    myiq, pois o restante do bot é síncrono.
    """
    if client is None:
        raise RuntimeError("Cliente myiq indisponível; sessão não pode ser validada.")
    loop = _myiq_loop
    if loop is None or not loop.is_running():
        raise RuntimeError("Loop asyncio da myiq indisponível; sessão não pode ser validada.")
    if not force and _myiq_session_is_active(client):
        return False

    with _myiq_session_lock:
        # Outra thread pode ter reconectado enquanto esperávamos o lock.
        if not force and _myiq_session_is_active(client):
            return False
        print(
            "[MYIQ] Sessão inativa (token/WebSocket/saldo); "
            "renovando e reconectando automaticamente...",
            flush=True,
        )
        logger.warning("[MYIQ] Sessão inativa; renovando token e reconectando WebSocket.")
        try:
            asyncio.run_coroutine_threadsafe(
                _refresh_myiq_session_async(client, _account_type, force=force),
                loop,
            ).result(timeout=90)
        except Exception as error:  # noqa: BLE001 - reportado com traceback completo
            logger.error("[ERRO] Falha ao reconectar a myiq:\n%s", traceback.format_exc())
            raise RuntimeError(f"Falha ao reconectar a myiq: {error!r}") from error

    print("[MYIQ] Sessão restabelecida (token + WebSocket + saldo).", flush=True)
    logger.info("[MYIQ] Sessão restabelecida.")
    return True


def _start_myiq_client(email: str, password: str, account: str) -> Any:
    """Inicia a ``myiq`` num loop asyncio dedicado (thread daemon) para Blitz.

    A ``myiq`` é 100% assíncrona e o restante do bot é síncrono/threaded, então
    criamos um loop próprio onde ``await iq.start()`` e ``await iq.buy_blitz(...)``
    rodam sem alterar o motor atual de sinais/WebSocket/travas.
    """
    global _myiq_client, _myiq_loop
    try:
        from myiq import IQOption
    except ImportError as error:
        raise RuntimeError(
            "Dependência myiq ausente. Instale-a com: python -m pip install myiq"
        ) from error

    with _myiq_start_lock:
        if _myiq_client is not None:
            return _myiq_client
        _myiq_ready.clear()
        _myiq_start_error.clear()

        def _runner() -> None:
            global _myiq_client, _myiq_loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            _myiq_loop = loop

            async def _boot() -> Any:
                client = IQOption(email, password)
                await client.start()
                balances = await client.get_balances()
                await client.change_balance(_select_balance_id(balances, account))
                # Popula o cache de ativos Blitz (payout + IDs) usado na compra.
                await client.get_actives("blitz")
                return client

            try:
                _myiq_client = loop.run_until_complete(_boot())
            except Exception as error:  # noqa: BLE001 - repassado à thread principal
                detail = traceback.format_exc()
                _myiq_start_error.append(error)
                logger.error(
                    "[ERRO] Falha ao iniciar cliente myiq (Blitz):\n%s",
                    detail,
                )
                print(
                    f"[ERRO] Falha ao iniciar cliente myiq (Blitz):\n{detail}",
                    flush=True,
                )
                _myiq_ready.set()
                return
            _myiq_ready.set()
            loop.run_forever()

        threading.Thread(
            target=_runner, name="pulse-signals-myiq", daemon=True
        ).start()

    if not _myiq_ready.wait(timeout=60):
        raise RuntimeError("Tempo esgotado ao iniciar o cliente myiq (Blitz).")
    if _myiq_start_error:
        raise RuntimeError(
            f"Falha ao iniciar o cliente myiq (Blitz): {_myiq_start_error[0]}"
        )
    return _myiq_client


def _resolve_blitz_active(iq_client: Any, asset: str) -> tuple[int, int]:
    """Resolve ``(active_id, payout%)`` do ativo na seção Blitz, via myiq.

    Usa ``get_all_actives_status`` e popula o ``actives_cache`` (necessário
    porque a ``buy_blitz`` valida o ``profit_percent`` enviado na ordem).
    """
    loop = _myiq_loop
    if iq_client is None or loop is None or not loop.is_running():
        raise RuntimeError("Cliente myiq indisponível; ordem Blitz bloqueada.")

    # Se o WebSocket/token caiu, a consulta de ativos também falha. Renova a
    # sessão antes de buscar o catálogo.
    _ensure_myiq_session(iq_client)

    target = _normalize_active_symbol(asset)

    async def _fetch() -> dict[int, dict[str, Any]]:
        from myiq import get_all_actives_status

        actives = await get_all_actives_status(iq_client, "blitz")
        iq_client.actives_cache.update(actives)
        return actives

    try:
        actives = asyncio.run_coroutine_threadsafe(_fetch(), loop).result(timeout=20)
    except Exception:  # noqa: BLE001 - tenta uma sessão limpa antes de desistir
        logger.error(
            "[ERRO] Falha ao consultar ativos Blitz na myiq:\n%s",
            traceback.format_exc(),
        )
        _ensure_myiq_session(iq_client, force=True)
        actives = asyncio.run_coroutine_threadsafe(_fetch(), loop).result(timeout=20)
    for key, info in actives.items():
        if target in (
            _normalize_active_symbol(info.get("name", "")),
            _normalize_active_symbol(info.get("ticker", "")),
        ):
            return int(key), int(info.get("profit_percent") or 0)
    raise RuntimeError(f"Ativo {asset} não encontrado no catálogo Blitz da IQ Option.")


def _official_outcome(value: Any) -> str:
    """Normaliza o resultado oficial da corretora para WIN/LOSS/DRAW."""
    text = str(value).strip().lower()
    if text in {"win", "won"}:
        return "WIN"
    if text in {"loose", "loss", "lose", "lost"}:
        return "LOSS"
    if text in {"equal", "draw", "tie", "refund"}:
        return "DRAW"
    return ""


def _as_finite_float(value: Any) -> float | None:
    """Converte o valor em float finito; devolve None se não for numérico."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _official_pnl(
    outcome: str,
    amount: float,
    payout_rate: float | None,
    official_pnl: float | None,
) -> float:
    """Calcula o PnL a partir do resultado oficial da corretora."""
    if outcome == "WIN":
        # O P&L devolvido pela corretora já equivale a amount * payout;
        # usamos o payout conhecido quando disponível.
        if payout_rate is not None and payout_rate > 0:
            return round(float(amount) * payout_rate, 2)
        if official_pnl is not None and official_pnl > 0:
            return round(official_pnl, 2)
        return round(float(amount) * PAPER_PAYOUT, 2)
    if outcome == "LOSS":
        return -round(float(amount), 2)
    return 0.0


def _is_blitz_timeout(error: BaseException) -> bool:
    """Timeout do await da myiq ou do future.result() (mesma classe no 3.11)."""
    if isinstance(error, (TimeoutError, asyncio.TimeoutError)):
        return True
    return "timeout" in type(error).__name__.lower()


def _read_balance(client: Any) -> float | None:
    """Lê o saldo via iqoptionapi; None quando indisponível."""
    if client is None:
        return None
    try:
        return _as_finite_float(client.get_balance())
    except Exception as error:  # noqa: BLE001 - leitura de saldo é best-effort
        logger.warning("[FALLBACK] Não foi possível ler o saldo: %r", error)
        return None


def _blitz_result_is_missing(result: Any) -> bool:
    """True quando a myiq não devolveu nenhum resultado oficial utilizável."""
    if result is None:
        return True
    if isinstance(result, dict):
        if str(result.get("status") or "").strip().lower() == "error":
            return False
        return (
            _official_outcome(result.get("result") or result.get("win")) == ""
            and _as_finite_float(result.get("pnl", result.get("profit"))) is None
        )
    return _official_outcome(result) == ""


def _blitz_balance_fallback(
    balance_client: Any, balance_before: float | None, amount: float
) -> dict[str, Any] | None:
    """Deduz o resultado da Blitz pela variação do saldo (rede de segurança).

    Usado apenas quando a myiq não devolve o resultado (timeout ou None).
    """
    if balance_before is None:
        return None

    time.sleep(BLITZ_FALLBACK_WAIT_SECONDS)
    balance_after = _read_balance(balance_client)
    if balance_after is None:
        return None

    diff = round(balance_after - balance_before, 2)
    if diff > 0:
        outcome, pnl = "WIN", diff
    elif diff < 0:
        outcome, pnl = "LOSS", diff
    else:
        outcome, pnl = "DRAW", 0.0

    message = f"[FALLBACK] Resultado calculado por saldo: {outcome} | PnL: {pnl:.2f}"
    print(message, flush=True)
    logger.warning(message)
    return {"result": outcome, "pnl": pnl, "status": "fallback"}


def _dispatch_blitz_buy(
    iq_client: Any,
    balance_client: Any,
    active_id: int,
    direction: str,
    amount: float,
) -> dict[str, Any]:
    """Executa a ordem Blitz na myiq e aguarda o resultado oficial.

    A ``buy_blitz`` só retorna após a liquidação e devolve o resultado da
    própria corretora (``win``/``loose``/``equal``). É ESSE retorno que define
    o WIN/LOSS do PULSE — nenhum cálculo por preço é feito aqui.

    Se a myiq não devolver o resultado (timeout ou ``None``), cai no fallback
    por variação de saldo para não travar o app.
    """
    loop = _myiq_loop
    if iq_client is None or loop is None or not loop.is_running():
        raise RuntimeError("Cliente myiq indisponível; ordem Blitz bloqueada.")

    balance_before = _read_balance(balance_client)

    def _run_buy() -> Any:
        future = asyncio.run_coroutine_threadsafe(
            iq_client.buy_blitz(
                active_id, direction, amount, duration=BLITZ_DURATION_SECONDS
            ),
            loop,
        )
        return future.result(timeout=BLITZ_DURATION_SECONDS + 90)

    def _log_failure(error: BaseException) -> None:
        """Mostra a resposta REAL da myiq no terminal, sem mensagem vazia."""
        detail = traceback.format_exc()
        logger.error("[ERRO] Ordem Blitz falhou na myiq:\n%s", detail)
        print(f"[ERRO] Ordem Blitz falhou na myiq:\n{detail}", flush=True)

    def _publish_failure(error: BaseException) -> None:
        message = f"Falha na ordem Blitz via myiq: {error!r}"
        try:
            publish_websocket({"type": "trade_error", "message": message})
        except Exception:  # noqa: BLE001 - WebSocket offline
            pass

    def _log_timeout(error: BaseException) -> None:
        logger.warning("[FALLBACK] myiq não respondeu a tempo: %r", error)
        print(
            f"[FALLBACK] myiq não respondeu a tempo ({error!r}). "
            "Calculando o resultado pelo saldo...",
            flush=True,
        )

    result: Any = None
    try:
        _ensure_myiq_session(iq_client)
        result = _run_buy()
    except Exception as error:  # noqa: BLE001 - reportado ao app/terminal
        if _is_blitz_timeout(error):
            # Sem resultado da myiq: o app não pode travar, então o fallback
            # por saldo assume (nenhum reenvio da ordem é feito).
            _log_timeout(error)
        elif _is_unavailable_asset_error(error):
            raise _AssetUnavailableError(str(error)) from error
        else:
            _log_failure(error)
            if not _myiq_error_is_retryable(error):
                _publish_failure(error)
                raise RuntimeError(f"Falha na ordem Blitz via myiq: {error!r}") from error
            print(
                "[MYIQ] Erro de sessão/WebSocket detectado; reconectando e "
                "reenviando a ordem uma única vez...",
                flush=True,
            )
            logger.warning("[MYIQ] Reconectando após erro de sessão: %r", error)
            try:
                _ensure_myiq_session(iq_client, force=True)
                result = _run_buy()
            except Exception as retry_error:  # noqa: BLE001 - reportado ao app/terminal
                if _is_blitz_timeout(retry_error):
                    _log_timeout(retry_error)
                elif _is_unavailable_asset_error(retry_error):
                    raise _AssetUnavailableError(str(retry_error)) from retry_error
                else:
                    _log_failure(retry_error)
                    _publish_failure(retry_error)
                    raise RuntimeError(
                        f"Falha na ordem Blitz via myiq: {retry_error!r}"
                    ) from retry_error

    print(f"[DEBUG] Resultado bruto da myiq: {result}")

    if _blitz_result_is_missing(result):
        fallback = _blitz_balance_fallback(balance_client, balance_before, amount)
        if fallback is not None:
            return fallback
        # Sem resultado da myiq e sem saldo comparável: ainda assim não deixa
        # o app pendurado.
        _publish_failure(
            RuntimeError("myiq não devolveu o resultado da ordem Blitz.")
        )
        raise RuntimeError(
            "A myiq não devolveu o resultado da ordem Blitz e o saldo não pôde "
            "ser lido para o fallback."
        )

    if isinstance(result, dict):
        return result
    return {"result": result}


def _active_payout(active: dict[str, Any]) -> int:
    """Converte a comissão da IQ Option (ex.: 15) no payout em % (ex.: 85)."""
    option = active.get("option")
    profit = option.get("profit") if isinstance(option, dict) else None
    if not isinstance(profit, dict):
        return 0

    commission = profit.get("commission")
    if isinstance(commission, bool) or not isinstance(commission, (int, float)):
        per_duration = {
            key: value
            for key, value in profit.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
        if "1" in per_duration:
            commission = per_duration["1"]
        elif per_duration:
            commission = min(per_duration.values())
        else:
            return 0

    commission = float(commission)
    payout = commission * 100 if 0 < commission < 1 else 100.0 - commission
    return max(0, min(100, int(round(payout))))


def _build_assets_status(
    active_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    found: dict[str, tuple[bool, int]] = {}
    for active in active_entries:
        symbol = _normalize_active_symbol(active.get("name", ""))
        if not symbol:
            continue
        is_open = bool(active.get("enabled")) and not bool(active.get("is_suspended"))
        payout = _active_payout(active) if is_open else 0
        available = is_open and payout > 0
        current = found.get(symbol)
        if current is None:
            found[symbol] = (available, payout)
            continue
        current_available, current_payout = current
        if available and (not current_available or payout > current_payout):
            found[symbol] = (available, payout)

    status: list[dict[str, Any]] = []
    for symbol in OFFICIAL_ASSETS:
        available, payout = found.get(symbol, (False, 0))
        status.append({"symbol": symbol, "available": available, "payout": payout})
    return status


def _debug_dump_init_payload(payload: Any) -> None:
    """Print temporário: mostra a estrutura crua devolvida por get_all_init_v2()."""
    print("[ATIVOS][DEBUG] tipo do payload:", type(payload).__name__)
    if not isinstance(payload, dict):
        print("[ATIVOS][DEBUG] payload cru:", repr(payload)[:800])
        return
    print("[ATIVOS][DEBUG] chaves de topo:", sorted(payload.keys()))
    for section in ("turbo", "binary", "blitz"):
        node = payload.get(section)
        actives = node.get("actives") if isinstance(node, dict) else None
        if isinstance(actives, dict) and actives:
            sample_key = next(iter(actives))
            sample = json.dumps(
                actives[sample_key], ensure_ascii=False, default=str
            )
            print(
                f"[ATIVOS][DEBUG] {section}.actives: {len(actives)} entradas; "
                f"exemplo[{sample_key}]={sample[:600]}"
            )
        elif actives is not None:
            print(f"[ATIVOS][DEBUG] {section}.actives:", repr(actives)[:300])


def _assets_poll_loop(client: Any, interval: float) -> None:
    global _assets_payload_logged
    while not _assets_poll_stop.is_set():
        started = time.monotonic()
        try:
            payload = client.get_all_init_v2()
            if not _assets_payload_logged:
                _debug_dump_init_payload(payload)
                _assets_payload_logged = True
            entries = list(_iter_active_entries(payload))
            if not entries:
                raise RuntimeError(
                    "A IQ Option não retornou ativos no payload de inicialização."
                )
            assets = _build_assets_status(entries)
            publish_websocket({"type": "assets_status", "assets": assets})
            open_count = sum(1 for asset in assets if asset["available"])
            print(f"[ATIVOS] {open_count}/{len(assets)} ativos abertos.")
        except Exception as error:
            logger.warning("Falha ao consultar ativos/payouts na IQ Option: %s", error)
        elapsed = time.monotonic() - started
        if _assets_poll_stop.wait(max(0.0, interval - elapsed)):
            break


def start_assets_poller(
    client: Any, interval: float = ASSETS_POLL_INTERVAL
) -> threading.Thread:
    """Inicia a thread que envia ativos/payouts logo de cara e a cada `interval`."""
    global _assets_poll_thread, _assets_payload_logged
    _assets_poll_stop.clear()
    _assets_payload_logged = False
    _assets_poll_thread = threading.Thread(
        target=_assets_poll_loop,
        args=(client, interval),
        name="pulse-signals-assets",
        daemon=True,
    )
    _assets_poll_thread.start()
    return _assets_poll_thread


def stop_assets_poller() -> None:
    _assets_poll_stop.set()
    thread = _assets_poll_thread
    if thread is not None and thread.is_alive():
        thread.join(timeout=5)


def _broker_timestamp(client: Any) -> int:
    """Hora da corretora em segundos Unix; usa o relógio local como fallback."""
    try:
        timestamp = client.get_server_timestamp()
    except Exception:  # noqa: BLE001 - fallback para o relógio local
        timestamp = None

    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)):
        return int(time.time())
    value = float(timestamp)
    if not math.isfinite(value) or value <= 0:
        return int(time.time())
    if value > 10**12:
        value /= 1000
    return int(value)


def _serialize_real_candles(
    candles: Any, limit: int
) -> list[dict[str, Any]]:
    """Normaliza os candles da IQ Option para o formato consumido pelo React."""
    if not isinstance(candles, list):
        return []

    by_timestamp: dict[int, dict[str, Any]] = {}
    for candle in candles:
        if not isinstance(candle, dict):
            continue
        try:
            timestamp, open_price, high, low, close, volume = normalize_candle(candle)
        except ValueError:
            continue
        by_timestamp[timestamp] = {
            "time": timestamp,
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }

    ordered = [by_timestamp[timestamp] for timestamp in sorted(by_timestamp)]
    return ordered[-max(1, limit):]


def _available_asset_symbols(client: Any) -> list[str]:
    payload = client.get_all_init_v2()
    entries = list(_iter_active_entries(payload))
    if not entries:
        raise RuntimeError("A IQ Option não retornou ativos para o envio de candles.")
    return [
        str(asset["symbol"])
        for asset in _build_assets_status(entries)
        if asset["available"]
    ]


def _call_with_timeout(
    function: Any,
    timeout: float,
    *,
    description: str,
    timeout_error: type[Exception] = TimeoutError,
) -> Any:
    """Executa uma chamada síncrona da biblioteca com limite de tempo.

    A iqoptionapi usa loops ``while True`` sem timeout em pontos críticos
    (connect, get_balance, check_win). Sem este limite, uma falha de rede
    deixaria o processo travado indefinidamente.
    """
    outcome: dict[str, Any] = {}

    def _runner() -> None:
        try:
            outcome["value"] = function()
        except BaseException as error:  # noqa: BLE001 - repassada à thread principal
            outcome["error"] = error

    thread = threading.Thread(
        target=_runner, name="pulse-signals-call", daemon=True
    )
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise timeout_error(
            f"Tempo esgotado ({timeout:.0f}s) {description}. "
            "A conexão com a IQ Option pode estar instável ou bloqueada."
        )
    error = outcome.get("error")
    if error is not None:
        raise error
    return outcome.get("value")


def _probe_iqoption_network(
    host: str = IQ_AUTH_HOST,
    port: int = IQ_AUTH_PORT,
    timeout: float = IQ_NETWORK_PROBE_TIMEOUT_SECONDS,
) -> tuple[bool, str]:
    """Testa se o host de autenticação da IQ Option está alcançável.

    Retorna ``(alcançável, detalhe)``. É um teste TCP rápido para transformar
    o timeout da biblioteca numa mensagem clara antes de tentar o login.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"{host}:{port} acessível"
    except OSError as error:
        return False, f"{type(error).__name__}: {error}"


def _get_ssid_or_raise(original_get_ssid: Any, api_instance: Any) -> Any:
    """Converte o retorno anômalo de get_ssid() em exceção tratável.

    A iqoptionapi, ao falhar o login HTTP, *retorna* a exceção em vez de
    propagá-la. O connect() então quebra ao acessar ``response.cookies``.
    """
    response = original_get_ssid(api_instance)
    if isinstance(response, BaseException):
        raise IQOptionConnectionError(
            "Falha de rede ao autenticar na IQ Option: "
            f"{type(response).__name__}: {response}"
        ) from response
    return response


def _patch_iqoptionapi_connect_bug() -> None:
    """Neutraliza o bug de timeout da iqoptionapi dentro deste processo."""
    global _iqoption_get_ssid_patched
    if _iqoption_get_ssid_patched:
        return
    try:
        from iqoptionapi.api import IQOptionAPI
    except ImportError:
        return

    original_get_ssid = IQOptionAPI.get_ssid

    def get_ssid_or_raise(self: Any) -> Any:
        return _get_ssid_or_raise(original_get_ssid, self)

    IQOptionAPI.get_ssid = get_ssid_or_raise
    _iqoption_get_ssid_patched = True


def _connect_error_text(error: Any) -> str:
    return f"{type(error).__name__}: {error}".strip()


def _is_auth_failure(text: str) -> bool:
    lowered = text.lower()
    return any(
        marker in lowered
        for marker in (
            "invalid_credentials",
            "invalid credentials",
            "incorrect password",
            "wrong password",
            "user not found",
            "unauthorized",
            "401",
            "verification",
            "verify",
            "2fa",
            "two-factor",
        )
    )


def _is_network_failure(text: str) -> bool:
    lowered = text.lower()
    return any(
        marker in lowered
        for marker in (
            "connecttimeout",
            "connectiontimeout",
            "readtimeout",
            "timeout",
            "timed out",
            "connectionerror",
            "connection error",
            "connection reset",
            "connection aborted",
            "connection refused",
            "name resolution",
            "getaddrinfo",
            "network is unreachable",
            "no route to host",
            "ssl",
            "certificate",
            "max retries",
            "websocket connection closed",
            "falha de rede",
            "tempo esgotado",
        )
    )


def _build_connect_error_message(error: Any) -> str:
    """Mensagem acionável para o usuário, sem traceback cru da biblioteca."""
    text = _connect_error_text(error)
    lowered = text.lower()

    if isinstance(error, AttributeError) and "cookies" in lowered:
        return (
            "Não foi possível conectar à IQ Option: a biblioteca não conseguiu "
            "autenticar (falha de rede). Verifique internet, VPN/proxy e firewall. "
            f"Detalhe técnico: {text}"
        )
    if isinstance(error, json.JSONDecodeError):
        return (
            "Não foi possível conectar à IQ Option: o WebSocket foi recusado e a "
            "biblioteca não conseguiu interpretar a resposta. Verifique internet, "
            f"VPN/proxy e firewall. Detalhe técnico: {text}"
        )
    if any(marker in lowered for marker in ("2fa", "two-factor", "verification", "verify")):
        return (
            "A conta da IQ Option exige verificação em duas etapas (2FA). "
            "Conclua/desative a verificação na conta ou faça login pelo site "
            f"antes de usar o bot. Detalhe: {text}"
        )
    if _is_auth_failure(text):
        return (
            "A IQ Option recusou o login. Confira IQOPTION_EMAIL e "
            f"IQOPTION_PASSWORD no arquivo .env. Detalhe: {text}"
        )
    if _is_network_failure(text):
        return (
            "Não foi possível conectar à IQ Option (falha de rede/timeout). "
            "Verifique a conexão com a internet, VPN/proxy e firewall, e confirme "
            "se auth.iqoption.com está acessível nesta máquina. "
            f"Detalhe: {text}"
        )
    return (
        "Não foi possível conectar à IQ Option. Verifique internet, VPN/proxy, "
        f"credenciais e disponibilidade do serviço. Detalhe: {text}"
    )


def _safe_connect(
    client: Any,
    *,
    attempts: int = IQ_CONNECT_ATTEMPTS,
    timeout: float = IQ_CONNECT_TIMEOUT_SECONDS,
    retry_delay: float = IQ_CONNECT_RETRY_DELAY_SECONDS,
    probe_network: bool = True,
) -> None:
    """Conecta à IQ Option com diagnóstico, timeout e novas tentativas."""
    _patch_iqoptionapi_connect_bug()

    if probe_network:
        reachable, detail = _probe_iqoption_network()
        if not reachable:
            main_host_reachable, _ = _probe_iqoption_network(
                "iqoption.com",
                443,
                timeout=min(4.0, IQ_NETWORK_PROBE_TIMEOUT_SECONDS),
            )
            diagnosis = (
                " O host iqoption.com está acessível, então a internet funciona: "
                "o bloqueio parece ser específico de auth.iqoption.com "
                "(região, ISP ou VPN)."
                if main_host_reachable
                else " O host iqoption.com também está inacessível: verifique a "
                "conexão com a internet."
            )
            raise IQOptionConnectionError(
                "Não foi possível alcançar "
                f"{IQ_AUTH_HOST}:{IQ_AUTH_PORT} ({detail})."
                f"{diagnosis} Se a IQ Option for bloqueada na sua região, use "
                "uma VPN ou proxy e tente novamente."
            )
        logger.info("Rede IQ Option OK (%s).", detail)

    last_error: Any = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            connected, reason = _call_with_timeout(
                client.connect,
                timeout,
                description="ao conectar à IQ Option",
            )
        except TimeoutError as error:
            # Não repetimos após timeout: a thread original pode continuar
            # conectando em segundo plano e uma nova tentativa criaria duas
            # sessões concorrentes.
            raise IQOptionConnectionError(
                "Tempo esgotado ao conectar à IQ Option. A rede ou o serviço "
                "podem estar indisponíveis; verifique internet, VPN/proxy e "
                "firewall."
            ) from error
        except Exception as error:  # noqa: BLE001 - normalizado abaixo
            last_error = error
        else:
            if connected:
                return
            last_error = IQOptionConnectionError(
                "Falha no login da IQ Option: "
                f"{reason if reason else 'motivo não informado.'}"
            )

        text = _connect_error_text(last_error)
        if attempt >= attempts or _is_auth_failure(text):
            break
        print(
            f"[AVISO] Tentativa {attempt}/{attempts} de conexão com a IQ Option "
            f"falhou: {text}. Nova tentativa em {retry_delay:.0f}s...",
            flush=True,
        )
        logger.warning(
            "Conexão IQ Option falhou (tentativa %d/%d): %s",
            attempt,
            attempts,
            text,
        )
        time.sleep(retry_delay)

    raise IQOptionConnectionError(_build_connect_error_message(last_error))


def _reconnect_iqoption_client(client: Any, *, reason: str) -> bool:
    """Força uma reconexão limpa da iqoptionapi (sessão/estado perdidos).

    Espera uma ordem em andamento terminar antes de derrubar a conexão, para
    não interromper uma compra. Retorna True se reconectou.
    """
    print(f"[CANDLES] Forçando reconexão da iqoptionapi: {reason}", flush=True)
    logger.warning("[CANDLES] Forçando reconexão da iqoptionapi: %s", reason)

    trade_lock = getattr(globals().get("_active_trader"), "trade_lock", None)
    locked = False
    if trade_lock is not None:
        locked = trade_lock.acquire(timeout=120)
        if not locked:
            logger.error(
                "[CANDLES] Reconexão adiada: há uma ordem em andamento há mais de 120s."
            )
            return False

    try:
        _safe_connect(
            client,
            attempts=1,
            timeout=IQ_CONNECT_TIMEOUT_SECONDS,
            probe_network=False,
        )
        try:
            client.change_balance(_account_type)
        except Exception as error:  # noqa: BLE001 - a conta pode ser reaplicada
            logger.warning("[CANDLES] Falha ao reaplicar conta após reconexão: %s", error)
        try:
            publish_balance(client)
        except Exception as error:  # noqa: BLE001 - saldo é informativo
            logger.warning("[CANDLES] Falha ao publicar saldo após reconexão: %s", error)
        print("[CANDLES] iqoptionapi reconectado com sucesso.", flush=True)
        logger.info("[CANDLES] iqoptionapi reconectado com sucesso.")
        return True
    except Exception:  # noqa: BLE001 - reportado com traceback completo
        logger.error(
            "[CANDLES] Falha ao reconectar a iqoptionapi:\n%s",
            traceback.format_exc(),
        )
        print(
            f"[ERRO] Falha ao reconectar a iqoptionapi:\n{traceback.format_exc()}",
            flush=True,
        )
        return False
    finally:
        if locked and trade_lock is not None:
            trade_lock.release()


def _available_asset_symbols_with_retry(
    client: Any, *, attempts: int = 3, delay: float = 2.0
) -> list[str]:
    """Tenta listar ativos até 3 vezes; na 3ª falha força reconexão."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return _available_asset_symbols(client)
        except Exception as error:  # noqa: BLE001 - nova tentativa no mesmo ciclo
            last_error = error
            logger.warning(
                "[CANDLES] IQ Option não retornou ativos (tentativa %d/%d): %s",
                attempt,
                attempts,
                error,
            )
            print(
                f"[AVISO] IQ Option não retornou ativos "
                f"(tentativa {attempt}/{attempts}): {error}",
                flush=True,
            )
            if attempt < attempts and _real_candles_stop.wait(delay):
                return []

    assert last_error is not None
    # 3 falhas seguidas: o estado interno da iqoptionapi provavelmente se
    # perdeu. Reconecta e tenta listar mais uma vez.
    _reconnect_iqoption_client(
        client, reason=f"{attempts} falhas seguidas ao listar ativos"
    )
    if _real_candles_stop.is_set():
        return []
    try:
        return _available_asset_symbols(client)
    except Exception as error:  # noqa: BLE001 - próximo ciclo tenta de novo
        logger.warning(
            "[CANDLES] IQ Option continua sem ativos após reconexão: %s", error
        )
        print(
            f"[AVISO] IQ Option continua sem ativos após reconexão: {error}",
            flush=True,
        )
        return []


def _real_candles_poll_loop(client: Any, interval: float) -> None:
    # Todos os ciclos enviam o histórico completo (300 velas M1) para que o
    # React nunca perca o aquecimento dos indicadores.
    while not _real_candles_stop.is_set():
        sent = 0
        cycle_started = time.monotonic()
        cycle_broker_now = _broker_timestamp(client)
        try:
            symbols = _available_asset_symbols_with_retry(client)
            if not symbols:
                logger.warning(
                    "[CANDLES] Nenhum ativo disponível neste ciclo; "
                    "nova tentativa no próximo."
                )
                symbols = []
            for symbol in symbols:
                if _real_candles_stop.is_set():
                    break
                broker_now = cycle_broker_now + int(time.monotonic() - cycle_started)
                try:
                    raw_candles = client.get_candles(
                        symbol,
                        REAL_CANDLES_TIMEFRAME_SECONDS,
                        REAL_CANDLES_COUNT,
                        broker_now,
                    )
                    candles = _serialize_real_candles(raw_candles, REAL_CANDLES_COUNT)
                    if candles:
                        publish_websocket(
                            {
                                "type": "real_candles",
                                "asset": symbol,
                                "timeframe": REAL_CANDLES_TIMEFRAME,
                                "candles": candles,
                                "timestamp": broker_now,
                            }
                        )
                        sent += 1
                    # M15 em paralelo: alimenta o shadow do Playbook D.
                    # Falha aqui não pode derrubar o envio de M1.
                    try:
                        raw_m15 = client.get_candles(
                            symbol,
                            REAL_CANDLES_M15_TIMEFRAME_SECONDS,
                            REAL_CANDLES_M15_COUNT,
                            broker_now,
                        )
                        candles_m15 = _serialize_real_candles(
                            raw_m15, REAL_CANDLES_M15_COUNT
                        )
                        if candles_m15:
                            publish_websocket(
                                {
                                    "type": "real_candles",
                                    "asset": symbol,
                                    "timeframe": REAL_CANDLES_M15_TIMEFRAME,
                                    "candles": candles_m15,
                                    "timestamp": broker_now,
                                }
                            )
                    except Exception as m15_error:  # noqa: BLE001
                        logger.warning(
                            "Falha ao buscar candles M15 de %s: %s",
                            symbol,
                            m15_error,
                        )
                except Exception as error:  # noqa: BLE001 - um ativo não bloqueia os demais
                    logger.warning(
                        "Falha ao buscar candles reais de %s: %s", symbol, error
                    )
        except Exception as error:  # noqa: BLE001 - nova tentativa no próximo ciclo
            logger.warning("Falha ao listar ativos para candles reais: %s", error)

        if sent:
            print(
                f"[CANDLES] {sent} ativos atualizados em "
                f"{REAL_CANDLES_TIMEFRAME} com {REAL_CANDLES_COUNT} velas "
                f"(hora da corretora "
                f"{cycle_broker_now + int(time.monotonic() - cycle_started)})."
            )

        delay = max(1.0, interval - (time.time() % interval))
        if _real_candles_stop.wait(delay):
            break


def start_real_candles_poller(
    client: Any, interval: float = REAL_CANDLES_INTERVAL
) -> threading.Thread:
    """Envia os últimos candles reais de cada ativo disponível a cada intervalo."""
    global _real_candles_thread
    _real_candles_stop.clear()
    _real_candles_thread = threading.Thread(
        target=_real_candles_poll_loop,
        args=(client, interval),
        name="pulse-signals-real-candles",
        daemon=True,
    )
    _real_candles_thread.start()
    return _real_candles_thread


def stop_real_candles_poller() -> None:
    _real_candles_stop.set()
    thread = _real_candles_thread
    if thread is not None and thread.is_alive():
        thread.join(timeout=5)


class TradeExecutor:
    def __init__(
        self,
        client: Any,
        *,
        live: bool,
        account_type: str = "PRACTICE",
        blitz_client_enabled: bool = True,
        daily_loss_path: Path | None = None,
    ) -> None:
        normalized_account = account_type.strip().upper()
        if normalized_account not in {"PRACTICE", "REAL"}:
            raise ValueError("Tipo de conta inválido para o controle de perda diária.")
        if live and not _startup_allow_live:
            raise RuntimeError("Modo LIVE exige que o processo tenha sido iniciado com --live.")
        self.client = client
        self.live = live
        self.allow_live = _startup_allow_live
        self.account_type = normalized_account
        self.blitz_client_enabled = blitz_client_enabled
        self.daily_loss_path = daily_loss_path or DAILY_LOSS_PATH
        self.current_day = datetime.now(timezone.utc).date()
        self.daily_loss = self._load_daily_loss()
        self.stopped = self.daily_loss >= MAX_DAILY_LOSS
        self.trade_lock = threading.Lock()

    def set_live_mode(self, live: bool) -> None:
        with self.trade_lock:
            if not live:
                self.live = False
                print("Modo de execução alterado para DRY-RUN pelo app.")
                return
            if not self.allow_live:
                logger.warning(
                    "Ativação de LIVE recusada: processo iniciado sem --live."
                )
                raise RuntimeError(
                    "Modo LIVE recusado: reinicie o processo com --live para autorizá-lo."
                )
            if self.live:
                return
            self.live = True
            print("Modo de execução LIVE habilitado pelo app.")

    def _load_daily_loss(self) -> float:
        try:
            state = json.loads(self.daily_loss_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return 0.0
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"Não foi possível ler o controle de perda diária em "
                f"{self.daily_loss_path}: {error}"
            ) from error
        if not isinstance(state, dict):
            raise RuntimeError("O arquivo de perda diária contém um formato inválido.")

        day_state = state.get(self.current_day.isoformat(), {})
        if not isinstance(day_state, dict):
            raise RuntimeError("A entrada diária no arquivo de perda está inválida.")
        loss = day_state.get(self.account_type, 0.0)
        if (
            isinstance(loss, bool)
            or not isinstance(loss, (int, float))
            or not math.isfinite(loss)
            or loss < 0
        ):
            raise RuntimeError(
                f"O valor de perda diária salvo para {self.account_type} é inválido."
            )
        return float(loss)

    def _persist_daily_loss(self) -> None:
        try:
            state = json.loads(self.daily_loss_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            state = {}
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"Não foi possível atualizar o controle de perda diária em "
                f"{self.daily_loss_path}: {error}"
            ) from error
        if not isinstance(state, dict):
            raise RuntimeError("O arquivo de perda diária contém um formato inválido.")

        day_key = self.current_day.isoformat()
        day_state = state.get(day_key, {})
        if not isinstance(day_state, dict):
            raise RuntimeError("A entrada diária no arquivo de perda está inválida.")
        for saved_loss in day_state.values():
            if (
                isinstance(saved_loss, bool)
                or not isinstance(saved_loss, (int, float))
                or not math.isfinite(saved_loss)
                or saved_loss < 0
            ):
                raise RuntimeError("O arquivo contém um valor de perda diária inválido.")
        day_state[self.account_type] = round(self.daily_loss, 2)
        current_day_state = {day_key: day_state}

        temporary_path = self.daily_loss_path.with_name(
            self.daily_loss_path.name + ".tmp"
        )
        try:
            temporary_path.write_text(
                json.dumps(current_day_state, sort_keys=True, indent=2) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary_path, self.daily_loss_path)
        except OSError as error:
            raise RuntimeError(
                f"Não foi possível persistir a perda diária; novas ordens serão "
                f"bloqueadas: {error}"
            ) from error

    def _roll_day(self) -> None:
        today = datetime.now(timezone.utc).date()
        if today != self.current_day:
            self.current_day = today
            self.daily_loss = 0.0
            self.stopped = False

    def _stop_for_daily_loss(self) -> None:
        if self.stopped:
            return
        self.stopped = True
        publish_websocket({"type": "bot_stopped", "reason": "daily_loss_limit"})
        logger.warning("Bot parado: limite diário de perda atingido.")

    def _quote(self, asset: str) -> float:
        try:
            candles = _call_with_timeout(
                lambda: self.client.get_candles(asset, 60, 1, int(time.time())),
                IQ_CANDLES_TIMEOUT_SECONDS,
                description=f"ao obter o preço atual de {asset}",
            )
        except TimeoutError as error:
            raise RuntimeError(
                f"Tempo esgotado ao obter o preço atual de {asset}."
            ) from error
        if not candles:
            raise RuntimeError(f"Não foi possível obter preço atual para {asset}.")
        latest = max(candles, key=lambda candle: int(candle.get("from", 0)))
        price = float(latest["close"])
        if not math.isfinite(price) or price <= 0:
            raise RuntimeError(f"A API retornou um preço inválido para {asset}.")
        return price

    def _record_result(
        self, trade_id: str, asset: str, direction: str, result: str, pnl: float
    ) -> None:
        self.daily_loss += max(0.0, -pnl)
        try:
            self._persist_daily_loss()
        except RuntimeError:
            self.stopped = True
            raise
        publish_websocket(
            {
                "type": "trade_result",
                "trade_id": trade_id,
                "asset": asset,
                "direction": direction,
                "result": result,
                "pnl": round(pnl, 2),
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
                    "+00:00", "Z"
                ),
            },
            required=self.live,
        )
        if self.daily_loss >= MAX_DAILY_LOSS:
            self._stop_for_daily_loss()

    def place_trade(
        self, asset: str, direction: str, amount: float, expiration: int
    ) -> dict[str, Any]:
        with self.trade_lock:
            return self._place_trade_locked(asset, direction, amount, expiration)

    def _place_trade_locked(
        self, asset: str, direction: str, amount: float, expiration: int
    ) -> dict[str, Any]:
        self._roll_day()
        normalized_direction = direction.strip().upper()
        if normalized_direction not in {"CALL", "PUT"}:
            raise ValueError("Direção deve ser CALL ou PUT.")
        if not re.fullmatch(r"[A-Z0-9._-]+", asset.strip().upper()):
            raise ValueError("Ativo inválido.")
        if (
            isinstance(amount, bool)
            or not isinstance(amount, (int, float))
            or not math.isfinite(amount)
            or amount <= 0
            or amount > MAX_STAKE
        ):
            raise ValueError(f"A stake deve ser maior que zero e no máximo $ {MAX_STAKE:.2f}.")
        if isinstance(expiration, bool) or not isinstance(expiration, int) or expiration < 1:
            raise ValueError("A expiração deve ser um número inteiro de minutos maior que zero.")
        if self.stopped or self.daily_loss >= MAX_DAILY_LOSS:
            self._stop_for_daily_loss()
            raise RuntimeError("Bot parado pelo limite diário de perda.")
        if self.live and (_websocket_loop is None or not _websocket_loop.is_running()):
            raise RuntimeError("WebSocket indisponível; ordem real bloqueada.")

        normalized_asset = asset.strip().upper()

        entry_price = self._quote(normalized_asset)
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
            "+00:00", "Z"
        )

        blitz_payout: int | None = None
        blitz_result: dict[str, Any] | None = None
        action = "call" if normalized_direction == "CALL" else "put"

        def submit_live_order(
            asset_to_trade: str,
        ) -> tuple[Any, int | None, dict[str, Any] | None]:
            asset_type = _get_asset_type(self.client, asset_to_trade)
            print(
                f"[DEBUG] Ativo {asset_to_trade} será operado como tipo: {asset_type}"
            )

            if asset_type == "blitz":
                if not self.blitz_client_enabled:
                    raise RuntimeError(
                        "Ordens Blitz bloqueadas: cliente desabilitado por "
                        "--disable-blitz-client."
                    )
                try:
                    active_id, payout = _resolve_blitz_active(
                        _myiq_client, asset_to_trade
                    )
                    print(
                        f"[DEBUG] myiq: {asset_to_trade} -> active_id={active_id} "
                        f"| payout={payout}% | direção={action} | valor={amount} "
                        f"| duração={BLITZ_DURATION_SECONDS}s"
                    )
                    result = _dispatch_blitz_buy(
                        _myiq_client, self.client, active_id, action, amount
                    )
                except _AssetUnavailableError:
                    raise
                except Exception as error:
                    if _is_unavailable_asset_error(error):
                        raise _AssetUnavailableError(str(error)) from error
                    logger.error(
                        "[ERRO] Falha ao enviar a ordem Blitz via myiq: %r\n%s",
                        error,
                        traceback.format_exc(),
                    )
                    message = f"Falha ao enviar a ordem Blitz via myiq: {error!r}"
                    print(f"[ERRO] {message}", flush=True)
                    publish_websocket({"type": "trade_error", "message": message})
                    raise RuntimeError(message) from error
                if _is_unavailable_asset_error(result):
                    raise _AssetUnavailableError(str(result))
                order = result.get("order_id") or result.get("id")
                return order, payout, result

            print(
                f"[DEBUG] Tentando comprar: {asset_to_trade} | tipo: {asset_type} "
                f"| valor: {amount} | expiração: {expiration}s"
            )
            try:
                accepted, response = self.client.buy(
                    amount, asset_to_trade, action, expiration
                )
            except Exception as error:
                if _is_unavailable_asset_error(error):
                    raise _AssetUnavailableError(str(error)) from error
                raise
            print(f"[DEBUG] Resposta do buy(): {accepted} | {response}")
            if not accepted:
                if _is_unavailable_asset_error(response):
                    raise _AssetUnavailableError(str(response))
                reason = (
                    str(response).strip()
                    if response is not None and str(response).strip()
                    else "a corretora não informou o motivo."
                )
                raise RuntimeError(f"A IQ Option recusou a ordem: {reason}")
            return response, None, None

        def unavailable_result(
            asset: str, error: _AssetUnavailableError
        ) -> dict[str, Any]:
            if _is_suspended_asset_error(error):
                report_suspended_asset()
                result = "REJECTED"
            else:
                report_cannot_purchase()
                result = "SKIPPED"
            return {
                "asset": asset,
                "direction": normalized_direction,
                "result": result,
                "pnl": 0.0,
                "order_id": None,
                "reason": str(error),
            }

        if self.live:
            requested_asset = normalized_asset
            try:
                order_id, blitz_payout, blitz_result = (
                    submit_live_order(normalized_asset)
                )
            except _AssetUnavailableError as error:
                if normalized_asset.endswith("-OTC"):
                    return unavailable_result(normalized_asset, error)

                fallback_asset = f"{normalized_asset}-OTC"
                logger.info(
                    "[FALLBACK] Ativo %s indisponível, tentando %s...",
                    normalized_asset,
                    fallback_asset,
                )
                fallback_entry_price = self._quote(fallback_asset)
                try:
                    order_id, blitz_payout, blitz_result = (
                        submit_live_order(fallback_asset)
                    )
                except _AssetUnavailableError as fallback_error:
                    return unavailable_result(requested_asset, fallback_error)
                normalized_asset = fallback_asset
                entry_price = fallback_entry_price
        else:
            order_id = None

        trade_id = uuid.uuid4().hex
        publish_websocket(
            {
                "type": "trade_open",
                "trade_id": trade_id,
                "asset": normalized_asset,
                "direction": normalized_direction,
                "amount": float(amount),
                "entry_price": entry_price,
                "expiration": expiration,
                "timestamp": timestamp,
            },
            required=self.live,
        )

        if self.live:
            if blitz_result is not None:
                raw_outcome = blitz_result.get("result") or blitz_result.get("win")
                raw_status = str(blitz_result.get("status") or "").strip().lower()
                official_pnl = _as_finite_float(
                    blitz_result.get("pnl", blitz_result.get("profit"))
                )
                outcome = _official_outcome(raw_outcome)
                if raw_status == "error":
                    raise RuntimeError(
                        "A myiq não devolveu o resultado oficial da ordem Blitz "
                        f"(retorno: {blitz_result})."
                    )
                if outcome == "":
                    if official_pnl is None:
                        raise RuntimeError(
                            "A myiq não devolveu o resultado oficial da ordem Blitz "
                            f"(retorno: {blitz_result})."
                        )
                    # O P&L da myiq também é oficial; usado apenas se o texto do
                    # resultado vier ausente/inesperado.
                    outcome = (
                        "WIN"
                        if official_pnl > 0
                        else "LOSS"
                        if official_pnl < 0
                        else "DRAW"
                    )
                    logger.warning(
                        "Resultado oficial ausente para a ordem %s; usando o P&L "
                        "oficial (%s).",
                        order_id,
                        official_pnl,
                    )
                rate = (
                    blitz_payout / 100
                    if blitz_payout is not None and blitz_payout > 0
                    else None
                )
                if raw_status == "fallback" and official_pnl is not None:
                    # Fallback por saldo: o PnL é a própria variação de saldo.
                    pnl = round(official_pnl, 2)
                else:
                    pnl = _official_pnl(outcome, amount, rate, official_pnl)
            else:
                if order_id is None:
                    raise RuntimeError(
                        "A IQ Option aceitou a ordem, mas não retornou o ID; "
                        "não é possível confirmar o resultado."
                    )
                settlement = _call_with_timeout(
                    lambda: self.client.check_win_v4(order_id),
                    max(
                        IQ_SETTLEMENT_BASE_TIMEOUT_SECONDS,
                        expiration * 60 + IQ_SETTLEMENT_BASE_TIMEOUT_SECONDS,
                    ),
                    description="ao aguardar o resultado oficial da ordem",
                )
                raw_outcome: Any = None
                raw_pnl: Any = None
                if isinstance(settlement, tuple) and len(settlement) >= 2:
                    raw_outcome, raw_pnl = settlement[0], settlement[1]
                elif isinstance(settlement, dict):
                    raw_outcome = settlement.get("result", settlement.get("win"))
                    raw_pnl = settlement.get("pnl", settlement.get("profit"))
                else:
                    raw_outcome = getattr(settlement, "result", None)
                    raw_pnl = getattr(settlement, "pnl", None)

                official_pnl = _as_finite_float(raw_pnl)
                outcome = _official_outcome(raw_outcome)
                if outcome == "":
                    if official_pnl is None:
                        raise RuntimeError(
                            "A IQ Option não retornou o resultado oficial da ordem."
                        )
                    # O P&L também é oficial; usado apenas se o texto do
                    # resultado vier ausente/inesperado.
                    outcome = (
                        "WIN"
                        if official_pnl > 0
                        else "LOSS"
                        if official_pnl < 0
                        else "DRAW"
                    )
                    logger.warning(
                        "Resultado oficial ausente para a ordem %s; usando o P&L "
                        "oficial (%s).",
                        order_id,
                        official_pnl,
                    )
                pnl = _official_pnl(outcome, amount, None, official_pnl)

            print(
                f"[RESULTADO OFICIAL] Ordem {order_id} -> {outcome} | PnL: {pnl:.2f}"
            )
            result = outcome
        else:
            time.sleep(expiration * 60)
            exit_price = self._quote(normalized_asset)
            won = (
                exit_price > entry_price
                if normalized_direction == "CALL"
                else exit_price < entry_price
            )
            pnl = round(amount * PAPER_PAYOUT, 2) if won else -float(amount)
            result = "WIN" if won else "LOSS"

        try:
            self._record_result(trade_id, normalized_asset, normalized_direction, result, pnl)
        finally:
            publish_balance(self.client)
        return {
            "asset": normalized_asset,
            "direction": normalized_direction,
            "result": result,
            "pnl": round(pnl, 2),
            "order_id": order_id,
        }


_active_trader: TradeExecutor | None = None


def configure_trading(
    client: Any,
    *,
    live: bool,
    account_type: str = "PRACTICE",
    blitz_client_enabled: bool = True,
) -> None:
    global _account_type, _active_trader
    _account_type = account_type
    _active_trader = TradeExecutor(
        client,
        live=live,
        account_type=account_type,
        blitz_client_enabled=blitz_client_enabled,
    )


def place_trade(asset: str, direction: str, amount: float, expiration: int) -> dict[str, Any]:
    if _active_trader is None:
        raise RuntimeError("O bot ainda não está conectado à IQ Option.")
    return _active_trader.place_trade(asset, direction, amount, expiration)


def set_live_mode(live: bool) -> None:
    if _active_trader is None:
        raise RuntimeError("O bot ainda não está conectado à IQ Option.")
    _active_trader.set_live_mode(live)


def prompt_account_type() -> str:
    value = os.getenv("IQOPTION_ACCOUNT", "").strip().upper()
    while value not in {"PRACTICE", "REAL"}:
        value = input("Tipo de conta (PRACTICE/REAL): ").strip().upper()
    return value


def confirm_real_account() -> None:
    phrase = "CONFIRMAR CONTA REAL"
    print(
        "\nA conta REAL será acessada. Ordens só podem ser enviadas com "
        "ALLOW_REAL_TRADING=1, --live e esta confirmação."
    )
    for attempt in range(1, 3):
        answer = input(f"Confirmação {attempt}/2 — digite “{phrase}”: ").strip()
        if answer != phrase:
            raise RuntimeError("Confirmação da conta REAL não concluída.")


def prompt_credentials() -> tuple[str, str]:
    email = os.getenv("IQOPTION_EMAIL", "").strip()
    if not email:
        email = input("E-mail da IQ Option: ").strip()
    if not email:
        raise ValueError("O e-mail não pode ficar vazio.")

    password = os.getenv("IQOPTION_PASSWORD", "")
    if not password:
        password = getpass.getpass("Senha da IQ Option: ")
    if not password:
        raise ValueError("A senha não pode ficar vazia.")
    return email, password


def prompt_asset() -> str:
    while True:
        asset = input("Ativo (ex.: EURUSD, EURUSD-OTC, BTCUSD): ").strip().upper()
        if re.fullmatch(r"[A-Z0-9._-]+", asset):
            return asset
        print("Ativo inválido. Use letras, números, ponto, hífen ou sublinhado.")


def prompt_timeframe() -> tuple[str, int]:
    while True:
        choice = input("Timeframe (M1/M5): ").strip().upper()
        if choice in TIMEFRAMES:
            return choice, TIMEFRAMES[choice]
        print("Timeframe inválido. Escolha M1 (60s) ou M5 (300s).")


def normalize_candle(candle: dict[str, Any]) -> tuple[int, float, float, float, float, float]:
    """Converte os campos retornados pela API para o formato CSV do app."""
    timestamp = candle.get("from", candle.get("timestamp", candle.get("time", candle.get("at"))))
    if timestamp is None:
        raise ValueError("A API retornou um candle sem timestamp.")

    timestamp_seconds = int(float(timestamp))
    if timestamp_seconds > 10**12:
        timestamp_seconds //= 1000

    try:
        open_price = float(candle["open"])
        high = float(candle.get("max", candle.get("high")))
        low = float(candle.get("min", candle.get("low")))
        close = float(candle["close"])
        volume = float(candle["volume"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"A API retornou candle incompleto ou inválido: {candle!r}") from error

    values = (open_price, high, low, close, volume)
    if not all(math.isfinite(value) for value in values):
        raise ValueError(f"A API retornou valores não finitos no candle: {candle!r}")
    if min(open_price, high, low, close) <= 0 or volume < 0:
        raise ValueError(f"A API retornou OHLC/volume fora do intervalo esperado: {candle!r}")
    if high < max(open_price, close) or low > min(open_price, close) or high < low:
        raise ValueError(f"A API retornou OHLC inconsistente: {candle!r}")

    return timestamp_seconds, open_price, high, low, close, volume


def save_candles(
    candles: list[dict[str, Any]],
    path: Path | None = None,
    *,
    source: str,
    asset: str,
    timeframe: str,
) -> dict[str, Any]:
    seconds = TIMEFRAMES.get(timeframe)
    if seconds is None:
        raise ValueError(f"Timeframe inválido para exportação: {timeframe}.")
    if re.fullmatch(r"[A-Z0-9._-]{1,32}", asset) is None:
        raise ValueError(f"Ativo inválido para exportação: {asset}.")
    if not source.strip():
        raise ValueError("A fonte histórica não pode ficar vazia.")

    by_timestamp: dict[int, tuple[int, float, float, float, float, float]] = {}
    for candle in candles:
        row = normalize_candle(candle)
        timestamp = row[0]
        if timestamp % seconds != 0:
            raise ValueError(
                f"Timestamp {timestamp} não está alinhado ao timeframe {timeframe}."
            )
        previous = by_timestamp.get(timestamp)
        if previous is not None and previous != row:
            raise ValueError(
                f"A fonte retornou candles conflitantes no timestamp {timestamp}."
            )
        by_timestamp[timestamp] = row

    normalized = sorted(by_timestamp.values(), key=lambda row: row[0])
    if not normalized:
        raise ValueError("Nenhum candle disponível; o CSV não foi salvo.")

    period_start = datetime.fromtimestamp(normalized[0][0], timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    period_end = datetime.fromtimestamp(normalized[-1][0], timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    gap_count = 0
    missing_intervals = 0
    for previous, current in zip(normalized, normalized[1:]):
        difference = current[0] - previous[0]
        if difference % seconds != 0:
            raise ValueError(
                f"Intervalo de timestamps incompatível com {timeframe}: "
                f"{previous[0]} → {current[0]}."
            )
        if difference > seconds:
            gap_count += 1
            missing_intervals += difference // seconds - 1

    destination = CSV_PATH if path is None else path
    with destination.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(CSV_COLUMNS)
        for timestamp, open_price, high, low, close, volume in normalized:
            timestamp_utc = datetime.fromtimestamp(timestamp, timezone.utc).isoformat(
                timespec="seconds"
            ).replace("+00:00", "Z")
            writer.writerow(
                (
                    timestamp_utc,
                    open_price,
                    high,
                    low,
                    close,
                    volume,
                    source,
                    asset,
                    timeframe,
                    period_start,
                    period_end,
                )
            )
    return {
        "source": source,
        "asset": asset,
        "timeframe": timeframe,
        "count": len(normalized),
        "period_start": period_start,
        "period_end": period_end,
        "gap_count": gap_count,
        "missing_intervals": missing_intervals,
    }


def run_strategy(
    candles: list[dict[str, Any]], timeframe: str, dry_run: bool
) -> None:
    """Ponto de integração da estratégia; intencionalmente sem operações."""
    # M1 (60s): integrar aqui a estratégia de curto prazo, usando candles fechados.
    # M5 (300s): integrar aqui a estratégia de 5 minutos e seus próprios filtros.
    # Ao implementar uma estratégia, dry_run deve apenas imprimir uma simulação.
    # O envio de ordens reais permanece fora do escopo deste conector.
    del candles, timeframe
    if dry_run:
        print("[DRY-RUN] Nenhuma ordem simulada: ainda não há estratégia configurada.")
    else:
        print("Somente leitura: estratégia e envio de ordens não estão habilitados.")


def _start_optional_blitz_client(
    email: str,
    password: str,
    account: str,
    *,
    enabled: bool,
) -> Any | None:
    if not enabled:
        logger.info("Cliente myiq (Blitz) desabilitado pela opção --disable-blitz-client.")
        print(
            "[INFO] Cliente myiq (Blitz) desabilitado por --disable-blitz-client.",
            flush=True,
        )
        return None

    try:
        client = _start_myiq_client(email, password, account)
    except Exception as error:  # noqa: BLE001 - Blitz é opcional para os demais ativos
        logger.warning("Cliente myiq (Blitz) indisponível: %s", error)
        print(f"[AVISO] Cliente myiq (Blitz) indisponível: {error}", flush=True)
        return None

    print("Cliente myiq (Blitz) conectado.", flush=True)
    return client


def connect_and_read_balance(
    account: str,
    email: str,
    password: str,
    *,
    enable_blitz_client: bool = True,
) -> Any:
    try:
        from iqoptionapi.stable_api import IQ_Option
    except ImportError as error:
        raise RuntimeError(
            "Dependência iqoptionapi ausente. Instale-a com: "
            "python -m pip install -r requirements.txt"
        ) from error

    client = IQ_Option(email, password)
    _safe_connect(client)

    try:
        _call_with_timeout(
            lambda: client.change_balance(account),
            IQ_BALANCE_TIMEOUT_SECONDS,
            description=f"ao selecionar a conta {account}",
            timeout_error=IQOptionConnectionError,
        )
        raw_balance = _call_with_timeout(
            client.get_balance,
            IQ_BALANCE_TIMEOUT_SECONDS,
            description="ao ler o saldo da conta",
            timeout_error=IQOptionConnectionError,
        )
    except IQOptionConnectionError:
        raise
    except Exception as error:  # noqa: BLE001 - mensagem amigável ao usuário
        raise IQOptionConnectionError(
            "Conectou à IQ Option, mas não foi possível ler o saldo da conta "
            f"{account}: {_connect_error_text(error)}"
        ) from error

    balance = _as_finite_float(raw_balance)
    if balance is None or balance < 0:
        raise IQOptionConnectionError(
            f"A IQ Option não retornou um saldo válido para a conta {account}."
        )

    account_label = "Demo" if account == "PRACTICE" else "Real"
    formatted_balance = (
        f"{balance:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    )
    print(f"Login concluído. Saldo {account_label}: $ {formatted_balance}")

    # A iqoptionapi (síncrona) segue como cliente principal. A myiq é iniciada em
    # paralelo apenas para ordens Blitz, que a iqoptionapi não suporta.
    _start_optional_blitz_client(
        email,
        password,
        account,
        enabled=enable_blitz_client,
    )

    return client


def export_candles(
    client: Any,
    asset: str | None = None,
    timeframe: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    asset = prompt_asset() if asset is None else asset.strip().upper()
    if re.fullmatch(r"[A-Z0-9._-]{1,32}", asset) is None:
        raise ValueError("Ativo inválido para exportação.")
    if timeframe is None:
        timeframe, seconds = prompt_timeframe()
    else:
        timeframe = timeframe.strip().upper()
        seconds = TIMEFRAMES.get(timeframe, 0)
        if seconds == 0:
            raise ValueError("Timeframe inválido para exportação; use M1 ou M5.")

    endtime = (int(time.time()) // seconds) * seconds - 1
    candles_by_timestamp: dict[int, dict[str, Any]] = {}
    download_error: Exception | None = None
    source_exhausted = False
    stalled = False
    batch_number = 0

    while True:
        batch_number += 1
        batch: list[dict[str, Any]] | None = None
        for attempt in range(1, MAX_BATCH_ATTEMPTS + 1):
            try:
                batch = _call_with_timeout(
                    lambda: client.get_candles(
                        asset, seconds, BATCH_SIZE, endtime
                    ),
                    IQ_CANDLES_TIMEOUT_SECONDS,
                    description=(
                        f"ao baixar o lote {batch_number} de candles de {asset}"
                    ),
                )
                if not batch:
                    source_exhausted = True
                    batch = None
                break
            except Exception as error:
                print(
                    f"Falha no lote {batch_number}, "
                    f"tentativa {attempt}/{MAX_BATCH_ATTEMPTS}: {error}",
                    file=sys.stderr,
                )
                if attempt < MAX_BATCH_ATTEMPTS:
                    print("Nova tentativa em 3 segundos; o login não será repetido.")
                    time.sleep(3)
                else:
                    download_error = error

        if batch is None:
            break

        timestamps = [normalize_candle(candle)[0] for candle in batch]
        previous_count = len(candles_by_timestamp)
        for timestamp, candle in zip(timestamps, batch):
            candles_by_timestamp.setdefault(timestamp, candle)
        new_count = len(candles_by_timestamp) - previous_count
        batch_count_text = f"{len(batch):,}".replace(",", ".")
        total_count_text = f"{len(candles_by_timestamp):,}".replace(",", ".")
        print(
            f"Baixando lote {batch_number}... "
            f"{batch_count_text} velas obtidas. Total: {total_count_text}."
        )

        if new_count == 0:
            print("A paginação não avançou: a fonte repetiu um lote sem candles novos.")
            stalled = True
            break

        endtime = min(timestamps) - 1
        time.sleep(1.5)

    candles = list(candles_by_timestamp.values())
    if download_error is not None:
        total_count_text = f"{len(candles):,}".replace(",", ".")
        raise RuntimeError(
            f"Download incompleto após {MAX_BATCH_ATTEMPTS} tentativas no lote "
            f"{batch_number}; {total_count_text} candles reais foram recebidos, "
            "mas o CSV existente foi preservado e não será substituído."
        ) from download_error
    if not candles:
        raise RuntimeError("A IQ Option não retornou candles para o ativo/timeframe escolhido.")
    if stalled:
        raise RuntimeError(
            "A IQ Option repetiu um lote sem candles novos; o maior período disponível "
            "não pôde ser confirmado e o CSV existente foi preservado."
        )
    if not source_exhausted:
        raise RuntimeError(
            "A paginação foi interrompida sem confirmação de fim do histórico; "
            "o CSV existente foi preservado."
        )

    summary = save_candles(
        candles,
        source="IQ Option",
        asset=asset,
        timeframe=timeframe,
    )
    print(f"CSV salvo: {CSV_PATH.resolve()}")
    print(
        f"Resumo: fonte={summary['source']}; ativo={summary['asset']}; "
        f"timeframe={summary['timeframe']}; candles={summary['count']:,}; "
        f"período UTC (abertura das velas)={summary['period_start']} a "
        f"{summary['period_end']}."
    )
    print(
        f"Lacunas: {summary['gap_count']} saltos de timestamp, "
        f"{summary['missing_intervals']:,} intervalos {timeframe} sem candle "
        "(inclui fechamentos de mercado; nenhum valor foi sintetizado)."
    )
    return candles, timeframe


def main() -> int:
    global _startup_allow_live
    parser = argparse.ArgumentParser(
        description=(
            "Conecta à IQ Option e pode iniciar o WebSocket. A conta REAL é "
            "bloqueada por padrão; comandos de execução exigem token de sessão."
        ),
        epilog=(
            "Conta REAL: exige ALLOW_REAL_TRADING=1, --live e a frase "
            "CONFIRMAR CONTA REAL no terminal. O token do WebSocket é exibido "
            "no startup e deve ser informado em Configurações."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="executa somente em modo paper; não pode ser combinado com --live.",
    )
    parser.add_argument(
        "--export-candles",
        action="store_true",
        help="pagina candles reais até a fonte não retornar mais histórico, após o login.",
    )
    parser.add_argument(
        "--asset",
        help="ativo para exportação histórica (ex.: EURUSD); exige --export-candles.",
    )
    parser.add_argument(
        "--timeframe",
        choices=tuple(TIMEFRAMES),
        help="timeframe da exportação histórica (M1 ou M5); exige --export-candles.",
    )
    parser.add_argument(
        "--ws-server",
        action="store_true",
        help=(
            "inicia o WebSocket em 127.0.0.1:8000; leitura de status não exige "
            "token, mas comandos de modo/ordem exigem autenticação."
        ),
    )
    parser.add_argument(
        "--disable-blitz-client",
        action="store_true",
        help=(
            "não inicia o cliente myiq; ordens Blitz são recusadas, "
            "mas os demais ativos seguem disponíveis."
        ),
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help=(
            "autoriza este processo a habilitar LIVE; conta REAL também exige "
            "ALLOW_REAL_TRADING=1 e confirmação no terminal."
        ),
    )
    args = parser.parse_args()
    if args.export_candles and not args.dry_run:
        parser.error("--export-candles exige --dry-run; nenhuma ordem será enviada.")
    if (args.asset is not None or args.timeframe is not None) and not args.export_candles:
        parser.error("--asset e --timeframe exigem --export-candles.")
    if args.live and args.dry_run:
        parser.error("--live e --dry-run não podem ser usados juntos.")
    if args.live and not args.ws_server:
        parser.error("--live exige --ws-server para manter as travas de monitoramento ativas.")
    _startup_allow_live = args.live

    try:
        from dotenv import load_dotenv
    except ImportError as error:
        print(
            "Erro: dependência python-dotenv ausente. Instale-a com: "
            "python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 1
    try:
        load_dotenv()
        account = prompt_account_type()
        validate_account_mode(
            account,
            live=args.live,
            allow_real_trading=os.getenv("ALLOW_REAL_TRADING") == "1",
        )
        if account == "REAL":
            confirm_real_account()
        email, password = prompt_credentials()
        client = connect_and_read_balance(
            account,
            email,
            password,
            enable_blitz_client=not args.disable_blitz_client,
        )
        if args.export_candles:
            candles, timeframe = export_candles(client, args.asset, args.timeframe)
            run_strategy(candles, timeframe, not args.live)
        elif args.dry_run:
            print("[DRY-RUN] Sem estratégia configurada; nenhuma ordem será simulada.")
        if args.ws_server:
            session_token = generate_session_token()
            print(
                "Token de sessão WebSocket (cole em Configurações; "
                f"válido somente neste processo): {session_token}",
                flush=True,
            )
            configure_trading(
                client,
                live=args.live,
                account_type=account,
                blitz_client_enabled=not args.disable_blitz_client,
            )
            server_thread = start_websocket_server()
            publish_balance(client)
            start_assets_poller(client)
            start_real_candles_poller(client)
            mode = "LIVE habilitado" if args.live else "DRY-RUN"
            print(f"WebSocket ativo em ws://127.0.0.1:8000/ws ({mode}).")
            print(
                "O WebSocket fornece monitoramento sem autenticação; "
                "alterar o modo e enviar ordens exige autenticar o token em Configurações. "
                "Auto-Trade precisa estar habilitado no app."
            )
            server_thread.join()
    except (KeyboardInterrupt, EOFError):
        print("\nOperação cancelada.", file=sys.stderr)
        return 130
    except IQOptionConnectionError as error:
        print(f"Erro de conexão: {error}", file=sys.stderr)
        return 1
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Erro: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - evita traceback cru ao usuário
        if os.getenv("PULSE_DEBUG") == "1":
            traceback.print_exc()
        else:
            print(
                f"Erro inesperado: {type(error).__name__}: {error}\n"
                "Defina PULSE_DEBUG=1 para exibir o traceback completo.",
                file=sys.stderr,
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
