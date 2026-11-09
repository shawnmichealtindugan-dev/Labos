"""SQLAlchemy models: Users, Files, System Logs, Announcements."""
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.dialects.mysql import LONGTEXT
import json


db = SQLAlchemy()


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    full_name = db.Column(db.String(120), default="")
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(16), default="student")      # 'admin' | 'student'
    active = db.Column(db.Boolean, default=True)             # disabled accounts cannot log in
    theme = db.Column(db.String(8), default="light")
    prefs = db.Column(db.Text, default="")                   # JSON: accent, wallpaper, idle timeout
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_seen = db.Column(db.DateTime)                       # used for "active sessions"
    files = db.relationship("File", backref="owner", cascade="all, delete-orphan")

    def set_password(self, pw): self.password_hash = generate_password_hash(pw)
    def check_password(self, pw): return check_password_hash(self.password_hash, pw)
    def get_prefs(self):
        try: return json.loads(self.prefs or "{}")
        except Exception: return {}
    @property
    def is_active(self): return self.active                 # Flask-Login hook
    @property
    def is_admin(self): return self.role == "admin"

    def to_dict(self):
        return dict(id=self.id, username=self.username, full_name=self.full_name,
                    role=self.role, active=self.active,
                    last_seen=self.last_seen.isoformat() if self.last_seen else None)


class File(db.Model):
    """A virtual file. kind: doc (HTML) | sheet (JSON grid) | code | text."""
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(160), nullable=False)
    kind = db.Column(db.String(16), default="text")
    content = db.Column(db.Text().with_variant(LONGTEXT, "mysql"), default="")
    shared = db.Column(db.Boolean, default=False)            # True = lab assignment visible to all
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, with_content=False):
        d = dict(id=self.id, name=self.name, kind=self.kind, shared=self.shared,
                 owner=self.owner.username, size=len(self.content or ""),
                 updated_at=self.updated_at.isoformat())
        if with_content: d["content"] = self.content
        return d


class Log(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    action = db.Column(db.String(40))
    detail = db.Column(db.String(255), default="")
    ts = db.Column(db.DateTime, default=datetime.utcnow)


class Announcement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
