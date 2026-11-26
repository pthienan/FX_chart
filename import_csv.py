"""Import longer history (e.g. M1 from HistData.com or Dukascopy) into the FX Lab cache.

Usage:
    python import_csv.py EURUSD path\\to\\file.csv [more files...] [--tz-offset HOURS]

Supported formats:
  * HistData "Generic ASCII" M1:  20240102 170000;1.10421;1.10425;1.10418;1.10420;0
    (time is EST without DST = UTC-5, converted automatically)
  * Dukascopy CSV:  Gmt time,Open,High,Low,Close,Volume  with  01.01.2024 00:00:00.000
  * Any CSV with a header containing a time/date column + open/high/low/close.
    Use --tz-offset if its times are not UTC (e.g. --tz-offset 2 for UTC+2).

Existing Yahoo data wins where both sources overlap.
"""
import argparse

import pandas as pd

from server import AGG, SOURCES, SYMBOLS, merge_save

TF_RULE = {"M5": "5min", "M15": "15min", "M30": "30min", "H1": "1h", "D1": "1D"}
TF_SEC = {"M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "D1": 86400}


def read_any(path, tz_offset):
    with open(path, "r", encoding="utf-8-sig") as f:
        first = f.readline()
    if ";" in first and first[:8].isdigit():
        df = pd.read_csv(path, sep=";", header=None,
                         names=["time", "open", "high", "low", "close", "vol"])
        df.index = pd.to_datetime(df["time"], format="%Y%m%d %H%M%S") + pd.Timedelta(hours=5)
        df.index = df.index.tz_localize("UTC")
        return df[list(AGG)]

    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    tcol = next((c for c in df.columns if "time" in c or "date" in c), None)
    if tcol is None:
        raise ValueError(f"{path}: không tìm thấy cột thời gian")
    if tcol == "gmt time":
        idx = pd.to_datetime(df[tcol], format="%d.%m.%Y %H:%M:%S.%f")
    else:
        idx = pd.to_datetime(df[tcol])
    if idx.dt.tz is not None:
        idx = idx.dt.tz_convert("UTC").dt.tz_localize(None)
    idx = idx - pd.Timedelta(hours=tz_offset)
    df.index = pd.DatetimeIndex(idx).tz_localize("UTC")
    return df[list(AGG)].astype(float)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol", choices=list(SYMBOLS))
    ap.add_argument("files", nargs="+")
    ap.add_argument("--tz-offset", type=float, default=0.0)
    a = ap.parse_args()

    df = pd.concat([read_any(p, a.tz_offset) for p in a.files]).sort_index()
    df = df[~df.index.duplicated(keep="last")].dropna()
    step = df.index.to_series().diff().dt.total_seconds().median()
    print(f"Đọc {len(df)} nến, bước ~{step:.0f}s, {df.index[0]} -> {df.index[-1]}")

    for tf in SOURCES:
        if TF_SEC[tf] < step:
            continue
        res = df.resample(TF_RULE[tf], label="left", closed="left").agg(AGG).dropna()
        merged = merge_save(a.symbol, tf, res, prefer_existing=True)
        print(f"  {tf}: +{len(res)} nến -> cache {len(merged)} nến")


if __name__ == "__main__":
    main()
