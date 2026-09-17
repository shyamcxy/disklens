# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 DiskLens contributors
"""Filesystem walker.

Builds a file tree in a flat, array-backed representation so a scan of a few
million files stays in the low hundreds of megabytes instead of several
gigabytes of nested dicts.

The walk runs on a pool of threads. `scandir` and `stat` both release the GIL,
so the cost that dominates a scan -- one stat syscall per entry -- overlaps
across cores. Workers never block on child directories: scanning a directory
enqueues its subdirectories as new work rather than recursing, which is what
keeps a bounded pool from deadlocking on a deep tree.

A node's index is always lower than every index beneath it, because a
directory's entries are appended before its subdirectories are enqueued. That
invariant lets aggregation be a single reverse pass over the arrays.
"""

from __future__ import annotations

import os
import stat as statmod
import threading
import time
from array import array
from collections import deque
from concurrent.futures import ThreadPoolExecutor

# Kernel pseudo-filesystems and caches: they either lie about size or take
# forever to walk, and nothing in them is user data.
SKIP_DIRS = {
    ".Spotlight-V100",
    ".fseventsd",
    ".DocumentRevisions-V100",
    ".TemporaryItems",
    ".vol",
    ".MobileBackups",
}

# Absolute paths never descended into, whatever the scan root.
#
# The important one is /System/Volumes/Data. On macOS the data volume is
# visible twice: once through the firmlinks at the root (/Users, /Applications,
# /Library ...) and again at its real mount point. Both resolve to the *same
# inodes* and report the same st_dev, so the device check cannot catch it --
# scanning "/" without this would count every file in your home folder twice.
#
# The rest are other system volumes; most are separate devices and would be
# skipped anyway, but naming them keeps the intent explicit.
# Expressed relative to the scan root, not absolute. The same directory can be
# reached by several paths -- /Volumes/Macintosh HD is a symlink to "/", and
# /Users is also /System/Volumes/Data/Users -- so an absolute list only protects
# the walk that started at "/" and silently double-counts every other one.
SKIP_RELATIVE = {
    "System/Volumes/Data",
    "System/Volumes/VM",
    "System/Volumes/Preboot",
    "System/Volumes/Update",
    "System/Volumes/Recovery",
    "System/Volumes/xarts",
    "System/Volumes/iSCPreboot",
    "System/Volumes/Hardware",
    "dev",
}

# Retained for callers that still ask about a literal path.
SKIP_PATHS = {"/" + rel for rel in SKIP_RELATIVE}


