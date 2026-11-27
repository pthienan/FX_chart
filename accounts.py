"""Email login and the saved journal (trades, settings, drawings, indicators).

Passwords are stored as a salted SHA-256 hash. Sessions live in data/accounts/, which is not committed.
"""
import hashlib
import json
import re
import secrets
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "data" / "accounts"
USERS = ROOT / "users"
SESSIONS = ROOT / "sessions"
SESSION_TTL = 90 * 24 * 3600
MAX_FAILS = 10
FAIL_WINDOW = 3600
MAX_PROFILE = 1_500_000
_lock = threading.Lock()


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _email(value):
    text = str(value or "").strip().lower()
    if " " in text or text.count("@") != 1 or text.startswith("@") or text.endswith("@") or not 6 <= len(text) <= 120:
        raise AuthError("Email không hợp lệ")
    return text


def _password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise AuthError("Mật khẩu cần từ 8 đến 128 ký tự")
    return value


def _user_id(email):
    return hashlib.sha256(email.encode()).hexdigest()[:32]


def _hash(password, salt: bytes) -> str:
    return hashlib.sha256(salt + b"\0" + password.encode()).hexdigest()


def _read(path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _check_profile(profile):
    if not isinstance(profile, dict):
        raise AuthError("Nhật ký không hợp lệ")
    allowed = {"symbol", "tz", "sideHidden", "indicators", "drawDefaults", "symbols"}
    if set(profile) - allowed:
        raise AuthError("Nhật ký không hợp lệ")
    symbols = profile.get("symbols", {})
    if not isinstance(symbols, dict):
        raise AuthError("Nhật ký không hợp lệ")
    for key, value in symbols.items():
        if not isinstance(key, str) or len(key) != 6 or not key.isalnum() or not key.isupper() or not isinstance(value, dict):
            raise AuthError("Nhật ký không hợp lệ")
    if profile.get("indicators") is not None and not isinstance(profile.get("indicators"), list):
        raise AuthError("Nhật ký không hợp lệ")
    if profile.get("drawDefaults") is not None and not isinstance(profile.get("drawDefaults"), dict):
        raise AuthError("Nhật ký không hợp lệ")
    if len(json.dumps(profile)) > MAX_PROFILE:
        raise AuthError("Nhật ký quá lớn", 413)
    return profile


def _recent_fails(rec, now):
    return [t for t in rec.get("fails", []) if now - t < FAIL_WINDOW]


def _session(email):
    token = secrets.token_urlsafe(32)
    _write(SESSIONS / token, {"email": email, "exp": int(time.time()) + SESSION_TTL})
    return token


def register(email, password):
    email, password = _email(email), _password(password)
    with _lock:
        path = USERS / f"{_user_id(email)}.json"
        if path.exists():
            raise AuthError("Email này đã có tài khoản", 409)
        salt = secrets.token_bytes(16)
        _write(path, {
            "email": email, "salt": salt.hex(), "hash": _hash(password, salt),
            "profile": None, "updated": 0, "fails": [], "created": int(time.time()),
        })
        token = _session(email)
    return {"email": email, "profile": None, "updated": 0, "token": token}


def login(email, password):
    email, password = _email(email), _password(password)
    with _lock:
        path = USERS / f"{_user_id(email)}.json"
        rec = _read(path)
        now = time.time()
        if rec is None:
            _hash(password, b"\0" * 16)
            raise AuthError("Email hoặc mật khẩu không đúng", 401)
        fails = _recent_fails(rec, now)
        if len(fails) >= MAX_FAILS:
            raise AuthError("Đăng nhập sai quá nhiều lần. Thử lại sau một giờ.", 429)
        salt = bytes.fromhex(rec["salt"])
        if not secrets.compare_digest(_hash(password, salt), rec["hash"]):
            rec["fails"] = fails + [now]
            _write(path, rec)
            raise AuthError("Email hoặc mật khẩu không đúng", 401)
        rec["fails"] = []
        _write(path, rec)
        token = _session(email)
        return {"email": email, "profile": rec.get("profile"), "updated": rec.get("updated", 0), "token": token}


def _token(token):
    if not token or not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
        return None
    return token


def logout(token):
    token = _token(token)
    if token:
        path = SESSIONS / token
        if path.exists():
            path.unlink()


def email_from_token(token):
    token = _token(token)
    if not token:
        return None
    rec = _read(SESSIONS / token)
    if not rec or rec.get("exp", 0) < time.time():
        if rec:
            logout(token)
        return None
    return rec.get("email")


def profile_of(email):
    rec = _read(USERS / f"{_user_id(email)}.json")
    if rec is None:
        raise AuthError("Chưa đăng nhập", 401)
    return {"profile": rec.get("profile"), "updated": rec.get("updated", 0)}


def save_profile(email, profile):
    profile = _check_profile(profile)
    with _lock:
        path = USERS / f"{_user_id(email)}.json"
        rec = _read(path)
        if rec is None:
            raise AuthError("Chưa đăng nhập", 401)
        rec["profile"] = profile
        rec["updated"] = int(time.time())
        _write(path, rec)
        return {"updated": rec["updated"]}
