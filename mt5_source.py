"""Broker candles (Pepperstone or any MetaTrader 5 broker) via the official MetaTrader5 package.

Needs the MT5 terminal installed and logged in (a free demo account is enough). Set MT5_PATH to the
terminal64.exe path if it is not found automatically. Broker server time is New York + 7h (17:00 NY
daily close, like TradingView's PEPPERSTONE: symbols); bar times are converted to UTC here.
"""
import math
import os
import threading
import time

import pandas as pd

try:
    import MetaTrader5 as mt5
except ImportError:  # non-Windows, or package not installed
    mt5 = None

TF = {} if mt5 is None else {
    "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4, "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
}
TF_SEC = {"M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "H4": 14400, "D1": 86400, "W1": 604800}
MAX_BARS = 100_000
SERVER_SHIFT = pd.Timedelta(hours=7)

_lock = threading.RLock()
_state = {"ok": False, "err": "Chưa cài gói MetaTrader5" if mt5 is None else "", "tried": 0.0}


def available():
    """True when an MT5 terminal is running and logged in. Retries at most every 30 s."""
    if mt5 is None:
        return False
    with _lock:
        if _state["ok"] and mt5.terminal_info() is not None and mt5.account_info() is not None:
            return True
        if time.time() - _state["tried"] < 30:
            return False
        _state["tried"] = time.time()
        path = os.environ.get("MT5_PATH")
        ok = mt5.initialize(path) if path else mt5.initialize()
        if ok and mt5.account_info() is None:
            ok = False
            _state["err"] = "MT5 đang mở nhưng chưa đăng nhập tài khoản"
        elif not ok:
            _state["err"] = f"Không kết nối được MT5: {mt5.last_error()}"
        _state["ok"] = bool(ok)
        return _state["ok"]


def status():
    if available():
        acc = mt5.account_info()
        return {"source": "mt5", "broker": acc.company, "server": acc.server}
    return {"source": "yahoo", "reason": _state["err"]}


def _resolve(name):
    if mt5.symbol_info(name) is None:
        found = [s.name for s in (mt5.symbols_get(f"{name}*") or [])]
        if not found:
            raise RuntimeError(f"MT5 không có mã {name}")
        name = found[0]
    mt5.symbol_select(name, True)
    return name


def to_utc(server_seconds):
    naive = pd.to_datetime(server_seconds, unit="s") - SERVER_SHIFT
    ny = naive.tz_localize("America/New_York", ambiguous="NaT", nonexistent="shift_forward")
    return ny.tz_convert("UTC")


def fetch(name, tf, last_utc=None):
    """Latest bars for `tf`; only the bars since `last_utc` (plus a small overlap) when given."""
    with _lock:
        if not available():
            raise RuntimeError(_state["err"] or "MT5 không sẵn sàng")
        sym = _resolve(name)
        count = MAX_BARS
        if last_utc is not None:
            gap = (pd.Timestamp.now(tz="UTC") - last_utc).total_seconds()
            count = min(MAX_BARS, max(10, math.ceil(gap / TF_SEC[tf]) + 10))
        rates = mt5.copy_rates_from_pos(sym, TF[tf], 0, count)
        if rates is None or len(rates) == 0:
            raise RuntimeError(f"MT5 không trả dữ liệu {sym} {tf}: {mt5.last_error()}")
    df = pd.DataFrame(rates)[["time", "open", "high", "low", "close"]]
    df.index = to_utc(df.pop("time").to_numpy())
    return df[df.index.notna()]
