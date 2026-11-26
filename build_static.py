"""Build a static copy of FX Lab for Cloudflare Pages: refresh Yahoo data, export JSON, copy the UI.

Run:  python build_static.py [--out site] [--no-update]
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import server

SCRIPT_MARK = '<script src="/static/lightweight-charts.js"></script>'


def write_json(path, obj):
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site")
    ap.add_argument("--no-update", action="store_true", help="dùng cache data/ có sẵn, không tải Yahoo")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(server.STATIC, out / "static")
    candles = out / "api" / "candles"
    candles.mkdir(parents=True)

    symbols = []
    for sym in server.SYMBOLS:
        if not args.no_update:
            try:
                print(sym, server.update(sym))
            except Exception as e:  # noqa: BLE001
                print(f"[warn] update {sym}: {e}")
        written = 0
        for tf in [*server.SOURCES, *server.DERIVED]:
            try:
                payload = server.candles_payload(sym, tf)
            except Exception as e:  # noqa: BLE001
                print(f"[warn] {sym} {tf}: {e}")
                continue
            if payload["data"]:
                write_json(candles / f"{sym}_{tf}.json", payload)
                written += 1
        if written:
            symbols.append(sym)
    if not symbols:
        sys.exit("Không có dữ liệu nào để xuất.")

    api = out / "api"
    write_json(api / "symbols.json", symbols)
    write_json(api / "indicators.json", server.indicator_files())
    write_json(api / "meta.json", {"updated": int(time.time())})

    html = (server.STATIC / "index.html").read_text(encoding="utf-8")
    if SCRIPT_MARK not in html:
        sys.exit("index.html không có thẻ script lightweight-charts để chèn cờ FX_STATIC.")
    html = html.replace(SCRIPT_MARK, "<script>window.FX_STATIC = true;</script>\n" + SCRIPT_MARK, 1)
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "_headers").write_text("/api/*\n  Cache-Control: no-cache\n", encoding="utf-8")
    print(f"Đã build {out} · cặp tiền: {', '.join(symbols)}")


if __name__ == "__main__":
    main()
