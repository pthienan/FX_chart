"""FX Lab: local chart viewer + manual replay/backtest server.

Run:  python server.py   (opens http://127.0.0.1:8777, or the next free port)
"""
import socket
import threading
import webbrowser
from pathlib import Path

import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, request, send_from_directory

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
STATIC = BASE / "static"
DATA.mkdir(exist_ok=True)
PORT = 8777

SYMBOLS = {
    "EURUSD": {"yahoo": "EURUSD=X", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "GBPUSD": {"yahoo": "GBPUSD=X", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "AUDUSD": {"yahoo": "AUDUSD=X", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "USDJPY": {"yahoo": "USDJPY=X", "pip": 0.01, "digits": 3, "quote_usd": False},
}

# Yahoo limits: intraday < 1h only ~60 days back, 1h ~730 days.
SOURCES = {
    "M5": ("5m", "60d"),
    "M15": ("15m", "60d"),
    "M30": ("30m", "60d"),
    "H1": ("1h", "730d"),
    "D1": ("1d", "max"),
}
DERIVED = {"H4": ("H1", "4h"), "W1": ("D1", "W-MON")}
AGG = {"open": "first", "high": "max", "low": "min", "close": "last"}

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
_lock = threading.Lock()


def cache_path(sym, tf):
    return DATA / f"{sym}_{tf}.csv"


def fetch_yahoo(sym, tf):
    interval, period = SOURCES[tf]
    df = yf.download(SYMBOLS[sym]["yahoo"], period=period, interval=interval,
                     progress=False, auto_adjust=False, threads=False)
    if df is None or df.empty:
        return pd.DataFrame(columns=list(AGG))
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[["Open", "High", "Low", "Close"]].rename(columns=str.lower).dropna()
    idx = df.index
    df.index = idx.tz_convert("UTC") if idx.tz is not None else idx.tz_localize("UTC")
    df["high"] = df[["open", "high", "close"]].max(axis=1)
    df["low"] = df[["open", "low", "close"]].min(axis=1)
    return df


def load_cache(sym, tf):
    p = cache_path(sym, tf)
    if not p.exists():
        return None
    df = pd.read_csv(p, index_col=0)
    df.index = pd.to_datetime(df.index, utc=True)
    return df


def merge_save(sym, tf, new, prefer_existing=False):
    old = load_cache(sym, tf)
    if old is None:
        df = new
    else:
        df = pd.concat([new, old] if prefer_existing else [old, new])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_csv(cache_path(sym, tf), float_format="%.6f")
    return df


def update(sym, tfs=None):
    out = {}
    with _lock:
        for tf in tfs or SOURCES:
            new = fetch_yahoo(sym, tf)
            if new.empty:
                old = load_cache(sym, tf)
                out[tf] = 0 if old is None else len(old)
            else:
                out[tf] = len(merge_save(sym, tf, new))
    return out


def get_frame(sym, tf):
    if tf in DERIVED:
        src, rule = DERIVED[tf]
        df = get_frame(sym, src)
        return df.resample(rule, label="left", closed="left").agg(AGG).dropna()
    df = load_cache(sym, tf)
    if df is None:
        update(sym, [tf])
        df = load_cache(sym, tf)
        if df is None or df.empty:
            raise RuntimeError(f"Không tải được dữ liệu {sym} {tf} từ Yahoo")
    return df


def to_unix(index):
    return ((index - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)).astype("int64")


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/symbols")
def api_symbols():
    return jsonify(list(SYMBOLS))


@app.get("/api/indicators")
def api_indicators():
    folder = STATIC / "indicators"
    files = sorted(p.name for p in folder.glob("*.js") if not p.name.startswith("_")) if folder.exists() else []
    return jsonify(files)


@app.get("/api/candles")
def api_candles():
    sym = request.args.get("symbol", "EURUSD")
    tf = request.args.get("tf", "H1")
    if sym not in SYMBOLS or (tf not in SOURCES and tf not in DERIVED):
        return jsonify(error="symbol/tf không hợp lệ"), 400
    try:
        df = get_frame(sym, tf)
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 500
    info = SYMBOLS[sym]
    d = info["digits"]
    rows = list(zip(to_unix(df.index).tolist(), df["open"].round(d).tolist(),
                    df["high"].round(d).tolist(), df["low"].round(d).tolist(),
                    df["close"].round(d).tolist()))
    return jsonify(symbol=sym, tf=tf, pip=info["pip"], digits=d,
                   quote_usd=info["quote_usd"], data=rows)


@app.post("/api/update")
def api_update():
    sym = request.args.get("symbol", "EURUSD")
    if sym not in SYMBOLS:
        return jsonify(error="symbol không hợp lệ"), 400
    try:
        return jsonify(counts=update(sym))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 500


def free_port(start):
    for port in range(start, start + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("Không tìm được cổng trống")


if __name__ == "__main__":
    port = free_port(PORT)
    url = f"http://127.0.0.1:{port}"
    print(f"FX Lab đang chạy tại {url}  (Ctrl+C để dừng)")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True)