class FileTree:
    """Flat-array file tree.

    Every node is an index into parallel arrays. `parent`, `first_child` and
    `next_sibling` give the shape; `size`, `disk`, `mtime` and `count` hold the
    data.
    """

    __slots__ = (
        "names", "parent", "size", "disk", "mtime", "btime", "flags",
        "first_child", "next_sibling", "count", "dircount", "root_path",
        "files_seen", "bytes_seen", "errors", "started", "finished",
        "cancelled", "skipped", "workers", "blocked", "blocked_count",
    )

    FLAG_DIR = 1
    FLAG_LINK = 2
    FLAG_HIDDEN = 4
    FLAG_SYSTEM = 8

    def __init__(self, root_path: str):
        self.root_path = root_path
        self.names: list[str] = []
        self.parent = array("i")
        self.size = array("q")
        self.disk = array("q")
        self.mtime = array("q")
        self.btime = array("q")
        self.flags = array("b")
        self.first_child = array("i")
        self.next_sibling = array("i")
        self.count = array("q")
        self.dircount = array("q")
        self.files_seen = 0
        self.bytes_seen = 0
        self.errors = 0
        self.skipped = 0
        self.started = 0.0
        self.finished = 0.0
        self.cancelled = False
        self.workers = 0
        # Directories the OS refused to open. These are the bytes a scan
        # silently misses, and on macOS they include the folders most likely
        # to hold tens of gigabytes (Photos, Mail, Messages, the Trash).
        self.blocked: list[str] = []
        self.blocked_count = 0

    def __len__(self) -> int:
        return len(self.names)

    def add(self, name, parent_idx, size, disk, mtime, flags, btime=0) -> int:
        idx = len(self.names)
        self.names.append(name)
        self.parent.append(parent_idx)
        self.size.append(size)
        self.disk.append(disk)
        self.mtime.append(mtime)
        self.btime.append(btime)
        self.flags.append(flags)
        self.first_child.append(-1)
        self.next_sibling.append(-1)
        self.count.append(0)
        self.dircount.append(0)
        if parent_idx >= 0:
            head = self.first_child[parent_idx]
            if head == -1:
                self.first_child[parent_idx] = idx
            else:
                cur = head
                while self.next_sibling[cur] != -1:
                    cur = self.next_sibling[cur]
                self.next_sibling[cur] = idx
        return idx

    def children(self, idx):
        out = []
        cur = self.first_child[idx]
        while cur != -1:
            out.append(cur)
            cur = self.next_sibling[cur]
        return out

    def is_dir(self, idx) -> bool:
        return bool(self.flags[idx] & self.FLAG_DIR)

    def path_of(self, idx) -> str:
        parts = []
        cur = idx
        while cur > 0:
            parts.append(self.names[cur])
            cur = self.parent[cur]
        parts.reverse()
        return os.path.join(self.root_path, *parts) if parts else self.root_path

    def aggregate(self):
        """Roll sizes and file counts up the tree.

        A child's index is always greater than its parent's, so one reverse pass
        visits every child before the parent that absorbs it.
        """
        n = len(self.names)
        for idx in range(n - 1, 0, -1):
            p = self.parent[idx]
            self.count[p] += self.count[idx] + (0 if self.is_dir(idx) else 1)
            self.dircount[p] += self.dircount[idx] + (1 if self.is_dir(idx) else 0)
            self.size[p] += self.size[idx]
            self.disk[p] += self.disk[idx]
            if self.mtime[idx] > self.mtime[p]:
                self.mtime[p] = self.mtime[idx]

    def find(self, path: str) -> int | None:
        """Index of the node for an absolute path, or None."""
        path = os.path.normpath(os.path.abspath(os.path.expanduser(path)))
        root = os.path.normpath(self.root_path)
        if path == root:
            return 0
        prefix = root.rstrip("/") + "/"
        if not path.startswith(prefix):
            return None
        parts = path[len(prefix):].split("/")
        cur = 0
        for part in parts:
            nxt = -1
            child = self.first_child[cur]
            while child != -1:
                if self.names[child] == part:
                    nxt = child
                    break
                child = self.next_sibling[child]
            if nxt == -1:
                return None
            cur = nxt
        return cur

    def to_dict(self, idx=0, depth=3, max_children=64, min_frac=0.0, max_nodes=None):
        """Serialise a pruned subtree for the browser.

        The full tree never crosses the wire -- a home-folder scan can be
        millions of nodes. We send `depth` levels and the largest
        `max_children` at each level, folding the remainder into a bucket that
        keeps the totals honest.

        `max_nodes` is a hard ceiling on the whole payload. Depth and fan-out
        multiply, so a depth-3 request with 48 children each is over a hundred
        thousand nodes; the budget stops the expansion before the response
        becomes unusable.
        """
        budget = [max_nodes if max_nodes is not None else (1 << 62)]
        return self._to_dict(idx, depth, max_children, min_frac, budget)

    def _to_dict(self, idx, depth, max_children, min_frac, budget):
        budget[0] -= 1
        node = {
            "i": idx,
            "n": self.names[idx] if idx else (os.path.basename(self.root_path.rstrip("/")) or self.root_path),
            "p": self.path_of(idx),
            "s": self.size[idx],
            "d": self.disk[idx],
            "t": self.mtime[idx],
            "b": self.btime[idx],
            "f": self.flags[idx],
            "c": self.count[idx],
            "dc": self.dircount[idx],
        }
        if depth <= 0 or budget[0] <= 0 or not self.is_dir(idx):
            return node
        kids = self.children(idx)
        if not kids:
            return node
        kids.sort(key=lambda k: self.disk[k], reverse=True)
        total = self.disk[idx] or 1
        cutoff = total * min_frac
        limit = max_children
        if budget[0] < limit:
            limit = max(1, budget[0])
        kept = [k for k in kids[:limit] if self.disk[k] >= cutoff]
        node["ch"] = [self._to_dict(k, depth - 1, max_children, min_frac, budget) for k in kept]
        rest = kids[len(kept):]
        if rest:
            node["ch"].append({
                "i": -1,
                "n": f"{len(rest):,} smaller items",
                "p": self.path_of(idx),
                "s": sum(self.size[k] for k in rest),
                "d": sum(self.disk[k] for k in rest),
                "t": self.mtime[idx],
                "f": self.FLAG_DIR,
                "c": sum(self.count[k] for k in rest),
                "dc": sum(self.dircount[k] for k in rest),
                "aggregate": True,
            })
        return node


