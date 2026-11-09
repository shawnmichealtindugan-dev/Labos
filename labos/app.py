"""College Computer Lab Web-OS -- Flask backend.
Run:  flask --app app init-db   then   python app.py
"""
import base64
import os
from urllib.parse import quote
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, redirect, url_for, abort, Response
from flask_login import (LoginManager, login_user, logout_user, login_required, current_user)
from sqlalchemy import or_
from models import db, User, File, Log, Announcement
from executor import run_code, LANGS
import io, csv, json, base64, zipfile
from flask import send_file
from sqlalchemy import func
import re
app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", "change-me-in-production"),
    SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", "mysql+pymysql://labos:Lab12345@localhost/labos?charset=utf8mb4"),
    MAX_CONTENT_LENGTH=20 * 1024 * 1024,  # binary uploads are stored as base64 (~33% larger)
)
db.init_app(app)
login_manager = LoginManager(app)
login_manager.login_view = "login"


@login_manager.user_loader
def load_user(uid): return db.session.get(User, int(uid))

@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"): return jsonify(error="login required"), 401
    return redirect(url_for("login"))


# ---------- helpers ----------
def log(action, detail=""):
    db.session.add(Log(user_id=current_user.id if current_user.is_authenticated else None,
                       action=action, detail=detail[:255]))
    db.session.commit()

def admin_required(f):
    """RBAC guard: only role == 'admin'."""
    @wraps(f)
    @login_required
    def wrapper(*a, **kw):
        if not current_user.is_admin:
            if request.path.startswith("/api/"): return jsonify(error="forbidden"), 403
            abort(403)
        return f(*a, **kw)
    return wrapper

BINARY_KINDS = {"pdf", "docx", "image", "binary"}   # content stored as base64
VALID_KINDS = {"doc", "sheet", "code", "text"} | BINARY_KINDS

def kind_for(name):
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return {"doc": "doc", "html": "code", "sheet": "sheet", "py": "code", "c": "code",
            "cpp": "code", "java": "code", "js": "code", "css": "code",
            "pdf": "pdf", "docx": "docx",
            "png": "image", "jpg": "image", "jpeg": "image", "gif": "image", "webp": "image",
            }.get(ext, "text")

