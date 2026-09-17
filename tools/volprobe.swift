// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 DiskLens contributors
// Reads APFS volume capacities that are not exposed on the command line.
//
// Specifically volumeAvailableCapacityForImportantUsage, which counts the
// bytes macOS would free by purging purgeable data. Subtracting the plain
// available capacity from it gives purgeable space -- the difference between
// "this 40 GB is hidden files" and "this 40 GB is space macOS will hand back
// on its own". No CLI tool reports it; Foundation does.
//
// Compiled once on first use and cached next to the scan data.

import Foundation

let paths = Array(CommandLine.arguments.dropFirst())
var rows: [[String: Any]] = []

for path in paths {
    let url = URL(fileURLWithPath: path)
    var row: [String: Any] = ["path": path]
    if let v = try? url.resourceValues(forKeys: [
        .volumeAvailableCapacityKey,
        .volumeAvailableCapacityForImportantUsageKey,
        .volumeAvailableCapacityForOpportunisticUsageKey,
        .volumeTotalCapacityKey,
        .volumeNameKey,
    ]) {
        if let n = v.volumeAvailableCapacity { row["plain"] = n }
        if let n = v.volumeAvailableCapacityForImportantUsage { row["important"] = n }
        if let n = v.volumeAvailableCapacityForOpportunisticUsage { row["opportunistic"] = n }
        if let n = v.volumeTotalCapacity { row["total"] = n }
        if let n = v.volumeName { row["name"] = n }
    }
    rows.append(row)
}

if let data = try? JSONSerialization.data(withJSONObject: rows),
   let text = String(data: data, encoding: .utf8) {
    print(text)
}