def _flags_for(name: str, st, is_dir: bool) -> int:
    flags = 0
    if is_dir:
        flags |= FileTree.FLAG_DIR
    if statmod.S_ISLNK(st.st_mode):
        flags |= FileTree.FLAG_LINK
    if name.startswith("."):
        flags |= FileTree.FLAG_HIDDEN
    return flags


def scan(
    root_path: str,
    on_progress=None,
    should_cancel=None,
    cross_filesystem: bool = False,
    max_depth: int | None = None,
    exclude: set[str] | None = None,
    min_size: int = 0,
    count_hardlinks_once: bool = True,
    workers: int | None = None,
) -> FileTree:
    """Walk `root_path` and return a populated FileTree."""
    root_path = os.path.abspath(os.path.expanduser(root_path))
    tree = FileTree(root_path)
    tree.started = time.time()

    try:
        root_st = os.stat(root_path)
    except OSError as exc:
        raise FileNotFoundError(f"Cannot read {root_path}: {exc}") from exc

    root_dev = root_st.st_dev
    # Resolve the skip list against wherever this walk actually started.
    abs_skip = {os.path.normpath(os.path.join(root_path, rel)) for rel in SKIP_RELATIVE}
    tree.add(
        os.path.basename(root_path.rstrip("/")) or root_path,
        -1,
        root_st.st_size,
        getattr(root_st, "st_blocks", 0) * 512,
        int(root_st.st_mtime),
        FileTree.FLAG_DIR,
        int(getattr(root_st, "st_birthtime", root_st.st_mtime)),
    )

    if workers is None:
        workers = min(12, max(4, (os.cpu_count() or 4) * 2))
    tree.workers = workers

    exclude = exclude or set()
    cancel = threading.Event()
    lock = threading.Lock()
    queue: deque = deque([(0, root_path, 0)])
    pending = [1]
    seen_inodes: set[tuple[int, int]] = set()
    last_report = [time.time()]
    idle = threading.Condition(lock)

    def worker() -> None:
        while True:
            with lock:
                while not queue and pending[0] > 0:
                    idle.wait(0.05)
                if not queue:
                    return
                parent_idx, path, depth = queue.popleft()

            if cancel.is_set() or (should_cancel is not None and should_cancel()):
                cancel.set()

            subdirs: list[tuple[int, str, int]] = []
            batch: list[tuple] = []

            try:
                with os.scandir(path) as it:
                    for entry in it:
                        if cancel.is_set():
                            break
                        name = entry.name
                        if name in exclude:
                            continue
                        try:
                            is_dir = entry.is_dir(follow_symlinks=False)
                        except OSError:
                            with lock:
                                tree.errors += 1
                            continue
                        if is_dir and (name in SKIP_DIRS
                                       or os.path.normpath(entry.path) in abs_skip):
                            with lock:
                                tree.skipped += 1
                            continue
                        try:
                            st = entry.stat(follow_symlinks=False)
                        except OSError as exc:
                            with lock:
                                tree.errors += 1
                                if isinstance(exc, PermissionError):
                                    tree.blocked_count += 1
                                    if len(tree.blocked) < 4000:
                                        tree.blocked.append(entry.path)
                            continue
                        if not cross_filesystem and st.st_dev != root_dev:
                            with lock:
                                tree.skipped += 1
                            continue
                        if is_dir and statmod.S_ISLNK(st.st_mode):
                            # Count the link itself but never follow it: that is
                            # how a walker ends up in an infinite loop.
                            continue

                        on_disk = getattr(st, "st_blocks", 0) * 512
                        if not is_dir and min_size and on_disk < min_size:
                            continue

                        if count_hardlinks_once and not is_dir and st.st_nlink > 1:
                            key = (st.st_dev, st.st_ino)
                            with lock:
                                if key in seen_inodes:
                                    tree.skipped += 1
                                    continue
                                seen_inodes.add(key)

                        flags = _flags_for(name, st, is_dir)
                        btime = int(getattr(st, "st_birthtime", st.st_mtime))
                        if is_dir and max_depth is not None and depth + 1 >= max_depth:
                            flags |= FileTree.FLAG_DIR
                            batch.append((name, 0, 0, int(st.st_mtime), btime, flags, None))
                            continue
                        batch.append((name, st.st_size, on_disk, int(st.st_mtime), btime, flags,
                                      entry.path if is_dir else None))
            except OSError as exc:
                with lock:
                    tree.errors += 1
                    tree.blocked_count += 1
                    if len(tree.blocked) < 4000 and isinstance(exc, PermissionError):
                        tree.blocked.append(path)

            if batch:
                with lock:
                    base = len(tree.names)
                    names = tree.names
                    parent = tree.parent
                    size_a = tree.size
                    disk_a = tree.disk
                    mtime_a = tree.mtime
                    btime_a = tree.btime
                    flags_a = tree.flags
                    fc = tree.first_child
                    ns = tree.next_sibling
                    cnt = tree.count
                    dcnt = tree.dircount
                    files = 0
                    nbytes = 0
                    for (name, sz, dk, mt, bt, fl, sub) in batch:
                        idx = len(names)
                        names.append(name)
                        parent.append(parent_idx)
                        size_a.append(sz)
                        disk_a.append(dk)
                        mtime_a.append(mt)
                        btime_a.append(bt)
                        flags_a.append(fl)
                        fc.append(-1)
                        ns.append(-1)
                        cnt.append(0)
                        dcnt.append(0)
                        if sub is not None:
                            subdirs.append((idx, sub, depth + 1))
                        else:
                            files += 1
                            nbytes += dk
                    # Splice the new nodes onto the tail of the parent's child
                    # chain, preserving readdir order.
                    head = fc[parent_idx]
                    if head == -1:
                        fc[parent_idx] = base
                    else:
                        cur = head
                        while ns[cur] != -1:
                            cur = ns[cur]
                        ns[cur] = base
                    for k in range(1, len(batch)):
                        ns[base + k - 1] = base + k
                    tree.files_seen += files
                    tree.bytes_seen += nbytes
                    pending[0] += len(subdirs)

            if subdirs:
                with lock:
                    queue.extend(subdirs)
                    idle.notify_all()

            with lock:
                pending[0] -= 1
                idle.notify_all()

            now = time.time()
            if on_progress is not None and now - last_report[0] > 0.2:
                last_report[0] = now
                on_progress(tree.files_seen, tree.bytes_seen, path, len(tree.names))

    threads = [threading.Thread(target=worker, daemon=True, name=f"scan-{i}") for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    if cancel.is_set():
        tree.cancelled = True

    tree.aggregate()
    tree.finished = time.time()
    if on_progress is not None:
        on_progress(tree.files_seen, tree.bytes_seen, root_path, len(tree.names))
    return tree


def volume_usage(path: str) -> dict:
    """Free/total/used for the volume holding `path`."""
    p = os.path.abspath(os.path.expanduser(path))
    while p != "/" and not os.path.exists(p):
        p = os.path.dirname(p)
    try:
        usage = os.statvfs(p)
        total = usage.f_blocks * usage.f_frsize
        free = usage.f_bavail * usage.f_frsize
        return {
            "path": p,
            "total": total,
            "free": free,
            "used": total - free,
            "pct": round((total - free) / total * 100, 1) if total else 0.0,
        }
    except OSError:
        return {"path": p, "total": 0, "free": 0, "used": 0, "pct": 0.0}
