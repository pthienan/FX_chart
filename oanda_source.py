"""Nến lịch sử từ OANDA v20 (tài khoản demo Practice).

Cần OANDA_TOKEN trong file .env hoặc biến môi trường. Không cần cài MT5.
Nến ngày / H4 / tuần cắt lúc 17:00 giờ New York, đúng mặc định của OANDA.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
API = "https://api-fxpractice.oanda.com"
GRANULARITY = {"M5": "M5", "M15": "M15", "M30": "M30", "H1": "H1", "H4": "H4", "D1": "D", "W1": "W"}
# Trần số nến giữ lại để trình duyệt vẫn kéo chart được.
# D1/W1/H4/H1 nằm dưới trần nên lấy từ khoảng năm 2005. M5/M15/M30 lấy đoạn gần hơn.
MAX_BARS = {"M5": 150_000, "M15": 120_000, "M30": 120_000, "H1": 160_000, "H4": 80_000, "D1": 20_000, "W1": 5_000}
START = {
    "M5": "2024-06-01T00:00:00.000000000Z",
    "M15": "2021-06-01T00:00:00.000000000Z",
    "M30": "2016-01-01T00:00:00.000000000Z",
    "H1": "2005-01-01T00:00:00.000000000Z",
    "H4": "2005-01-01T00:00:00.000000000Z",
    "D1": "2004-01-01T00:00:00.000000000Z",
    "W1": "2004-01-01T00:00:00.000000000Z",
}
CHUNK = 5000
_COLS = ["open", "high", "low", "close"]


def load_env():
    path = BASE / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()


def token():
    return os.environ.get("OANDA_TOKEN", "").strip()


def available():
    return bool(token())


def status():
    if available():
        return {"source": "oanda", "broker": "OANDA"}
    return {"source": "yahoo", "reason": "Chưa có OANDA_TOKEN trong file .env"}


def _rfc3339(ts):
    stamp = pd.Timestamp(ts)
    stamp = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.000000000Z")


def _candles(instrument, granularity, count, from_time, include_first):
    query = {
        "granularity": granularity,
        "price": "M",
        "count": str(count),
        "dailyAlignment": "17",
        "alignmentTimezone": "America/New_York",
        "weeklyAlignment": "Friday",
        "includeFirst": "true" if include_first else "false",
    }
    if from_time:
        query["from"] = from_time
    url = f"{API}/v3/instruments/{instrument}/candles?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token()}",
        "User-Agent": "FXLab",
    })
    delay = 1.0
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode())
            return body.get("candles", [])
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:240]
            if err.code == 401:
                raise RuntimeError("OANDA từ chối token. Tạo lại token demo (Practice), dán vào file .env rồi mở lại run.bat.") from err
            last = RuntimeError(f"OANDA {err.code}: {detail}")
            if err.code not in (429, 500, 502, 503) or attempt == 3:
                raise last
        except urllib.error.URLError as err:
            last = RuntimeError(f"Không kết nối được OANDA: {err.reason}")
            if attempt == 3:
                raise last
        time.sleep(delay)
        delay *= 2
    raise last


def fetch(instrument, tf, last_utc=None):
    """Nến mid của OANDA. last_utc = nến cuối đang có, để chỉ tải phần mới và cập nhật nến đang chạy."""
    granularity = GRANULARITY[tf]
    cap = MAX_BARS[tf]
    cursor = _rfc3339(last_utc) if last_utc is not None else START[tf]
    include_first = last_utc is not None
    rows = []
    seen = None
    for _page in range(80):
        try:
            candles = _candles(instrument, granularity, CHUNK, cursor, include_first)
        except Exception:
            if rows:
                print(f"[warn] OANDA {instrument} {tf}: dừng sớm, giữ {len(rows)} nến", flush=True)
                break
            raise
        if not candles:
            break
        last = candles[len(candles) - 1]
        if last["time"] == seen:
            break
        seen = last["time"]
        for candle in candles:
            mid = candle.get("mid")
            if not mid:
                continue
            rows.append((candle["time"], float(mid["o"]), float(mid["h"]), float(mid["l"]), float(mid["c"])))
        if len(rows) > cap:
            rows = rows[len(rows) - cap:]
        print(f"OANDA {instrument} {tf}: {len(rows)} nến", flush=True)
        if len(candles) < CHUNK:
            break
        cursor = last["time"]
        include_first = False
    if not rows:
        return pd.DataFrame(columns=_COLS)
    frame = pd.DataFrame(rows, columns=["time", *_COLS])
    frame["time"] = pd.to_datetime(frame["time"], utc=True, format="ISO8601")
    frame = frame.set_index("time")
    frame = frame[~frame.index.duplicated(keep="last")].sort_index()
    if len(frame) > cap:
        frame = frame.iloc[len(frame) - cap:]
    return frame
