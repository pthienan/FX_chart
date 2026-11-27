"""Attach the FXLAB KV namespace to the Cloudflare Pages project. Used by GitHub Actions.

A missing permission prints the API error and exits 1. The deploy step still runs.
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
PROJECT = os.environ.get("PAGES_PROJECT", "fxlab-ka")
TITLE = "fxlab-users"
API = "https://api.cloudflare.com/client/v4"


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise SystemExit(f"Cloudflare {err.code} {path}: {detail}")


def main():
    if not ACCOUNT or not TOKEN:
        raise SystemExit("Thiếu CLOUDFLARE_ACCOUNT_ID hoặc CLOUDFLARE_API_TOKEN")
    listed = call("GET", f"/accounts/{ACCOUNT}/storage/kv/namespaces?per_page=100")
    found = [row for row in listed.get("result", []) if row.get("title") == TITLE]
    if found:
        ns_id = found[0]["id"]
    else:
        created = call("POST", f"/accounts/{ACCOUNT}/storage/kv/namespaces", {"title": TITLE})
        ns_id = created["result"]["id"]
    project = call("GET", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}")
    configs = project["result"].get("deployment_configs") or {}
    for name in ("production", "preview"):
        cfg = configs.setdefault(name, {})
        spaces = cfg.setdefault("kv_namespaces", {})
        spaces["FXLAB"] = {"namespace_id": ns_id}
    call("PATCH", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}", {"deployment_configs": configs})
    # wrangler pages deploy only sends bindings listed in this file. A project setting alone
    # does not reach the new deployment, so registration sees no FXLAB binding.
    Path("wrangler.toml").write_text(
        f'name = "{PROJECT}"\n'
        'compatibility_date = "2026-11-27"\n'
        "\n"
        "[[kv_namespaces]]\n"
        'binding = "FXLAB"\n'
        f'id = "{ns_id}"\n'
        f'preview_id = "{ns_id}"\n',
        encoding="utf-8",
    )
    print(f"Đã gắn KV {TITLE} ({ns_id}) vào {PROJECT}")


if __name__ == "__main__":
    main()
