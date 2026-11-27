"""FX Lab: local chart viewer + manual replay/backtest server.

Run:  python server.py   (opens http://127.0.0.1:8777, or the next free port)
"""
import os
import socket
import threading
import webbrowser
from pathlib import Path

import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, request, send_from_directory

import accounts
import mt5_source
import oanda_source

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DATA_MT5 = DATA / "mt5"
DATA_OANDA = DATA / "oanda"
STATIC = BASE / "static"
DATA_MT5.mkdir(parents=True, exist_ok=True)
DATA_OANDA.mkdir(parents=True, exist_ok=True)
PORT = 8777
ALL_TFS = ["M5", "M15", "M30", "H1", "H4", "D1", "W1"]

SYMBOLS = {
    "EURUSD": {"yahoo": "EURUSD=X", "oanda": "EUR_USD", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "GBPUSD": {"yahoo": "GBPUSD=X", "oanda": "GBP_USD", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "AUDUSD": {"yahoo": "AUDUSD=X", "oanda": "AUD_USD", "pip": 0.0001, "digits": 5, "quote_usd": True},
    "USDJPY": {"yahoo": "USDJPY=X", "oanda": "USD_JPY", "pip": 0.01, "digits": 3, "quote_usd": False},
    # Yahoo has no spot XAUUSD; COMEX gold futures track it with a small premium. OANDA has spot XAU_USD.
    "XAUUSD": {"yahoo": "GC=F", "oanda": "XAU_USD", "pip": 0.1, "digits": 2, "quote_usd": True, "contract": 100},
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


def cache_path(sym, tf, src="yahoo"):
    folders = {"oanda": DATA_OANDA, "mt5": DATA_MT5}
    return folders.get(src, DATA) / f"{sym}_{tf}.csv"


def active_source():
    """OANDA khi có token, nếu không thì MT5 (Pepperstone) khi terminal đang đăng nhập, còn lại Yahoo."""
    forced = os.environ.get("FX_SOURCE", "auto").lower()
    if forced == "yahoo":
        return "yahoo"
    if forced == "mt5":
        return "mt5" if mt5_source.available() else "yahoo"
    if forced == "oanda":
        return "oanda" if oanda_source.available() else "yahoo"
    if oanda_source.available():
        return "oanda"
    return "mt5" if mt5_source.available() else "yahoo"


def source_label(src):
    if src == "oanda":
        return "OANDA"
    if src == "mt5":
        st = mt5_source.status()
        return f"{st.get('broker', 'MT5')} (MT5)"
    return "Yahoo Finance"


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


def load_cache(sym, tf, src="yahoo"):
    p = cache_path(sym, tf, src)
    if not p.exists():
        return None
    df = pd.read_csv(p, index_col=0)
    df.index = pd.to_datetime(df.index, utc=True)
    return df


def merge_save(sym, tf, new, prefer_existing=False, src="yahoo"):
    old = load_cache(sym, tf, src)
    if old is None:
        df = new
    else:
        df = pd.concat([new, old] if prefer_existing else [old, new])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_csv(cache_path(sym, tf, src), float_format="%.6f")
    return df


def update_mt5(sym, tf):
    old = load_cache(sym, tf, "mt5")
    last = None if old is None or old.empty else old.index.max()
    return merge_save(sym, tf, mt5_source.fetch(sym, tf, last), src="mt5")


def update_oanda(sym, tf):
    name = SYMBOLS[sym].get("oanda")
    if not name:
        raise RuntimeError(f"{sym} không có mã trên OANDA")
    old = load_cache(sym, tf, "oanda")
    last = None if old is None or old.empty else old.index.max()
    df = merge_save(sym, tf, oanda_source.fetch(name, tf, last), src="oanda")
    cap = oanda_source.MAX_BARS[tf]
    if len(df) > cap:
        df = df.iloc[len(df) - cap:]
        df.to_csv(cache_path(sym, tf, "oanda"), float_format="%.6f")
    return df


def update(sym, tfs=None, src=None):
    src = src or active_source()
    out = {}
    with _lock:
        if src == "oanda":
            for tf in tfs or ALL_TFS:
                out[tf] = len(update_oanda(sym, tf))
            return out
        if src == "mt5":
            for tf in tfs or ALL_TFS:
                out[tf] = len(update_mt5(sym, tf))
            return out
        for tf in tfs or SOURCES:
            new = fetch_yahoo(sym, tf)
            if new.empty:
                old = load_cache(sym, tf)
                out[tf] = 0 if old is None else len(old)
            else:
                out[tf] = len(merge_save(sym, tf, new))
    return out


def get_frame(sym, tf, src=None):
    src = src or active_source()
    if src == "oanda":
        # OANDA có sẵn mọi khung, nến ngày/H4/tuần cắt lúc 17:00 giờ New York.
        try:
            with _lock:
                return update_oanda(sym, tf)
        except Exception:  # noqa: BLE001
            df = load_cache(sym, tf, "oanda")
            if df is None or df.empty:
                raise
            return df
    if src == "mt5":
        # Broker has every timeframe natively (H4/D1/W1 aligned to the 17:00 New York close).
        try:
            with _lock:
                return update_mt5(sym, tf)
        except Exception:  # noqa: BLE001
            df = load_cache(sym, tf, "mt5")
            if df is None or df.empty:
                raise
            return df
    if tf in DERIVED:
        base, rule = DERIVED[tf]
        df = get_frame(sym, base, "yahoo")
        return df.resample(rule, label="left", closed="left").agg(AGG).dropna()
    df = load_cache(sym, tf)
    if df is None:
        update(sym, [tf], src)
        df = load_cache(sym, tf)
        if df is None or df.empty:
            raise RuntimeError(f"Không tải được dữ liệu {sym} {tf} từ Yahoo")
    return df


def to_unix(index):
    return ((index - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(seconds=1)).astype("int64")


def candles_payload(sym, tf, src=None):
    src = src or active_source()
    df = get_frame(sym, tf, src)
    info = SYMBOLS[sym]
    d = info["digits"]
    rows = list(zip(to_unix(df.index).tolist(), df["open"].round(d).tolist(),
                    df["high"].round(d).tolist(), df["low"].round(d).tolist(),
                    df["close"].round(d).tolist()))
    return dict(symbol=sym, tf=tf, pip=info["pip"], digits=d, quote_usd=info["quote_usd"],
                contract=info.get("contract", 100000), source=source_label(src), data=rows)


def indicator_files():
    folder = STATIC / "indicators"
    return sorted(p.name for p in folder.glob("*.js") if not p.name.startswith("_")) if folder.exists() else []


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/symbols")
def api_symbols():
    return jsonify(list(SYMBOLS))


@app.get("/api/indicators")
def api_indicators():
    return jsonify(indicator_files())


@app.get("/api/candles")
def api_candles():
    sym = request.args.get("symbol", "EURUSD")
    tf = request.args.get("tf", "H1")
    if sym not in SYMBOLS or (tf not in SOURCES and tf not in DERIVED):
        return jsonify(error="symbol/tf không hợp lệ"), 400
    try:
        return jsonify(candles_payload(sym, tf))
    except Exception as e:  # noqa: BLE001
        return jsonify(error=str(e)), 500


def _account_cookie(result):
    token = result.pop("token", None)
    resp = jsonify(result)
    if token:
        resp.set_cookie("fxlab_session", token, max_age=90 * 24 * 3600, httponly=True,
                        samesite="Lax", path="/", secure=request.is_secure)
    return resp


def _account_email():
    return accounts.email_from_token(request.cookies.get("fxlab_session"))


@app.post("/api/account/register")
def api_account_register():
    body = request.get_json(silent=True) or {}
    try:
        return _account_cookie(accounts.register(body.get("email"), body.get("password")))
    except accounts.AuthError as err:
        return jsonify(error=str(err)), err.status


@app.post("/api/account/login")
def api_account_login():
    body = request.get_json(silent=True) or {}
    try:
        return _account_cookie(accounts.login(body.get("email"), body.get("password")))
    except accounts.AuthError as err:
        return jsonify(error=str(err)), err.status


@app.post("/api/account/logout")
def api_account_logout():
    accounts.logout(request.cookies.get("fxlab_session"))
    resp = jsonify(ok=True)
    resp.delete_cookie("fxlab_session", path="/")
    return resp


@app.get("/api/account/me")
def api_account_me():
    email = _account_email()
    if not email:
        return jsonify(error="Chưa đăng nhập"), 401
    try:
        return jsonify(email=email, **accounts.profile_of(email))
    except accounts.AuthError as err:
        return jsonify(error=str(err)), err.status


@app.put("/api/account/profile")
def api_account_profile():
    email = _account_email()
    if not email:
        return jsonify(error="Chưa đăng nhập"), 401
    body = request.get_json(silent=True) or {}
    try:
        return jsonify(accounts.save_profile(email, body.get("profile")))
    except accounts.AuthError as err:
        return jsonify(error=str(err)), err.status


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
    src = active_source()
    print(f"Nguồn dữ liệu: {source_label(src)}")
    if src != "oanda":
        print("OANDA chưa dùng được:", oanda_source.status().get("reason", ""))
    print(f"FX Lab đang chạy tại {url}  (Ctrl+C để dừng)")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True)
