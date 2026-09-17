# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 DiskLens contributors
"""Scan registry, staged cleanup queue and snapshots.

The cleanup queue is the safety mechanism the whole app hangs on: nothing is
ever removed without first being staged, reviewed and then explicitly run.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SCAN_DIR = os.path.join(DATA_DIR, "scans")
CLEANUP_FILE = os.path.join(DATA_DIR, "cleanup.json")
SNAP_FILE = os.path.join(DATA_DIR, "snapshots.json")

HOME = os.path.expanduser("~")

# Paths that may never be staged. These are the ones where "oops" is not
# recoverable: removing any of them takes the machine or the account with it.
PROTECTED_EXACT = {
    "/", "/System", "/Library", "/Applications", "/Users", "/usr", "/bin",
    "/sbin", "/private", "/opt", "/var", "/tmp", "/etc", "/cores", "/dev",
    HOME,
    os.path.join(HOME, "Library"),
    os.path.join(HOME, "Library", "Caches"),
    os.path.join(HOME, "Library", "Preferences"),
    os.path.join(HOME, "Library", "Application Support"),
    os.path.join(HOME, "Library", "Logs"),
    os.path.join(HOME, "Desktop"),
    os.path.join(HOME, "Documents"),
    os.path.join(HOME, "Downloads"),
    os.path.join(HOME, ".Trash"),
    "/System/Applications",
    "/System/Library",
}

# Anything under these prefixes is never staged, even if a specific file looks
# harmless in isolation.
PROTECTED_PREFIXES = (
    "/System/",
    "/private/var/db/",
    "/private/var/vm/",
    "/usr/lib/",
    "/usr/bin/",
    "/bin/",
    "/sbin/",
    "/Library/Extensions/",
    "/Library/LaunchDaemons/",
    "/Library/LaunchAgents/",
    os.path.join(HOME, "Library", "Keychains"),
    os.path.join(HOME, "Library", "Mail"),
    os.path.join(HOME, "Library", "Messages"),
    os.path.join(HOME, "Library", "Safari"),
    os.path.join(HOME, "Library", "Mobile Documents"),
    os.path.join(HOME, ".ssh"),
    os.path.join(HOME, ".gnupg"),
)


def normalize(path: str) -> str:
    return os.path.normpath(os.path.abspath(os.path.expanduser(path)))


def protection_reason(path: str) -> str | None:
    """Why `path` may not be removed, or None if it is fair game."""
    p = normalize(path)
    if p in PROTECTED_EXACT:
        return "This is a system or home folder that must not be removed."
    for prefix in PROTECTED_PREFIXES:
        if p.startswith(prefix):
            return f"Inside a protected location ({prefix.rstrip('/')})."
    if p.count("/") < 2:
        return "Top-level path."
    return None


class ScanRecord:
    def __init__(self, scan_id: str, path: str, options: dict):
        self.id = scan_id
        self.path = path
        self.options = options
        self.tree = None
        self.status = "queued"          # queued | scanning | ready | error | cancelled
        self.error: str | None = None
        self.detail: str | None = None      # full traceback, when there is one
        self.progress = {"files": 0, "bytes": 0, "nodes": 0, "current": "", "elapsed": 0.0}
        self.started = time.time()
        self.finished: float | None = None
        self.last_access = time.time()
        self.saved = False                  # tree flushed to disk
        self.cache: dict = {}
        self.cache_lock = threading.Lock()
        self.inflight: dict[str, threading.Event] = {}
        self.events: list[dict] = []
        self.event_lock = threading.Lock()
        self.done = threading.Event()
        self.cancel_flag = threading.Event()

    def push(self, kind: str, **payload):
        evt = {"kind": kind, "t": time.time(), **payload}
        with self.event_lock:
            self.events.append(evt)
        return evt

    def drain(self) -> list[dict]:
        with self.event_lock:
            out = self.events[:]
            self.events.clear()
        return out


class Registry:
    """Scans held in memory, backed by a copy on disk.

    A FileTree for a home folder runs to hundreds of megabytes, so only a few
    stay resident. The rest are written out and can be pulled back in without
    re-walking the filesystem -- which is the whole point: a scan you already
    paid for should never have to happen twice.
    """

    MAX_SCANS = 5
    MAX_SAVED = 12
    MAX_SAVED_BYTES = 3 << 30
    # Resident trees are big: a whole-Mac scan of three million nodes measures
    # about 645 MB. Capping by count alone would let five of those reach 3 GB,
    # so the cap is on estimated bytes. Evicting is nearly free because the
    # tree is already on disk -- reloading the whole-Mac scan takes 0.6s.
    MAX_RESIDENT_BYTES = 1400 << 20
    BYTES_PER_NODE = 216

    def __init__(self, scan_dir: str = SCAN_DIR):
        self.lock = threading.Lock()
        self.scans: dict[str, ScanRecord] = {}
        self.scan_dir = scan_dir
        os.makedirs(scan_dir, exist_ok=True)

    # -- memory ---------------------------------------------------------

    def create(self, path: str, options: dict) -> ScanRecord:
        sid = uuid.uuid4().hex[:12]
        rec = ScanRecord(sid, path, options)
        with self.lock:
            self.scans[sid] = rec
        self._evict()
        return rec

    def get(self, sid: str, touch: bool = True) -> ScanRecord | None:
        with self.lock:
            rec = self.scans.get(sid)
            if rec is not None and touch:
                rec.last_access = time.time()
            return rec

    @staticmethod
    def _tree_bytes(rec) -> int:
        return len(rec.tree) * Registry.BYTES_PER_NODE if rec.tree is not None else 0

    def _evict(self):
        """Drop least-recently-used trees, but never one still being written.

        Bounded by resident bytes as well as count, and the most recently used
        tree is never dropped, so the scan you are looking at cannot evict
        itself.
        """
        with self.lock:
            live = [r for r in self.scans.values() if r.status in ("queued", "scanning")]
            # Newest-used first; the last entry is the safest to drop.
            others = sorted(self.scans.values(), key=lambda r: r.last_access, reverse=True)
            resident = [r for r in others if r.tree is not None]
            total = sum(self._tree_bytes(r) for r in resident)
            count = len(self.scans)

            for victim in reversed(others):
                over_count = count > self.MAX_SCANS
                over_bytes = total > self.MAX_RESIDENT_BYTES
                if not (over_count or over_bytes):
                    break
                if victim in live or victim.tree is None:
                    continue
                if victim is others[0]:
                    continue  # never evict what was just asked for
                # Anything worth keeping has already been flushed to disk, so
                # dropping the in-memory tree only costs a reload.
                if not victim.saved:
                    try:
                        save_tree(victim.tree, victim.id, victim.path,
                                  victim.finished or victim.started)
                        victim.saved = True
                    except OSError:
                        pass
                total -= self._tree_bytes(victim)
                count -= 1
                victim.tree = None
                victim.cache.clear()

    def drop(self, sid: str):
        with self.lock:
            self.scans.pop(sid, None)
        for suffix in (".bin", ".json"):
            try:
                os.remove(os.path.join(self.scan_dir, sid + suffix))
            except OSError:
                pass

    # -- disk -----------------------------------------------------------

    def meta_path(self, sid: str) -> str:
        return os.path.join(self.scan_dir, sid + ".json")

    def bin_path(self, sid: str) -> str:
        return os.path.join(self.scan_dir, sid + ".bin")

    def saved_meta(self) -> list[dict]:
        """Every scan on disk, newest first, with in-memory status merged in."""
        out = []
        try:
            names = os.listdir(self.scan_dir)
        except OSError:
            return out
        with self.lock:
            resident = {sid: r for sid, r in self.scans.items()}
        for name in names:
            if not name.endswith(".json"):
                continue
            sid = name[:-5]
            try:
                with open(os.path.join(self.scan_dir, name), "r", encoding="utf-8") as fh:
                    meta = json.load(fh)
            except (OSError, ValueError):
                continue
            rec = resident.get(sid)
            # Every entry carries the same shape whether it is in memory or
            # only on disk, so the client never has to special-case it.
            meta.setdefault("error", None)
            meta.setdefault("progress", None)
            if rec is not None:
                meta["resident"] = rec.tree is not None
                meta["status"] = rec.status
                meta["error"] = rec.error
                meta["progress"] = rec.progress
            else:
                meta["resident"] = False
                meta["status"] = "ready"   # loadable on demand
            out.append(meta)
        # Include live scans that have not been flushed yet.
        known = {m["id"] for m in out}
        for sid, rec in resident.items():
            if sid in known:
                continue
            out.append({
                "id": sid, "path": rec.path, "status": rec.status,
                "started": rec.started, "finished": rec.finished,
                "nodes": len(rec.tree) if rec.tree is not None else 0,
                "total": rec.tree.disk[0] if rec.tree is not None else 0,
                "files": rec.tree.count[0] if rec.tree is not None else 0,
                "error": rec.error, "progress": rec.progress,
                "saved": False, "resident": rec.tree is not None,
            })
        out.sort(key=lambda m: m.get("started") or 0, reverse=True)
        return out

    def reopen(self, sid: str) -> ScanRecord | None:
        """Return a usable record for `sid`, loading the tree from disk if needed."""
        rec = self.get(sid)
        if rec is not None and rec.tree is not None:
            return rec
        meta_file = self.meta_path(sid)
        if not os.path.exists(meta_file):
            return None
        try:
            with open(meta_file, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
        except (OSError, ValueError):
            return None

        if rec is None:
            rec = ScanRecord(sid, meta.get("path", ""), meta.get("options", {}))
            rec.started = meta.get("started", time.time())
            rec.finished = meta.get("finished")
            with self.lock:
                self.scans[sid] = rec
        try:
            rec.tree = load_tree(sid)
            rec.status = "ready"
            rec.saved = True
            rec.last_access = time.time()
        except (OSError, ValueError, EOFError) as exc:
            rec.status = "error"
            rec.error = f"Could not reopen the saved scan: {exc}"
            return rec
        self._evict()
        return rec

    def flush(self, rec: ScanRecord):
        if rec.tree is None or rec.saved:
            return
        try:
            save_tree(rec.tree, rec.id, rec.path, rec.finished or rec.started)
            rec.saved = True
        except OSError:
            pass
        self._prune_disk()

    def _prune_disk(self):
        """Keep the saved-scan directory bounded by count and total size."""
        metas = self.saved_meta()
        total = 0
        for m in metas:
            p = self.bin_path(m["id"])
            try:
                total += os.path.getsize(p)
            except OSError:
                pass
        keep = metas[: self.MAX_SAVED]
        for m in metas[self.MAX_SAVED:]:
            self.drop(m["id"])
        while total > self.MAX_SAVED_BYTES and len(keep) > 1:
            victim = keep.pop()
            try:
                total -= os.path.getsize(self.bin_path(victim["id"]))
            except OSError:
                pass
            self.drop(victim["id"])


# --------------------------------------------------------------------------
# On-disk scan format
#
# Layout, gzipped:
#   [4]  meta length (big-endian uint32)
#   [n]  meta JSON: path, saved timestamp, counts, array lengths
#   [8]  names blob length (big-endian uint64)
#   [m]  names blob: newline-joined; a filename can never contain a newline,
#        so this round-trips without escaping
#   ...  the numeric arrays concatenated in a fixed order, raw bytes
#
# The arrays are already flat and fixed-width, so writing them is a memcpy per
# array rather than a per-node serialisation.
# --------------------------------------------------------------------------

ARRAY_ORDER = [
    ("parent", "i"), ("size", "q"), ("disk", "q"), ("mtime", "q"),
    ("btime", "q"), ("flags", "b"), ("first_child", "i"),
    ("next_sibling", "i"), ("count", "q"), ("dircount", "q"),
]


def save_tree(tree, sid: str, path: str, when: float):
    from array import array as _array
    os.makedirs(SCAN_DIR, exist_ok=True)
    final = os.path.join(SCAN_DIR, sid + ".bin")
    tmp = final + ".tmp"

    names_blob = "\n".join(tree.names).encode("utf-8")
    meta = {
        "id": sid, "path": path, "saved": time.time(), "finished": when,
        "nodes": len(tree), "files": tree.count[0] if len(tree) else 0,
        "total": tree.disk[0] if len(tree) else 0,
        "logical": tree.size[0] if len(tree) else 0,
        "errors": tree.errors, "skipped": tree.skipped,
        "blocked_count": getattr(tree, "blocked_count", 0),
        "blocked": list(getattr(tree, "blocked", []) or [])[:4000],
        "root_path": tree.root_path,
    }
    meta_blob = json.dumps(meta, separators=(",", ":")).encode("utf-8")

    import gzip
    with gzip.open(tmp, "wb", compresslevel=1) as fh:
        fh.write(len(meta_blob).to_bytes(4, "big"))
        fh.write(meta_blob)
        fh.write(len(names_blob).to_bytes(8, "big"))
        fh.write(names_blob)
        for attr, _code in ARRAY_ORDER:
            fh.write(getattr(tree, attr).tobytes())
    os.replace(tmp, final)

    meta_file = os.path.join(SCAN_DIR, sid + ".json")
    tmp_meta = meta_file + ".tmp"
    with open(tmp_meta, "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    os.replace(tmp_meta, meta_file)
    return final


def load_tree(sid: str):
    import gzip
    from array import array as _array
    from scanner import FileTree

    final = os.path.join(SCAN_DIR, sid + ".bin")
    with gzip.open(final, "rb") as fh:
        meta_len = int.from_bytes(fh.read(4), "big")
        meta = json.loads(fh.read(meta_len).decode("utf-8"))
        names_len = int.from_bytes(fh.read(8), "big")
        names_blob = fh.read(names_len)
        rest = fh.read()

    tree = FileTree(meta.get("root_path") or meta.get("path") or "")
    tree.names = names_blob.decode("utf-8").split("\n") if names_len else []
    offset = 0
    for attr, code in ARRAY_ORDER:
        count = len(tree.names)
        raw = rest[offset:offset + count * _array(code).itemsize]
        offset += count * _array(code).itemsize
        getattr(tree, attr)[:] = _array(code, raw)
    tree.root_path = meta.get("root_path", tree.root_path)
    tree.files_seen = meta.get("files", 0)
    tree.bytes_seen = meta.get("total", 0)
    tree.errors = meta.get("errors", 0)
    tree.skipped = meta.get("skipped", 0)
    # The blocked list is the whole point of the disk accounting, so it has to
    # survive a save/reload rather than dying with the process.
    tree.blocked = list(meta.get("blocked", []) or [])
    tree.blocked_count = meta.get("blocked_count", len(tree.blocked))
    tree.finished = meta.get("finished", 0.0)
    tree.started = meta.get("finished", 0.0)
    return tree


REGISTRY = Registry()


# --------------------------------------------------------------------------
# Cleanup queue
# --------------------------------------------------------------------------

class CleanupQueue:
    def __init__(self, path: str = CLEANUP_FILE):
        self.path = path
        self.lock = threading.Lock()
        self.items: dict[str, dict] = {}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.load()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            for item in data.get("items", []):
                self.items[item["path"]] = item
        except (OSError, ValueError):
            pass

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"items": list(self.items.values())}, fh, indent=2)
        os.replace(tmp, self.path)

    def stage(self, path: str, size: int = 0, label: str = "", source: str = "manual"):
        p = normalize(path)
        reason = protection_reason(p)
        if reason:
            return {"ok": False, "path": p, "error": reason}
        if not os.path.exists(p) and not os.path.islink(p):
            return {"ok": False, "path": p, "error": "Path no longer exists."}
        with self.lock:
            if p in self.items:
                return {"ok": True, "path": p, "already": True}
            if not size:
                size = _measure(p)
            self.items[p] = {
                "path": p,
                "size": size,
                "label": label or os.path.basename(p),
                "source": source,
                "staged": time.time(),
            }
            self.save()
        return {"ok": True, "path": p}

    def unstage(self, path: str):
        p = normalize(path)
        with self.lock:
            existed = self.items.pop(p, None) is not None
            self.save()
        return {"ok": existed, "path": p}

    def clear(self):
        with self.lock:
            self.items.clear()
            self.save()
        return {"ok": True}

    def list(self):
        with self.lock:
            items = sorted(self.items.values(), key=lambda i: i["size"], reverse=True)
        return {
            "items": items,
            "total": sum(i["size"] for i in items),
            "count": len(items),
        }

    def run(self, use_trash: bool = True, only: list[str] | None = None):
        """Execute the staged queue.

        Defaults to moving items to the Trash rather than unlinking them, so a
        mistake is recoverable from the Finder.
        """
        with self.lock:
            targets = list(self.items.values())
        if only:
            wanted = {normalize(p) for p in only}
            targets = [t for t in targets if t["path"] in wanted]

        results = []
        freed = 0
        for item in targets:
            p = item["path"]
            reason = protection_reason(p)
            if reason:
                results.append({"path": p, "ok": False, "error": reason})
                continue
            if not os.path.exists(p) and not os.path.islink(p):
                results.append({"path": p, "ok": False, "error": "Already gone."})
                with self.lock:
                    self.items.pop(p, None)
                continue
            size = item.get("size") or _measure(p)
            try:
                if use_trash:
                    dest = _unique_trash_path(os.path.basename(p))
                    shutil.move(p, dest)
                else:
                    if os.path.isdir(p) and not os.path.islink(p):
                        shutil.rmtree(p)
                    else:
                        os.remove(p)
                freed += size
                results.append({"path": p, "ok": True, "size": size,
                                "to": dest if use_trash else None})
                with self.lock:
                    self.items.pop(p, None)
            except OSError as exc:
                results.append({"path": p, "ok": False, "error": str(exc)})

        with self.lock:
            self.save()
        return {"results": results, "freed": freed,
                "removed": sum(1 for r in results if r["ok"])}


def _measure(path: str) -> int:
    try:
        if os.path.islink(path) or os.path.isfile(path):
            st = os.stat(path, follow_symlinks=False)
            return getattr(st, "st_blocks", 0) * 512
    except OSError:
        return 0
    total = 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                    else:
                        total += getattr(st, "st_blocks", 0) * 512
        except OSError:
            continue
    return total


def _unique_trash_path(name: str) -> str:
    trash = os.path.join(HOME, ".Trash")
    os.makedirs(trash, exist_ok=True)
    dest = os.path.join(trash, name)
    if not os.path.exists(dest):
        return dest
    stem, ext = os.path.splitext(name)
    i = 2
    while True:
        cand = os.path.join(trash, f"{stem} {i}{ext}")
        if not os.path.exists(cand):
            return cand
        i += 1
        if i > 9999:
            return os.path.join(trash, f"{stem} {uuid.uuid4().hex[:6]}{ext}")


CLEANUP = CleanupQueue()


# --------------------------------------------------------------------------
# Trash
#
# Moving something to the Trash is not the same as freeing space: the blocks
# stay allocated until the Trash is emptied. That distinction is the whole
# reason this exists as a separate step, and macOS may refuse to let a process
# read or clear ~/.Trash without Full Disk Access, so both operations here are
# allowed to fail softly and report why.
# --------------------------------------------------------------------------

def trash_dir() -> str:
    return os.path.join(HOME, ".Trash")


def trash_info(limit: int = 60) -> dict:
    d = trash_dir()
    out = {"path": d, "count": 0, "bytes": 0, "items": [], "readable": True,
           "error": None}
    try:
        names = [n for n in os.listdir(d) if n not in (".DS_Store", ".localized", ".Trash")]
    except OSError as exc:
        out["readable"] = False
        out["error"] = str(exc)
        return out

    items = []
    total = 0
    for name in names:
        p = os.path.join(d, name)
        size = _measure(p)
        total += size
        items.append({"name": name, "path": p, "bytes": size})
    items.sort(key=lambda i: i["bytes"], reverse=True)
    out.update(count=len(items), bytes=total, items=items[:limit])
    return out


def empty_trash() -> dict:
    """Permanently remove everything in the Trash. Not reversible."""
    d = trash_dir()
    removed = 0
    freed = 0
    errors = []
    try:
        names = [n for n in os.listdir(d) if n not in (".DS_Store", ".localized")]
    except OSError as exc:
        return {"ok": False, "removed": 0, "freed": 0, "errors": [],
                "error": f"macOS would not let DiskLens read the Trash ({exc}). "
                         f"Empty it from the Finder instead."}

    for name in names:
        p = os.path.join(d, name)
        size = _measure(p)
        reason = protection_reason(p)
        if reason:
            continue
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.rmtree(p)
            else:
                os.remove(p)
            removed += 1
            freed += size
        except OSError as exc:
            errors.append({"path": p, "error": str(exc)})
    return {"ok": True, "removed": removed, "freed": freed, "errors": errors}


# --------------------------------------------------------------------------
# Snapshots
# --------------------------------------------------------------------------

class Snapshots:
    """Saved scan summaries so today's scan can be compared with an old one."""

    MAX = 40

    def __init__(self, path: str = SNAP_FILE):
        self.path = path
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                self.data = json.load(fh)
        except (OSError, ValueError):
            self.data = []

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, indent=2)
        os.replace(tmp, self.path)

    def add(self, tree, name: str = "", depth: int = 2, max_children: int = 40):
        entries = {}

        def walk(idx, depth_left):
            if depth_left <= 0:
                return
            kids = tree.children(idx)
            kids.sort(key=lambda k: tree.disk[k], reverse=True)
            for k in kids[:max_children]:
                if not tree.is_dir(k):
                    continue
                path = tree.path_of(k)
                entries[path] = {"d": tree.disk[k], "s": tree.size[k], "c": tree.count[k]}
                walk(k, depth_left - 1)

        walk(0, depth)
        snap = {
            "id": uuid.uuid4().hex[:10],
            "name": name or f"Snapshot {time.strftime('%d %b %Y, %H:%M')}",
            "root": tree.root_path,
            "created": time.time(),
            "total": tree.disk[0],
            "files": tree.count[0],
            "entries": entries,
        }
        with self.lock:
            self.data.append(snap)
            self.data = self.data[-self.MAX:]
            self.save()
        return {k: v for k, v in snap.items() if k != "entries"}

    def list(self):
        with self.lock:
            return [{k: v for k, v in s.items() if k != "entries"} for s in self.data]

    def get(self, sid: str):
        with self.lock:
            for s in self.data:
                if s["id"] == sid:
                    return s
        return None

    def delete(self, sid: str):
        with self.lock:
            before = len(self.data)
            self.data = [s for s in self.data if s["id"] != sid]
            self.save()
        return {"ok": len(self.data) < before}

    def compare(self, a_id: str, b_id: str):
        """Directory-level growth from snapshot `a` to snapshot `b`."""
        a = self.get(a_id)
        b = self.get(b_id)
        if not a or not b:
            return None
        rows = []
        for path, bv in b["entries"].items():
            av = a["entries"].get(path)
            old = av["d"] if av else 0
            delta = bv["d"] - old
            if abs(delta) < 1 << 20:
                continue
            rows.append({
                "path": path,
                "name": os.path.basename(path) or path,
                "before": old,
                "after": bv["d"],
                "delta": delta,
                "pct": round(delta / old * 100, 1) if old else None,
            })
        for path, av in a["entries"].items():
            if path not in b["entries"]:
                rows.append({
                    "path": path, "name": os.path.basename(path) or path,
                    "before": av["d"], "after": 0, "delta": -av["d"], "pct": -100.0,
                })
        rows.sort(key=lambda r: abs(r["delta"]), reverse=True)
        return {
            "a": {k: v for k, v in a.items() if k != "entries"},
            "b": {k: v for k, v in b.items() if k != "entries"},
            "total_delta": b["total"] - a["total"],
            "rows": rows[:300],
        }


SNAPSHOTS = Snapshots()
