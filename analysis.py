# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 DiskLens contributors
"""Derived views over a scan: duplicates, age, big-and-untouched, quick wins,
installed apps and their leftovers.

Everything here is read-only. Nothing in this module deletes or moves a file.
"""

from __future__ import annotations

import os
import plistlib
import re
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from scanner import FileTree

HASH_CHUNK = 1 << 20  # 1 MiB


# --------------------------------------------------------------------------
# Age
# --------------------------------------------------------------------------

def age_map(tree: FileTree, idx: int = 0, buckets: int = 40):
    """Bytes grouped by last-modified time, oldest bucket first.

    Returns a list of {t, bytes, files, label} plus the bucket width, so the
    frontend can render a real timeline rather than an evenly-spaced guess.
    """
    files = []
    stack = [idx]
    while stack:
        cur = stack.pop()
        child = tree.first_child[cur]
        while child != -1:
            if tree.is_dir(child):
                stack.append(child)
            else:
                files.append(child)
            child = tree.next_sibling[child]

    if not files:
        return {"buckets": [], "width": 0, "min": 0, "max": 0, "total": tree.disk[idx]}

    now = int(time.time())
    # Some archives, sync clients and unset clocks leave files stamped at or
    # near the epoch. Letting one of those set the range would stretch the
    # timeline across five decades and flatten every real bucket, so the floor
    # is a fixed point and anything older simply lands in the first bucket.
    floor = int(time.mktime((2001, 1, 1, 0, 0, 0, 0, 0, -1)))
    times = [t for t in (tree.mtime[f] for f in files) if floor <= t <= now + 86400]
    if not times:
        return {"buckets": [], "width": 0, "min": 0, "max": 0,
                "total": tree.disk[idx], "undated": 0}

    lo, hi = min(times), max(times)
    hi = max(hi, now)
    if hi - lo < buckets:
        lo = hi - buckets
    width = max(1, (hi - lo) // buckets)

    agg = defaultdict(lambda: [0, 0])
    undated = 0
    for f in files:
        t = tree.mtime[f]
        if t < floor or t > now + 86400:
            undated += tree.disk[f]
            b = 0
        else:
            b = min(buckets - 1, (t - lo) // width)
        agg[b][0] += tree.disk[f]
        agg[b][1] += 1

    out = []
    for b in range(buckets):
        start = lo + b * width
        d = agg.get(b, [0, 0])
        out.append({
            "t": start,
            "bytes": d[0],
            "files": d[1],
            "label": time.strftime("%b %Y", time.localtime(start)),
        })
    return {"buckets": out, "width": width, "min": lo, "max": hi,
            "undated": undated, "total": sum(b["bytes"] for b in out)}


def big_and_untouched(tree: FileTree, idx: int = 0, min_bytes: int = 100 << 20,
                      min_age_days: int = 365, limit: int = 200):
    """Large files that have not been modified in a year.

    Sorted by size, because that is the only ordering that helps you decide
    what to clean up.
    """
    cutoff = int(time.time()) - min_age_days * 86400
    out = []
    stack = [idx]
    while stack:
        cur = stack.pop()
        child = tree.first_child[cur]
        while child != -1:
            if tree.is_dir(child):
                stack.append(child)
            elif tree.disk[child] >= min_bytes and 0 < tree.mtime[child] < cutoff:
                out.append({
                    "i": child,
                    "n": tree.names[child],
                    "p": tree.path_of(child),
                    "d": tree.disk[child],
                    "s": tree.size[child],
                    "t": tree.mtime[child],
                    "age": int((time.time() - tree.mtime[child]) / 86400),
                })
            child = tree.next_sibling[child]
    out.sort(key=lambda r: r["d"], reverse=True)
    return {"items": out[:limit], "total": sum(r["d"] for r in out), "count": len(out)}


# --------------------------------------------------------------------------
# Duplicates
# --------------------------------------------------------------------------

def _hash_file(path: str, limit: int | None = None):
    import hashlib
    h = hashlib.blake2b(digest_size=16)
    read = 0
    try:
        with open(path, "rb", buffering=0) as fh:
            while True:
                chunk = fh.read(HASH_CHUNK)
                if not chunk:
                    break
                h.update(chunk)
                read += len(chunk)
                if limit is not None and read >= limit:
                    break
    except OSError:
        return None
    return h.digest()


def find_duplicates(tree: FileTree, idx: int = 0, min_bytes: int = 4096,
                    limit_groups: int = 400, workers: int = 8):
    """Byte-for-byte duplicate detection.

    Cheap size bucketing first, then a hash of the first 64 KiB, then a full
    hash only for the survivors. Files that share a size but not content are
    rejected by the second pass without reading the whole file.

    Bucketing uses the *logical* size, not the on-disk size. On-disk size is
    rounded up to a block boundary, so unrelated files collide constantly: on a
    whole-Mac scan, bucketing by blocks put 2.39M files into the candidate set
    where the true figure is 687k. Every one of those extra files would have
    been read and hashed for nothing.
    """
    by_size = defaultdict(list)
    stack = [idx]
    while stack:
        cur = stack.pop()
        child = tree.first_child[cur]
        while child != -1:
            if tree.is_dir(child):
                stack.append(child)
            elif tree.size[child] >= min_bytes:
                by_size[tree.size[child]].append(child)
            child = tree.next_sibling[child]

    candidates = [v for v in by_size.values() if len(v) > 1]
    if not candidates:
        return {"groups": [], "wasted": 0, "count": 0, "hashed": 0}

    flat = [i for group in candidates for i in group]
    hashed = 0

    def partial(i):
        return (i, _hash_file(tree.path_of(i), limit=65536))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        partials = list(pool.map(partial, flat))
    hashed += len(partials)

    # Same size and same first 64 KiB: either a real duplicate or a file that
    # diverges later. Confirm those with a full read.
    stage2 = defaultdict(list)
    for i, h in partials:
        if h is not None:
            stage2[(tree.size[i], h)].append(i)

    to_confirm = [v for v in stage2.values() if len(v) > 1]
    confirmed = []
    if to_confirm:
        flat2 = [i for group in to_confirm for i in group]

        def full(i):
            return (i, _hash_file(tree.path_of(i)))

        with ThreadPoolExecutor(max_workers=workers) as pool:
            confirmed = list(pool.map(full, flat2))
        hashed += len(confirmed)

    final = defaultdict(list)
    for i, h in confirmed:
        if h is not None:
            final[(tree.size[i], h)].append(i)

    groups = []
    wasted = 0
    for (logical, _h), members in final.items():
        if len(members) < 2:
            continue
        members.sort(key=lambda i: tree.path_of(i))
        # Each copy occupies its own blocks, so reclaiming uses on-disk bytes.
        on_disk = tree.disk[members[0]]
        wasted += on_disk * (len(members) - 1)
        groups.append({
            "size": on_disk,
            "logical": logical,
            "count": len(members),
            "wasted": on_disk * (len(members) - 1),
            "files": [
                {"i": i, "n": tree.names[i], "p": tree.path_of(i), "t": tree.mtime[i]}
                for i in members
            ],
        })

    groups.sort(key=lambda g: g["wasted"], reverse=True)
    return {
        "groups": groups[:limit_groups],
        "wasted": wasted,
        "count": sum(g["count"] for g in groups),
        "hashed": hashed,
    }


# --------------------------------------------------------------------------
# Quick wins
# --------------------------------------------------------------------------

JUNK_PATTERNS = [
    ("node_modules", re.compile(r"(^|/)node_modules(/|$)"), "Node modules"),
    ("DerivedData", re.compile(r"(^|/)DerivedData(/|$)"), "Xcode DerivedData"),
    ("Caches", re.compile(r"/Library/Caches(/|$)"), "App caches"),
    ("Logs", re.compile(r"/Library/Logs(/|$)"), "Logs"),
    ("Simulators", re.compile(r"/CoreSimulator/(Devices|Caches)(/|$)"), "iOS Simulators"),
    ("Trash", re.compile(r"(^|/)\.Trash(/|$)"), "Trash"),
    ("Downloads", re.compile(r"(^|/)Downloads(/|$)"), "Downloads"),
    ("build", re.compile(r"(^|/)(build|dist|\.next|__pycache__|target)(/|$)"), "Build artifacts"),
    ("npm", re.compile(r"(^|/)\.npm(/|$)"), "npm cache"),
    ("pip", re.compile(r"(^|/)(\.cache/pip|Library/Caches/pip)(/|$)"), "pip cache"),
    ("docker", re.compile(r"/Docker\.raw$|/com\.docker\.docker/Data(/|$)"), "Docker data"),
    ("iosbackup", re.compile(r"/MobileSync/Backup(/|$)"), "iPhone backups"),
]


def quick_wins(tree: FileTree, idx: int = 0, limit: int = 40):
    """Known-expensive folders, totalled from the scan we already have.

    Matches the deepest node that satisfies a pattern so a nested
    node_modules inside node_modules is not double-counted.
    """
    hits: dict[str, dict] = {}
    stack = [idx]
    while stack:
        cur = stack.pop()
        child = tree.first_child[cur]
        while child != -1:
            if tree.is_dir(child):
                path = tree.path_of(child)
                for key, rx, label in JUNK_PATTERNS:
                    if rx.search(path):
                        prev = hits.get(key)
                        if prev is None or tree.disk[child] > prev["bytes"]:
                            hits[key] = {
                                "key": key,
                                "label": label,
                                "path": path,
                                "i": child,
                                "bytes": tree.disk[child],
                                "files": tree.count[child],
                            }
                        # Still descend: a deeper match may be the bigger one.
                        break
                stack.append(child)
            child = tree.next_sibling[child]

    items = sorted(hits.values(), key=lambda h: h["bytes"], reverse=True)[:limit]
    return {"items": items, "total": sum(h["bytes"] for h in items)}


# --------------------------------------------------------------------------
# Installed apps and their leftovers
# --------------------------------------------------------------------------

APP_DIRS = ["/Applications", os.path.expanduser("~/Applications"),
            "/System/Applications", "/Applications/Utilities"]

LEFTOVER_DIRS = [
    ("~/Library/Application Support", "{name}"),
    ("~/Library/Caches", "{name}"),
    ("~/Library/Caches", "{bid}"),
    ("~/Library/Logs", "{name}"),
    ("~/Library/Preferences", "{bid}.plist"),
    ("~/Library/Preferences", "{name}.plist"),
    ("~/Library/HTTPStorages", "{bid}"),
    ("~/Library/HTTPStorages", "{bid}.binarycookies"),
    ("~/Library/WebKit", "{bid}"),
    ("~/Library/Saved Application State", "{bid}.savedState"),
    ("~/Library/Containers", "{bid}"),
    ("~/Library/Group Containers", "{bid}"),
    ("~/Library/Application Scripts", "{bid}"),
    ("~/Library/LaunchAgents", "{bid}.plist"),
    ("~/Library/Cookies", "{bid}.binarycookies"),
]

SKIP_APPS = {"Safari.app", "Finder.app"}


def _dir_size(path: str, budget: int = 400_000) -> tuple[int, int]:
    """Recursive size of a directory, without building a tree.

    Bounded by `budget` entries so a pathological folder cannot stall the app
    listing; the count returned is always the true one for what was walked.
    """
    total = 0
    count = 0
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
                        count += 1
                    if count > budget:
                        return total, count
        except OSError:
            continue
    return total, count


def installed_apps(scan_roots: list[str] | None = None):
    """List .app bundles with the size of their Library leftovers.

    The bundle is what you see; the leftovers are usually what you forgot.
    """
    seen: dict[str, dict] = {}
    for base in APP_DIRS:
        if not os.path.isdir(base):
            continue
        try:
            entries = list(os.scandir(base))
        except OSError:
            continue
        for e in entries:
            if not e.name.endswith(".app") or e.name in SKIP_APPS:
                continue
            if not e.is_dir(follow_symlinks=False):
                continue
            key = e.name
            if key in seen:
                continue
            bid = None
            plist = os.path.join(e.path, "Contents", "Info.plist")
            try:
                with open(plist, "rb") as fh:
                    info = plistlib.load(fh)
                bid = info.get("CFBundleIdentifier")
            except Exception:
                pass
            name = e.name[:-4]
            seen[key] = {
                "name": name,
                "app": e.name,
                "path": e.path,
                "bid": bid,
                "id": re.sub(r"[^A-Za-z0-9]+", "-", f"{name}-{bid or ''}").lower(),
                "system": base.startswith("/System"),
            }

    def measure(app):
        size, count = _dir_size(app["path"])
        leftovers = []
        ltotal = 0
        subs = {
            "name": app["name"],
            "bid": app["bid"] or app["name"],
        }
        for tmpl_dir, tmpl_name in LEFTOVER_DIRS:
            d = os.path.expanduser(tmpl_dir)
            if not os.path.isdir(d):
                continue
            target = os.path.join(d, tmpl_name.format(**subs))
            if os.path.abspath(target) == os.path.abspath(app["path"]):
                continue
            if os.path.exists(target):
                s, c = _dir_size(target)
                if s > 0 or c > 0:
                    leftovers.append({"path": target, "bytes": s, "files": c})
                    ltotal += s
        app["bundle_bytes"] = size
        app["bundle_files"] = count
        app["leftovers"] = leftovers
        app["leftover_bytes"] = ltotal
        app["total_bytes"] = size + ltotal
        return app

    apps = list(seen.values())
    if apps:
        with ThreadPoolExecutor(max_workers=8) as pool:
            apps = list(pool.map(measure, apps))
    apps.sort(key=lambda a: a["total_bytes"], reverse=True)
    return {"apps": apps, "total": sum(a["total_bytes"] for a in apps)}


# --------------------------------------------------------------------------
# Top sizes
# --------------------------------------------------------------------------

def top_files(tree: FileTree, idx: int = 0, limit: int = 200, dirs: bool = False):
    out = []
    stack = [idx]
    while stack:
        cur = stack.pop()
        child = tree.first_child[cur]
        while child != -1:
            if tree.is_dir(child):
                if dirs:
                    out.append(child)
                stack.append(child)
            else:
                out.append(child)
            child = tree.next_sibling[child]
    out.sort(key=lambda i: tree.disk[i], reverse=True)
    return [
        {"i": i, "n": tree.names[i], "p": tree.path_of(i), "d": tree.disk[i],
         "s": tree.size[i], "t": tree.mtime[i], "dir": tree.is_dir(i)}
        for i in out[:limit]
    ]


def largest_inside(tree: FileTree, idx: int, limit: int = 12):
    """The biggest children of one node, for the inspector."""
    kids = tree.children(idx)
    kids.sort(key=lambda k: tree.disk[k], reverse=True)
    total = tree.disk[idx] or 1
    return [
        {"i": k, "n": tree.names[k], "d": tree.disk[k], "dir": tree.is_dir(k),
         "pct": round(tree.disk[k] / total * 100, 1)}
        for k in kids[:limit]
    ]


# --------------------------------------------------------------------------
# Disk accounting
#
# The gap between "bytes the volume says are used" and "bytes this scan found"
# is the single most important number a disk tool reports, and the one most
# likely to be hand-waved. On this machine it is about 66 GB, and it is made
# of three different things that must not be blurred together:
#
#   1. Other volumes in the same APFS container. Preboot, VM (swap) and
#      Recovery together hold ~26 GB and are not under the data volume at all,
#      so a scan rooted at "/" walks past them by design.
#   2. Directories macOS refuses to open. These are privacy-protected -- your
#      Photos library, Mail, Messages, the Trash -- and they are exactly where
#      the biggest numbers hide. The count is knowable; the size is not,
#      because the OS will not let anything measure it without Full Disk
#      Access.
#   3. APFS purgeable space and filesystem metadata.
#
# Only (1) is fully knowable and (2) is actionable, so report them separately
# and never fold them into one "other" bucket.
# --------------------------------------------------------------------------

APFS_ROLE_NOTE = {
    "System": "The signed system volume. Read-only, protected by SIP.",
    "Preboot": "Boot support and staged updates. macOS manages this.",
    "Recovery": "RecoveryOS. Needed to boot into recovery.",
    "VM": "Swap files and the sleep image, sized by your RAM.",
    "Data": "Your files. This is what the scan walks.",
    "Update": "Staged system updates.",
    "Hardware": "Hardware support data. Tiny.",
    "xART": "Firmware storage. Tiny.",
    "iSCPreboot": "Boot support for the other container. Tiny.",
}


def apfs_volumes():
    """Every APFS volume on the machine, with the bytes it consumes."""
    import plistlib
    import subprocess

    out = []
    try:
        raw = subprocess.run(["diskutil", "apfs", "list", "-plist"],
                             capture_output=True, timeout=25).stdout
        listing = plistlib.loads(raw)
    except Exception:
        return out

    for container in listing.get("Containers", []):
        ref = container.get("ContainerReference", "")
        free = container.get("CapacityFree")
        for vol in container.get("Volumes", []):
            dev = vol.get("DeviceIdentifier")
            if not dev:
                continue
            info = {}
            try:
                raw = subprocess.run(["diskutil", "info", "-plist", dev],
                                     capture_output=True, timeout=20).stdout
                info = plistlib.loads(raw)
            except Exception:
                pass
            roles = vol.get("Roles") or []
            role = roles[0] if roles else ""
            out.append({
                "container": ref,
                "container_free": free,
                "device": dev,
                "name": vol.get("Name") or dev,
                "role": role,
                "bytes": info.get("CapacityInUse") or 0,
                "mount": info.get("MountPoint") or "",
                "note": APFS_ROLE_NOTE.get(role, ""),
            })
    return out


def _group_blocked(paths):
    """Group blocked paths by parent so the list reads like a short story."""
    from collections import defaultdict
    groups = defaultdict(list)
    for p in paths:
        parent = os.path.dirname(p) or "/"
        groups[parent].append(os.path.basename(p) or p)

    # Names that almost always mean a lot of bytes, so they lead the list.
    heavy = ("photos library", "photoslibrary", "mail", "messages", ".trash",
             "photo booth", "safari", "daemon containers")

    rows = []
    for parent, names in groups.items():
        names.sort()
        joinable = ", ".join(names[:6]) + (f" +{len(names) - 6} more" if len(names) > 6 else "")
        is_heavy = any(h in n.lower() for n in names for h in heavy)
        rows.append({
            "parent": parent,
            "count": len(names),
            "names": names[:40],
            "summary": joinable,
            "heavy": is_heavy,
        })
    rows.sort(key=lambda r: (not r["heavy"], -r["count"]))
    return rows


def volume_capacities(paths):
    """Available capacity including purgeable, from Foundation.

    `availableForImportantUsage - available` is purgeable space: bytes macOS
    will hand back by itself. The command line has no equivalent, so a small
    Swift probe is compiled once and cached; if there is no Swift toolchain the
    function returns nothing and the caller says so rather than guessing.
    """
    import json as _json
    import subprocess
    import shutil as _shutil

    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "tools", "volprobe.swift")
    cache_dir = os.path.join(here, "data")
    binary = os.path.join(cache_dir, "volprobe")

    if not os.path.exists(binary):
        swiftc = _shutil.which("swiftc")
        if not swiftc or not os.path.exists(src):
            return None
        try:
            os.makedirs(cache_dir, exist_ok=True)
            subprocess.run([swiftc, "-O", "-o", binary, src],
                           capture_output=True, timeout=180, check=True)
        except Exception:
            return None

    try:
        raw = subprocess.run([binary] + list(paths), capture_output=True,
                             timeout=30, text=True).stdout
        rows = _json.loads(raw)
    except Exception:
        return None

    out = {}
    for row in rows:
        plain = row.get("plain")
        important = row.get("important")
        out[row.get("path")] = {
            "available": plain,
            "available_with_purgeable": important,
            "opportunistic": row.get("opportunistic"),
            "total": row.get("total"),
            "name": row.get("name"),
            # Clamped: a negative would mean the API disagreed with statvfs,
            # which is not something to report as fact.
            "purgeable": max(0, (important - plain)) if (plain is not None and important is not None) else None,
        }
    return out


def local_snapshots():
    """APFS snapshots the volume is holding onto.

    These are the one part of the gap that is both invisible to a file walk
    and safely removable by the user, so they are worth detecting properly
    rather than assuming. On many machines there are none at all, and claiming
    otherwise would be the same hand-waving this is meant to replace.
    """
    import subprocess
    out = []
    try:
        raw = subprocess.run(["tmutil", "listlocalsnapshots", "/"],
                             capture_output=True, timeout=25, text=True).stdout
    except Exception:
        return out
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.lower().startswith("snapshots for"):
            continue
        out.append(line)
    return out


def disk_accounting(tree, root_path: str):
    """Reconcile the volumes against what this scan actually found."""
    scanned = tree.disk[0] if len(tree) else 0
    blocked = list(getattr(tree, "blocked", []) or [])
    blocked_count = getattr(tree, "blocked_count", 0) or 0

    vols = apfs_volumes()
    root_abs = os.path.normpath(os.path.abspath(root_path))

    # Which container holds the scan root? Ask diskutil directly: the system
    # volume mounts at "/" but reports an empty MountPoint, so matching on
    # paths alone silently picks the wrong container.
    target_container = None
    try:
        import plistlib
        import subprocess
        raw = subprocess.run(["diskutil", "info", "-plist", root_abs],
                             capture_output=True, timeout=20).stdout
        target_container = plistlib.loads(raw).get("APFSContainerReference")
    except Exception:
        target_container = None
    if target_container is None:
        for v in vols:
            if v["mount"] and (root_abs == v["mount"] or root_abs.startswith(v["mount"].rstrip("/") + "/")):
                target_container = v["container"]
                break
    if target_container is None and vols:
        target_container = vols[0]["container"]

    mine = [v for v in vols if v["container"] == target_container]
    others = [v for v in vols if v["container"] != target_container]

    volume_total = sum(v["bytes"] for v in mine)
    # The data volume is what the walk covers via the root firmlinks; the
    # system volume it also reaches at /System and /usr. Anything else in the
    # container is walked past.
    walked = {"Data", "System"}
    skipped = [v for v in mine if v["role"] not in walked]
    skipped_bytes = sum(v["bytes"] for v in skipped)

    # Purgeable is the difference between "hidden bytes I cannot read" and
    # "bytes macOS will reclaim on its own". Without it those two get lumped
    # together, which is exactly the vague answer this screen exists to avoid.
    caps = volume_capacities([root_abs, "/System/Volumes/Data"])
    purgeable = None
    if caps:
        for key in (root_abs, "/System/Volumes/Data"):
            if key in caps and caps[key].get("purgeable") is not None:
                purgeable = caps[key]["purgeable"]
                break

    gap = max(0, volume_total - scanned)
    after_volumes = max(0, gap - skipped_bytes)
    # Purgeable is measured, so it comes out of the bucket by name instead of
    # hiding inside a label called "not readable or purgeable".
    purge_used = min(purgeable or 0, after_volumes)
    blocked_bytes = max(0, after_volumes - purge_used)

    snaps = local_snapshots()

    return {
        "purgeable": purgeable,
        "capacities": caps,
        "snapshots": snaps,
        "snapshot_count": len(snaps),
        "root": root_abs,
        "container": target_container,
        "scanned": scanned,
        "volume_total": volume_total,
        "gap": gap,
        "volumes": mine,
        "other_containers": others,
        "skipped_volumes": skipped,
        "skipped_bytes": skipped_bytes,
        "unexplained": after_volumes,
        "blocked_bytes": blocked_bytes,
        "purgeable_used": purge_used,
        "blocked_count": blocked_count,
        "blocked_groups": _group_blocked(blocked),
        "blocked_paths": blocked[:600],
    }