def sniff_mime(kind, data):
    """Trust the file's real bytes, not its name or the client's claim."""
    if kind == "pdf" and data.startswith(b"%PDF"):
        return "application/pdf"
    if kind == "docx" and data.startswith(b"PK\x03\x04"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if kind == "image":
        if data.startswith(b"\x89PNG"): return "image/png"
        if data.startswith(b"\xff\xd8\xff"): return "image/jpeg"
        if data.startswith(b"GIF8"): return "image/gif"
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP": return "image/webp"
    return None

@app.before_request
def touch_session():  # powers "active sessions" in the admin stats
    if current_user.is_authenticated and not request.path.startswith("/static"):
        current_user.last_seen = datetime.utcnow()
        db.session.commit()


# ---------- auth + pages ----------
@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        u = User.query.filter_by(username=request.form.get("username", "").strip()).first()
        if u and u.check_password(request.form.get("password", "")):
            if not u.active:
                error = "This account is disabled. Contact the lab administrator."
            else:
                login_user(u); log("login", u.username)
                return redirect(url_for("index"))
        else:
            error = "Incorrect username or password."
    return render_template("login.html", error=error)

@app.route("/logout")
@login_required
def logout():
    log("logout"); logout_user()
    return redirect(url_for("login"))

@app.route("/")
@login_required
def index(): return render_template("index.html")

@app.route("/admin")
@admin_required
def admin(): return render_template("admin.html")


ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
WALLPAPERS = ("aurora", "sunset", "ocean", "forest", "lavender", "slate")
IDLE_CHOICES = (0, 5, 10, 30)

@app.get("/api/me")
@login_required
def me():
    ann = Announcement.query.order_by(Announcement.id.desc()).limit(3).all()
    return jsonify(user=current_user.to_dict(), theme=current_user.theme,
                   prefs=current_user.get_prefs(),
                   announcements=[a.message for a in ann])

@app.post("/api/settings")
@login_required
def settings():
    d = request.get_json(force=True)
    if d.get("theme") in ("light", "dark", "system"): current_user.theme = d["theme"]
    if "full_name" in d: current_user.full_name = str(d["full_name"])[:120]
    if isinstance(d.get("prefs"), dict):
        p, old = d["prefs"], current_user.get_prefs()
        if "accent" in p:
            if p["accent"] == "": old.pop("accent", None)
            elif isinstance(p["accent"], str) and ACCENT_RE.match(p["accent"]): old["accent"] = p["accent"].lower()
        if p.get("wallpaper") in WALLPAPERS: old["wallpaper"] = p["wallpaper"]
        if p.get("idle") in IDLE_CHOICES: old["idle"] = p["idle"]
        current_user.prefs = json.dumps(old)
    db.session.commit()
    return jsonify(ok=True, prefs=current_user.get_prefs())

@app.post("/api/password")
@login_required
def change_password():
    d = request.get_json(force=True)
    cur, new, conf = (str(d.get(k) or "") for k in ("current", "new", "confirm"))
    if not current_user.check_password(cur): return jsonify(error="Current password is incorrect"), 400
    if len(new) < 6: return jsonify(error="New password must be 6+ characters"), 400
    if new != conf: return jsonify(error="New passwords do not match"), 400
    current_user.set_password(new); db.session.commit(); log("password_change")
    return jsonify(ok=True)

@app.get("/api/storage")
@login_required
def storage():
    n, size = db.session.query(func.count(File.id), func.coalesce(func.sum(func.length(File.content)), 0)) \
        .filter(File.owner_id == current_user.id).one()
    return jsonify(files=int(n), bytes=int(size))

def _safe_name(name):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", name or "").strip(" .") or "file"

def _sheet_to_csv(content):
    try: o = json.loads(content or "[]")
    except Exception: return ""
    rows = o.get("data", []) if isinstance(o, dict) else o
    out = io.StringIO(); wr = csv.writer(out)
    for r in rows:
        if isinstance(r, list): wr.writerow(["" if v is None else v for v in r])
    return out.getvalue()

def _export_one(f):
    name = _safe_name(f.name); stem = name.rsplit(".", 1)[0] if "." in name else name
    if f.kind == "doc":
        return stem + ".html", ('<!doctype html>\n<meta charset="utf-8">\n' + (f.content or "")).encode("utf-8")
    if f.kind == "sheet":
        return stem + ".csv", ("\ufeff" + _sheet_to_csv(f.content)).encode("utf-8")
    if f.kind in ("pdf", "docx", "image", "binary"):
        try: return name, base64.b64decode(f.content or "")
        except Exception: pass
    return name, (f.content or "").encode("utf-8")

@app.get("/api/export")
@login_required
def export_all():
    buf, seen = io.BytesIO(), {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in File.query.filter_by(owner_id=current_user.id).order_by(File.id):
            name, data = _export_one(f)
            if name in seen:
                seen[name] += 1
                stem, dot, ext = name.rpartition(".")
                name = f"{stem} ({seen[name]}).{ext}" if dot else f"{name} ({seen[name]})"
            else:
                seen[name] = 0
            z.writestr(name, data)
    buf.seek(0); log("export_all")
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"{current_user.username}-files.zip")

def own_file_or_404(fid):
    f = db.session.get(File, fid) or abort(404)
    if f.owner_id != current_user.id and not (f.shared and request.method == "GET") \
            and not current_user.is_admin:
        abort(403)
    return f

@app.get("/api/files")
@login_required
def list_files():
    q = File.query.filter(or_(File.owner_id == current_user.id, File.shared == True))  # noqa
    return jsonify([f.to_dict() for f in q.order_by(File.updated_at.desc())])

@app.post("/api/files")
@login_required
def create_file():
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    if not name: return jsonify(error="Name required"), 400
    f = File(owner_id=current_user.id, name=name[:160], content=d.get("content", ""),
                kind=d.get("kind") if d.get("kind") in VALID_KINDS else kind_for(name))
    db.session.add(f); db.session.commit(); log("file_create", name)
    return jsonify(f.to_dict())

@app.get("/api/files/<int:fid>")
@login_required
def get_file(fid): return jsonify(own_file_or_404(fid).to_dict(with_content=True))

@app.get("/api/files/<int:fid>/raw")
@login_required
def file_raw(fid):
    """Serve a binary file (PDF, Word, image...) as real bytes so the browser can render it."""
    f = own_file_or_404(fid)
    if f.kind not in BINARY_KINDS: abort(415)
    try: data = base64.b64decode(f.content or "", validate=True)
    except ValueError: abort(422)
    mime = sniff_mime(f.kind, data)
    disp = "attachment" if (request.args.get("download") or not mime) else "inline"
    resp = Response(data, mimetype=mime or "application/octet-stream")
    resp.headers["Content-Disposition"] = f"{disp}; filename*=UTF-8''{quote(f.name)}"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp

@app.delete("/api/files/<int:fid>")
@login_required
def delete_file(fid):
    f = own_file_or_404(fid); db.session.delete(f); db.session.commit()
    log("file_delete", f.name)
    return jsonify(ok=True)

@app.post("/api/run")
@login_required
def api_run():
    d = request.get_json(force=True)
    log("run", d.get("lang", ""))
    return jsonify(run_code(d.get("lang"), d.get("code", ""), d.get("stdin", "")))

@app.post("/api/terminal")
@login_required
def terminal():
    """Simulated shell operating on the user's virtual files (flat directory)."""
    parts = (request.get_json(force=True).get("cmd") or "").strip().split(None, 1)
    if not parts: return jsonify(out="")
    cmd, arg = parts[0], (parts[1] if len(parts) > 1 else "")
    mine = lambda n: File.query.filter_by(owner_id=current_user.id, name=n).first()
    out = ""
    if cmd == "help":
        out = "help ls cat <f> touch <f> rm <f> echo <t> whoami date run <f> clear"
    elif cmd == "ls":
        out = "  ".join(f.name for f in File.query.filter_by(owner_id=current_user.id)) or "(empty)"
    elif cmd == "cat":
        f = mine(arg)
        out = (f"cat: {arg}: binary file" if f and f.kind in BINARY_KINDS else f.content) if f else f"cat: {arg}: No such file"
    elif cmd == "touch":
        if arg and not mine(arg):
            db.session.add(File(owner_id=current_user.id, name=arg, kind=kind_for(arg))); db.session.commit()
        elif not arg: out = "touch: missing file name"
    elif cmd == "rm":
        f = mine(arg)
        if f: db.session.delete(f); db.session.commit()
        else: out = f"rm: {arg}: No such file"
    elif cmd == "echo": out = arg
    elif cmd == "whoami": out = current_user.username
    elif cmd == "date": out = datetime.now().strftime("%a %b %d %H:%M:%S %Y")
    elif cmd == "run":
        f = mine(arg)
        ext = arg.rsplit(".", 1)[-1] if "." in arg else ""
        lang = {"py": "python", "c": "c", "cpp": "cpp", "java": "java"}.get(ext)
        out = (run_code(lang, f.content)["output"] if f and lang else "run: unsupported or missing file")
    else: out = f"{cmd}: command not found (try 'help')"
    return jsonify(out=out)


# ---------- admin API ----------
@app.get("/api/admin/users")
@admin_required
def a_users(): return jsonify([u.to_dict() for u in User.query.order_by(User.id)])

@app.post("/api/admin/users")
@admin_required
def a_user_add():
    d = request.get_json(force=True)
    if not d.get("username") or not d.get("password"): return jsonify(error="username and password required"), 400
    if User.query.filter_by(username=d["username"]).first(): return jsonify(error="Username taken"), 409
    u = User(username=d["username"], full_name=d.get("full_name", ""),
             role=d.get("role", "student") if d.get("role") in ("admin", "student") else "student")
    u.set_password(d["password"]); db.session.add(u); db.session.commit()
    log("user_add", u.username)
    return jsonify(u.to_dict())


@admin_required
def a_user_edit(uid):
    u, d = db.session.get(User, uid) or abort(404), request.get_json(force=True)
    if u.id == current_user.id and (d.get("active") is False or d.get("role") == "student"):
        return jsonify(error="You cannot demote or disable yourself"), 400
    for k in ("full_name", "role", "active"):
        if k in d: setattr(u, k, d[k])
    if d.get("password"): u.set_password(d["password"])
    db.session.commit(); log("user_edit", u.username)
    return jsonify(u.to_dict())

@app.delete("/api/admin/users/<int:uid>")
@admin_required
def a_user_del(uid):
    u = db.session.get(User, uid) or abort(404)
    if u.id == current_user.id: return jsonify(error="You cannot delete yourself"), 400
    db.session.delete(u); db.session.commit(); log("user_delete", u.username)
    return jsonify(ok=True)

@app.get("/api/admin/stats")
@admin_required
def a_stats():
    import random  # resource usage is SIMULATED; swap for psutil in production
    cutoff = datetime.utcnow() - timedelta(minutes=5)
    logs = Log.query.order_by(Log.id.desc()).limit(15).all()
    names = {u.id: u.username for u in User.query}
    return jsonify(
        users=User.query.count(), files=File.query.count(),
        active_sessions=User.query.filter(User.last_seen > cutoff).count(),
        cpu=random.randint(8, 45), memory=random.randint(30, 70), disk=random.randint(20, 40),
        logs=[dict(ts=l.ts.strftime("%H:%M:%S"), user=names.get(l.user_id, "-"),
                   action=l.action, detail=l.detail) for l in logs])

@app.get("/api/admin/files")
@admin_required
def a_files(): return jsonify([f.to_dict() for f in File.query.order_by(File.updated_at.desc())])

@app.post("/api/admin/files/<int:fid>/share")
@admin_required
def a_file_share(fid):
    f = db.session.get(File, fid) or abort(404)
    f.shared = not f.shared; db.session.commit()
    return jsonify(f.to_dict())

@app.post("/api/admin/assignments")
@admin_required
def a_assign():
    """Publish a lab exercise: a shared file every student can open (read-only for them)."""
    d = request.get_json(force=True)
    f = File(owner_id=current_user.id, name=d["name"], content=d.get("content", ""),
             kind=kind_for(d["name"]), shared=True)
    db.session.add(f); db.session.commit(); log("assignment", f.name)
    return jsonify(f.to_dict())

@app.get("/api/admin/announcements")
@admin_required
def a_ann(): return jsonify([dict(id=a.id, message=a.message) for a in Announcement.query.order_by(Announcement.id.desc())])

@app.post("/api/admin/announcements")
@admin_required
def a_ann_add():
    db.session.add(Announcement(message=request.get_json(force=True)["message"][:500])); db.session.commit()
    return jsonify(ok=True)

@app.delete("/api/admin/announcements/<int:aid>")
@admin_required
def a_ann_del(aid):
    a = db.session.get(Announcement, aid) or abort(404); db.session.delete(a); db.session.commit()
    return jsonify(ok=True)


# ---------- CLI ----------
@app.cli.command("init-db")
def init_db():
    """Create tables and seed demo accounts."""
    db.create_all()
    for name, pw, role in (("admin", "admin123", "admin"), ("student", "student123", "student")):
        if not User.query.filter_by(username=name).first():
            u = User(username=name, full_name=name.title(), role=role); u.set_password(pw)
            db.session.add(u)
    db.session.commit()
    print("Database ready. Accounts: admin/admin123, student/student123 (change these!)")

if __name__ == "__main__":
    with app.app_context(): db.create_all()
    app.run(debug=True)
