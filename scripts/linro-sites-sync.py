#!/usr/bin/env python3
"""Prepare LINRO web source in an already-opened existing Sites checkout. No deploy/API/DB writes."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
PROJECT = "appgprj_6a589c9a8e588191830cce459783c685"
ROOTS = ("app/", "lib/", "db/", "drizzle/", "build/", "worker/", "scripts/", "tests/", "assets/brand/", "public/")
CONFIG = {".gitignore", ".npmrc", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs", "drizzle.config.ts", ".openai/hosting.json"}
def tracked(root):
    return [p for p in subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0") if p]
def select(paths):
    return sorted(p for p in paths if (p.startswith(ROOTS) or p in CONFIG) and not p.lower().endswith((".apk", ".aab")) and not p.startswith("public/downloads/"))
def digest(root, paths):
    h = hashlib.sha256()
    for p in paths:
        f = root / p
        if f.is_symlink() or not f.is_file(): raise RuntimeError("Missing or symlink source: " + p)
        h.update(p.encode() + b"\0" + hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()
def tree(root, prefix):
    return {str(p.relative_to(root)): p.read_bytes() for p in (root/prefix).rglob("*") if p.is_file()}
parser=argparse.ArgumentParser()
parser.add_argument("mode", choices=["inspect", "sync", "verify"])
parser.add_argument("github")
parser.add_argument("sites")
a=parser.parse_args(); src=Path(a.github).resolve(); dst=Path(a.sites).resolve()
for root in (src, dst):
    top=subprocess.check_output(["git","rev-parse","--show-toplevel"],cwd=root,text=True).strip()
    if Path(top).resolve()!=root: raise RuntimeError("Must use a repository root")
    m=json.loads((root/".openai/hosting.json").read_text())
    if m.get("project_id") != PROJECT: raise RuntimeError("Wrong existing Sites project")
if json.loads((src/".openai/hosting.json").read_text()) != json.loads((dst/".openai/hosting.json").read_text()):
    raise RuntimeError("Hosting/binding change requires owner review")
for p in ("db", "drizzle"):
    if tree(src,p) != tree(dst,p): raise RuntimeError("DB/schema/migration change requires owner review: "+p)
files=select(tracked(src)); fingerprint=digest(src,files)
sha=subprocess.check_output(["git","rev-parse","HEAD"],cwd=src,text=True).strip()
metadata={"repository":"pashkite/phone-remote","branch":"main","github_sha":sha,"web_source_sha256":fingerprint,"excluded":["Android APK/AAB","public/downloads updates"],"db_migrations_changed":False}
if a.mode=="sync":
    chosen=set(files)
    for base in ROOTS:
        for p in (dst/base).rglob("*") if (dst/base).exists() else []:
            name=str(p.relative_to(dst))
            if p.is_file() and name not in chosen and not name.startswith("public/downloads/"): p.unlink()
    # Android text/assets are retained as source for existing source-based tests only.
    copy=files+[p for p in tracked(src) if p.startswith("android-client/") and not p.lower().endswith((".apk",".aab"))]
    for name in copy:
        p=src/name
        if p.is_symlink() or not p.is_file(): raise RuntimeError("Unsafe source: "+name)
        (dst/name).parent.mkdir(parents=True,exist_ok=True); shutil.copy2(p,dst/name)
    (dst/".openai/linro-deployment.json").write_text(json.dumps(metadata,indent=2)+"\n")
if a.mode in ("sync","verify"):
    if digest(dst,files)!=fingerprint: raise RuntimeError("Web source differs from selected GitHub commit")
print(json.dumps(metadata))
