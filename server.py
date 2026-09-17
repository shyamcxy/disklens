# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 DiskLens contributors
#!/usr/bin/env python3
"""DiskLens server.

Standard library only -- no install step, no virtualenv, no build. Run it and
open the printed URL.

    python3 server.py [--port 8765] [--no-browser]
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import analysis
import store
from scanner import scan, volume_usage

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
HOME = os.path.expanduser("~")

QUICK_TARGETS = [
    {"label": "Entire Mac", "path": "/", "hint": "Every volume's worth of files, one tree",
     "primary": True},
    {"label": "Home folder", "path": HOME, "hint": "Just your files under ~"},
    {"label": "Applications", "path": "/Applications", "hint": "Installed apps"},
    {"label": "Downloads", "path": os.path.join(HOME, "Downloads"), "hint": "Usually the first win"},
    {"label": "Library", "path": os.path.join(HOME, "Library"), "hint": "Caches, logs, support files"},
    {"label": "Desktop", "path": os.path.join(HOME, "Desktop"), "hint": "Files on the desktop"},
    {"label": "Documents", "path": os.path.join(HOME, "Documents"), "hint": "Documents"},
    {"label": "Movies", "path": os.path.join(HOME, "Movies"), "hint": "Video"},
    {"label": "Pictures", "path": os.path.join(HOME, "Pictures"), "hint": "Photos and libraries"},
]

# What the app scans when you do not choose anything.
DEFAULT_TARGET = "/"


def _docker_raw():
    for p in (os.path.join(HOME, "Library/Containers/com.docker.docker/Data/vms"),
              os.path.join(HOME, ".docker")):
        if os.path.exists(p):
            return p
    return None


def list_targets():
    targets = list(QUICK_TARGETS)
    vols = []
    vdir = "/Volumes"
    if os.path.isdir(vdir):
        try:
            for name in sorted(os.listdir(vdir)):
                if name.startswith("."):
                    continue
                p = os.path.join(vdir, name)
                if os.path.isdir(p):
                    vols.append({"label": name, "path": p, "hint": "External or network volume"})
        except OSError:
            pass
    return {"targets": targets, "volumes": vols}


def browse(path: str):
    """Directory listing for the folder picker."""
    p = store.normalize(path)
    if not os.path.isdir(p):
        p = HOME
    dirs = []
    try:
        with os.scandir(p) as it:
            for e in it:
                if e.name.startswith("."):
                    continue
                try:
                    if e.is_dir(follow_symlinks=False):
                        dirs.append({"name": e.name, "path": e.path})
                except OSError:
                    continue
    except OSError as exc:
        return {"error": str(exc), "path": p, "dirs": [], "parent": os.path.dirname(p)}
    dirs.sort(key=lambda d: d["name"].lower())
    parent = os.path.dirname(p)
    return {
        "path": p,
        "parent": parent if p != "/" else None,
        "dirs": dirs,
        "home": HOME,
        "usage": volume_usage(p),
    }


def jsonify(obj):
    return json.dumps(obj, default=str, separators=(",", ":")).encode("utf-8")


def _float(q, key, default, lo=None, hi=None):
    try:
        v = float(q.get(key, [str(default)])[0])
    except (TypeError, ValueError):
        return default
    if lo is not None and v < lo:
        return lo
    if hi is not None and v > hi:
        return hi
    return v


def cached_view(rec, key, fn):
    """Compute a derived view once per scan, sharing the result.

    The first caller computes; anyone else asking for the same key waits for
    that result instead of starting the same multi-second walk again. Keys are
    independent, so a slow one does not block a fast one.
    """
    while True:
        with rec.cache_lock:
            if key in rec.cache:
                return rec.cache[key]
            ev = rec.inflight.get(key)
            if ev is None:
                ev = threading.Event()
                rec.inflight[key] = ev
                mine = True
                break
            mine = False
        if not mine:
            ev.wait(180)

    try:
        val = fn()
    except Exception:
        with rec.cache_lock:
            rec.inflight.pop(key, None)
            ev.set()
        raise
    with rec.cache_lock:
        rec.cache[key] = val
        rec.inflight.pop(key, None)
        ev.set()
    return val


def prewarm(rec):
    """Fill the expensive derived views in the background after a scan.

    Quick Wins is a full walk of the tree -- about 12s on a three-million node
    scan. Doing it here means the page is instant when you click it rather than
    showing a spinner for twelve seconds. These are pure functions of a frozen
    tree, so there is nothing to invalidate later.
    """
    tree = rec.tree
    if tree is None:
        return
    for key, fn in (
        ("qw", lambda: analysis.quick_wins(tree)),
        ("age:0", lambda: analysis.age_map(tree, 0, 40)),
        ("un:0", lambda: analysis.big_and_untouched(tree)),
    ):
        try:
            cached_view(rec, key, fn)
        except Exception:
            pass


def _int(q, key, default, lo=None, hi=None):
    """Read an integer query param without turning a bad value into a 500."""
    try:
        v = int(q.get(key, [str(default)])[0])
    except (TypeError, ValueError):
        return default
    if lo is not None and v < lo:
        return lo
    if hi is not None and v > hi:
        return hi
    return v


LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"}


class Handler(BaseHTTPRequestHandler):
    server_version = "DiskLens/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("DISKLENS_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- origin checks ----------------------------------------------------
    #
    # A server on localhost is reachable by any web page the user visits, so
    # the origin has to be checked explicitly. Two attacks matter:
    #
    #  * DNS rebinding. An attacker points evil.example at 127.0.0.1 and lures
    #    the user to evil.example:PORT. The browser then treats evil.example
    #    and this server as the same origin, so no CORS check applies at all
    #    and their script can drive the full API -- including moving arbitrary
    #    files to the Trash. The Host header is the tell: a rebinding request
    #    arrives addressed to evil.example, not to a loopback name.
    #
    #  * Cross-origin fetches. JSON bodies force a preflight, which this server
    #    does not answer, so those fail on their own. Checking Origin as well
    #    covers anything that would otherwise slip through as a "simple"
    #    request.

    @staticmethod
    def _hostname_of(value: str) -> str:
        value = (value or "").strip().lower()
        if value.startswith("["):            # [::1]:8765
            return value.split("]")[0] + "]"
        return value.rsplit(":", 1)[0] if ":" in value else value

    def _origin_ok(self) -> bool:
        host = self.headers.get("Host")
        if not host:
            return False
        if self._hostname_of(host) not in LOOPBACK_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin:
            # Origin is scheme://host[:port]; only our own host may drive us.
            stripped = origin.split("://", 1)[-1]
            if self._hostname_of(stripped) not in LOOPBACK_HOSTS:
                return False
        return True

    # -- helpers ----------------------------------------------------------

    def send_json(self, obj, status=200):
        body = jsonify(obj)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def reject_foreign_origin(self):
        """403 unless the request is addressed to loopback by a loopback page."""
        if self._origin_ok():
            return False
        self.send_error_json(
            "DiskLens only answers requests addressed to localhost.", 403)
        return True

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

    def serve_file(self, rel):
        path = os.path.normpath(os.path.join(WEB_DIR, rel.lstrip("/")))
        if not path.startswith(WEB_DIR) or not os.path.isfile(path):
            self.send_error_json("Not found", 404)
            return
        ctype, _ = mimetypes.guess_type(path)
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(path, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -- routing ----------------------------------------------------------

    def do_GET(self):
        if self.reject_foreign_origin():
            return
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        q = urllib.parse.parse_qs(parsed.query)

        try:
            if route in ("/", "/index.html"):
                return self.serve_file("landing.html")
            if route in ("/app", "/app/"):
                return self.serve_file("index.html")
            if route == "/api/targets":
                return self.send_json(list_targets())
            if route == "/api/scans":
                return self.send_json({"scans": store.REGISTRY.saved_meta()})
            if route == "/api/browse":
                return self.send_json(browse(q.get("path", [HOME])[0]))
            if route == "/api/volumes":
                return self.send_json(volume_usage(q.get("path", ["/"])[0]))
            if route == "/api/apps":
                return self.send_json(analysis.installed_apps())
            if route == "/api/cleanup":
                return self.send_json(store.CLEANUP.list())
            if route == "/api/trash":
                return self.send_json(store.trash_info())
            if route == "/api/snapshots":
                return self.send_json({"snapshots": store.SNAPSHOTS.list()})
            # /api/snapshots/<a>/compare/<b> -- the path ends with the second
            # id, not with the literal "compare".
            if route.startswith("/api/snapshots/") and "/compare/" in route:
                parts = [p for p in route.split("/") if p]
                if len(parts) < 5:
                    return self.send_error_json("Expected two snapshot ids", 400)
                body = store.SNAPSHOTS.compare(parts[2], parts[4])
                if body is None:
                    return self.send_error_json("Snapshot not found", 404)
                return self.send_json(body)
            if route.startswith("/api/scan/"):
                return self.scan_route(route, q)
            if route in ("/themes", "/themes/"):
                return self.serve_file("themes.html")
            if route.startswith("/static/"):
                return self.serve_file(route[len("/static/"):])
            return self.send_error_json("Not found", 404)
        except BrokenPipeError:
            return
        except Exception:
            traceback.print_exc()
            try:
                self.send_error_json("Internal error", 500)
            except Exception:
                pass

    def do_POST(self):
        if self.reject_foreign_origin():
            return
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path
        body = self.read_body()
        try:
            if route == "/api/scan":
                return self.start_scan(body)
            if route == "/api/scans/open":
                sid = body.get("id", "")
                rec = store.REGISTRY.reopen(sid)
                if rec is None:
                    return self.send_error_json("No such saved scan.", 404)
                if rec.tree is None:
                    return self.send_json({"id": rec.id, "path": rec.path,
                                           "status": rec.status, "error": rec.error})
                # Reopening is where the derived views are cold again.
                threading.Thread(target=prewarm, args=(rec,), daemon=True,
                                 name=f"warm-{rec.id}").start()
                return self.send_json({
                    "id": rec.id, "path": rec.path, "status": rec.status,
                    "nodes": len(rec.tree), "total": rec.tree.disk[0],
                    "files": rec.tree.count[0], "errors": rec.tree.errors,
                    "elapsed": round((rec.finished or 0) - rec.started, 2),
                })
            if route == "/api/scans/delete":
                store.REGISTRY.drop(body.get("id", ""))
                return self.send_json({"scans": store.REGISTRY.saved_meta()})
            if route == "/api/scan/cancel":
                rec = store.REGISTRY.get(body.get("id", ""))
                if rec:
                    rec.cancel_flag.set()
                    rec.push("status", status="cancelled")
                return self.send_json({"ok": bool(rec)})
            if route == "/api/reveal":
                return self.send_json(self.reveal(body))
            if route == "/api/open":
                return self.send_json(self.open_path(body))
            if route == "/api/cleanup/stage":
                out = []
                for item in body.get("items", []):
                    out.append(store.CLEANUP.stage(
                        item.get("path", ""),
                        item.get("size", 0),
                        item.get("label", ""),
                        item.get("source", "manual"),
                    ))
                return self.send_json({"results": out, "queue": store.CLEANUP.list()})
            if route == "/api/cleanup/unstage":
                return self.send_json({
                    "result": store.CLEANUP.unstage(body.get("path", "")),
                    "queue": store.CLEANUP.list(),
                })
            if route == "/api/cleanup/clear":
                store.CLEANUP.clear()
                return self.send_json({"queue": store.CLEANUP.list()})
            if route == "/api/theme-choice":
                choice = {"theme": body.get("theme", ""), "at": time.time()}
                try:
                    os.makedirs(store.DATA_DIR, exist_ok=True)
                    with open(os.path.join(store.DATA_DIR, "theme-choice.json"), "w",
                              encoding="utf-8") as fh:
                        json.dump(choice, fh)
                except OSError:
                    pass
                return self.send_json({"ok": True, "choice": choice})
            if route == "/api/trash/open":
                try:
                    subprocess.run(["open", store.trash_dir()], check=True, timeout=10)
                    return self.send_json({"ok": True})
                except Exception as exc:
                    return self.send_json({"ok": False, "error": str(exc)})
            if route == "/api/trash/empty":
                result = store.empty_trash()
                result["trash"] = store.trash_info()
                return self.send_json(result)
            if route == "/api/cleanup/run":
                result = store.CLEANUP.run(
                    use_trash=body.get("useTrash", True),
                    only=body.get("only"),
                )
                result["queue"] = store.CLEANUP.list()
                result["trash"] = store.trash_info()
                result["usage"] = volume_usage(HOME)
                return self.send_json(result)
            if route == "/api/snapshots":
                rec = store.REGISTRY.get(body.get("scanId", ""))
                if not rec or rec.tree is None:
                    return self.send_error_json("Scan not ready", 409)
                meta = store.SNAPSHOTS.add(rec.tree, body.get("name", ""))
                return self.send_json({"snapshot": meta, "snapshots": store.SNAPSHOTS.list()})
            if route == "/api/snapshots/delete":
                return self.send_json(store.SNAPSHOTS.delete(body.get("id", "")))
            return self.send_error_json("Not found", 404)
        except BrokenPipeError:
            return
        except Exception:
            traceback.print_exc()
            try:
                self.send_error_json("Internal error", 500)
            except Exception:
                pass

    def do_DELETE(self):
        return self.send_error_json("Not found", 404)

    # -- scan endpoints ---------------------------------------------------

    def start_scan(self, body):
        path = body.get("path") or HOME
        path = store.normalize(path)
        if not os.path.exists(path):
            return self.send_error_json(f"No such path: {path}", 400)
        options = {
            "minSize": int(body.get("minSize", 0)),
            "maxDepth": body.get("maxDepth"),
            "crossFilesystem": bool(body.get("crossFilesystem", False)),
            "exclude": body.get("exclude", []),
        }
        rec = store.REGISTRY.create(path, options)
        t = threading.Thread(target=self._run_scan, args=(rec,), daemon=True, name=f"scan-{rec.id}")
        t.start()
        return self.send_json({"id": rec.id, "path": path})

    def _run_scan(self, rec):
        rec.status = "scanning"
        rec.push("status", status="scanning", path=rec.path)
        started = time.time()

        def on_progress(files, nbytes, current, nodes):
            rec.progress = {
                "files": files,
                "bytes": nbytes,
                "nodes": nodes,
                "current": current,
                "elapsed": round(time.time() - started, 2),
            }
            rec.push("progress", **rec.progress)

        try:
            tree = scan(
                rec.path,
                on_progress=on_progress,
                should_cancel=rec.cancel_flag.is_set,
                cross_filesystem=rec.options["crossFilesystem"],
                max_depth=rec.options.get("maxDepth"),
                exclude=set(rec.options.get("exclude") or []),
                min_size=rec.options.get("minSize", 0),
            )
            rec.tree = tree
            rec.status = "cancelled" if tree.cancelled else "ready"
            rec.finished = time.time()
            # Write the tree out before announcing readiness, so a reload or a
            # restart can always get the scan back without walking the disk.
            store.REGISTRY.flush(rec)
            if rec.status == "ready":
                threading.Thread(target=prewarm, args=(rec,), daemon=True,
                                 name=f"warm-{rec.id}").start()
            rec.push("status", status=rec.status, elapsed=round(tree.finished - tree.started, 2),
                     nodes=len(tree), errors=tree.errors, skipped=tree.skipped,
                     saved=rec.saved, total=tree.disk[0], files=tree.count[0],
                     usage=volume_usage(rec.path))
        except Exception as exc:
            rec.status = "error"
            rec.error = str(exc)
            rec.detail = traceback.format_exc()
            rec.finished = time.time()
            rec.push("status", status="error", error=str(exc),
                     kind=type(exc).__name__)
        finally:
            rec.done.set()

    def scan_route(self, route, q):
        parts = [p for p in route.split("/") if p]
        # /api/scan/<id>/<action>
        if len(parts) < 3:
            return self.send_error_json("Not found", 404)
        sid, action = parts[2], parts[3] if len(parts) > 3 else "state"
        rec = store.REGISTRY.get(sid)
        if rec is None:
            # Not in memory, but it may well be on disk. Pulling it back costs
            # a file read instead of a full re-walk of the filesystem.
            rec = store.REGISTRY.reopen(sid)
        if rec is None:
            return self.send_error_json(
                "That scan is no longer available. Start a new one.", 404)

        if action == "events":
            return self.stream_events(rec)
        if action == "state":
            return self.send_json({
                "id": rec.id, "path": rec.path, "status": rec.status,
                "error": rec.error, "detail": rec.detail,
                "progress": rec.progress, "options": rec.options,
                "saved": rec.saved,
                "nodes": len(rec.tree) if rec.tree is not None else 0,
                "usage": volume_usage(rec.path) if rec.status == "ready" else None,
                "elapsed": round((rec.finished or time.time()) - rec.started, 2),
            })

        if rec.tree is None:
            return self.send_error_json("Scan not ready", 409)
        tree = rec.tree

        node = _int(q, "node", 0)
        if node < 0 or node >= len(tree):
            node = 0

        if action == "tree":
            depth = _int(q, "depth", 3, 0, 8)
            max_children = _int(q, "maxChildren", 48, 1, 400)
            min_frac = max(0.0, min(0.5, _float(q, "minFrac", 0.0)))
            max_nodes = _int(q, "maxNodes", 12000, 1, 60000)
            return self.send_json(
                tree.to_dict(node, depth, max_children, min_frac, max_nodes=max_nodes)
            )

        if action == "children":
            kids = tree.children(node)
            kids.sort(key=lambda k: tree.disk[k], reverse=True)
            kids = [k for k in kids if k >= 0]
            return self.send_json({
                "node": node,
                "children": [
                    {"i": k, "n": tree.names[k], "p": tree.path_of(k), "d": tree.disk[k],
                     "s": tree.size[k], "t": tree.mtime[k], "b": tree.btime[k],
                     "f": tree.flags[k], "dir": tree.is_dir(k), "c": tree.count[k],
                     "dc": tree.dircount[k]}
                    for k in kids
                ],
            })

        if action == "node":
            idx = _int(q, "i", node)
            if idx < 0 or idx >= len(tree):
                return self.send_error_json("No such node", 404)
            return self.send_json(self.inspect(tree, idx))

        if action == "age":
            return self.send_json(self.cached(rec, f"age:{node}", lambda: analysis.age_map(tree, node, _int(q, "buckets", 40, 4, 200))))

        if action == "untouched":
            return self.send_json(self.cached(rec, f"un:{node}", lambda: analysis.big_and_untouched(
                tree, node,
                min_bytes=_int(q, "minBytes", 100 << 20, 0),
                min_age_days=_int(q, "minDays", 365, 0),
                limit=_int(q, "limit", 200, 1, 5000),
            )))

        if action == "dupes":
            return self.send_json(self.cached(rec, f"dup:{node}:{q.get('minBytes',['4096'])[0]}",
                lambda: analysis.find_duplicates(tree, node, min_bytes=_int(q, "minBytes", 4096, 0))))

        if action == "accounting":
            return self.send_json(self.cached(rec, "acct", lambda: analysis.disk_accounting(tree, tree.root_path)))

        if action == "quickwins":
            return self.send_json(self.cached(rec, "qw", lambda: analysis.quick_wins(tree)))

        if action == "top":
            return self.send_json(analysis.top_files(
                tree, node,
                limit=_int(q, "n", 200, 1, 5000),
                dirs=q.get("dirs", ["0"])[0] == "1",
            ))

        return self.send_error_json("Unknown action", 404)

    def cached(self, rec, key, fn):
        return cached_view(rec, key, fn)

    def inspect(self, tree, idx):
        parent = tree.parent[idx]
        parent_disk = tree.disk[parent] if parent >= 0 else tree.disk[idx]
        logical = tree.size[idx]
        physical = tree.disk[idx]
        return {
            "i": idx,
            "n": tree.names[idx] if idx else tree.root_path,
            "p": tree.path_of(idx),
            "dir": tree.is_dir(idx),
            "disk": physical,
            "logical": logical,
            "saved": max(0, logical - physical),
            "compressed": logical > physical and physical > 0,
            "files": tree.count[idx],
            "dirs": tree.dircount[idx],
            "pct_parent": round(physical / parent_disk * 100, 2) if parent_disk else 0.0,
            "pct_total": round(physical / (tree.disk[0] or 1) * 100, 2),
            "modified": tree.mtime[idx],
            "created": tree.btime[idx],
            "flags": tree.flags[idx],
            "hidden": bool(tree.flags[idx] & tree.FLAG_HIDDEN),
            "largest": analysis.largest_inside(tree, idx, 12) if tree.is_dir(idx) else [],
        }

    def stream_events(self, rec):
        """Server-sent events for scan progress."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            deadline = time.time() + 3600
            while time.time() < deadline:
                for evt in rec.drain():
                    payload = jsonify(evt)
                    self.wfile.write(b"data: " + payload + b"\n\n")
                self.wfile.flush()
                if rec.done.is_set() and not rec.events:
                    self.wfile.write(b"data: " + jsonify({"kind": "end"}) + b"\n\n")
                    self.wfile.flush()
                    return
                time.sleep(0.12)
        except (BrokenPipeError, ConnectionResetError):
            return

    # -- shell out --------------------------------------------------------

    def reveal(self, body):
        path = store.normalize(body.get("path", ""))
        if not os.path.exists(path):
            return {"ok": False, "error": "Path no longer exists."}
        try:
            subprocess.run(["open", "-R", path], check=True, timeout=10)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def open_path(self, body):
        path = store.normalize(body.get("path", ""))
        if not os.path.exists(path):
            return {"ok": False, "error": "Path no longer exists."}
        try:
            if body.get("quicklook"):
                subprocess.Popen(["qlmanage", "-p", path],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.run(["open", path], check=True, timeout=10)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


def main():
    ap = argparse.ArgumentParser(description="DiskLens")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    url = f"http://{args.host}:{args.port}/"
    print(f"\n  DiskLens running at {url}")
    print(f"  App:     {url}app")
    print(f"  Stop:    Ctrl-C\n")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
