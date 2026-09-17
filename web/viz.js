// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 DiskLens contributors
/* DiskLens visualisations.
 *
 * Every view shares one contract:
 *   view.render(canvas, focus, opts)  -- computes a layout and paints it
 *   view.hit(x, y)                    -- returns the node under a point, or null
 *   view.actions                      -- which interactions the view supports
 *
 * Layouts are recomputed on demand rather than animated, so a view is always a
 * pure function of (tree, focus, size). That keeps zoom and resize honest.
 */

const Viz = (() => {
  const D = 1;   // FLAG_DIR
  const L = 2;   // FLAG_LINK
  const H = 4;   // FLAG_HIDDEN

  const isDir = (n) => !!(n.f & D);
  const isLink = (n) => !!(n.f & L);

  // ---------------------------------------------------------------- format

  function human(bytes, digits = 1) {
    if (bytes === null || bytes === undefined) return '--';
    const neg = bytes < 0;
    let b = Math.abs(bytes);
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    let out;
    if (i === 0) out = `${Math.round(b)} B`;
    else out = `${b.toFixed(b >= 100 ? 0 : digits)} ${units[i]}`;
    return neg ? '-' + out : out;
  }

  function pctOf(part, whole) {
    if (!whole) return '0%';
    const p = (part / whole) * 100;
    if (p > 0 && p < 0.1) return '<0.1%';
    return `${p.toFixed(p >= 10 ? 0 : 1)}%`;
  }

  function relTime(ts) {
    if (!ts) return '--';
    const d = Date.now() / 1000 - ts;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
    if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)} mo ago`;
    return `${(d / 86400 / 365).toFixed(1)} yr ago`;
  }

  // ---------------------------------------------------------------- colour

  const EXT = {
    video: ['mp4','mov','avi','mkv','webm','m4v','mpg','mpeg','flv','wmv','prproj'],
    image: ['jpg','jpeg','png','gif','heic','webp','tiff','tif','bmp','svg','psd','ai','raw','cr2','nef','arw','dng'],
    audio: ['mp3','wav','aac','flac','m4a','aiff','aif','ogg','opus','mid'],
    archive: ['zip','tar','gz','rar','7z','dmg','pkg','xz','bz2','tgz','iso','jar','war'],
    code: ['js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','java','kt','swift','c','cc','cpp','h','hpp','cs','php','sh','zsh','bash','json','yaml','yml','toml','xml','html','css','scss','sql','lua','pl','r','vue','svelte'],
    doc: ['pdf','doc','docx','txt','md','rtf','xls','xlsx','ppt','pptx','pages','numbers','key','csv','epub','tex','log'],
    app: ['app','framework','bundle','dylib','so','a','o','kext','plugin','xpc','dSYM'],
    disk: ['vmdk','qcow2','vdi','raw','sparseimage','sparsebundle','img'],
  };

  /* Two palettes, because one set of fills cannot work on both a near-black
   * and a near-white ground. The dark set is luminous; the light set is the
   * same hue family pushed darker and slightly desaturated so the labels
   * drawn on top keep their contrast against white. */
  const CAT_COLOR = {
    dark: {
      video:   '#f472b6',
      image:   '#fbbf24',
      audio:   '#a78bfa',
      archive: '#fb923c',
      code:    '#34d399',
      doc:     '#60a5fa',
      app:     '#22d3ee',
      disk:    '#f87171',
      system:  '#7c8798',
      other:   '#94a3b8',
    },
    light: {
      video:   '#e0518f',
      image:   '#d99a06',
      audio:   '#7c5cf0',
      archive: '#e07326',
      code:    '#0f9d6b',
      doc:     '#2f7ae5',
      app:     '#0d9bb8',
      disk:    '#e05252',
      system:  '#6b7684',
      other:   '#7d8894',
    },
  };

  /* Ink for everything drawn as line work or text on the canvas: seams
   * between cells, grid lines, axis labels, the sunburst centre disc. These
   * are the values that make a chart read correctly in each mode. */
  const INK = {
    dark: {
      seam: 'rgba(6,8,12,0.85)',
      seamSoft: 'rgba(6,8,12,0.7)',
      grid: 'rgba(255,255,255,0.06)',
      label: '#c8d3e0',
      labelDim: '#7a8797',
      disc: '#131820',
      discRim: '#2a323d',
      center: '#e6edf3',
      centerDim: '#8b98a9',
      empty: '#6b7787',
      shadow: 'rgba(0,0,0,.55)',
    },
    light: {
      seam: 'rgba(255,255,255,0.95)',
      seamSoft: 'rgba(255,255,255,0.85)',
      grid: 'rgba(15,20,28,0.09)',
      label: '#2b3542',
      labelDim: '#68727e',
      disc: '#f2f4f7',
      discRim: '#d5dbe2',
      center: '#141a21',
      centerDim: '#68727e',
      empty: '#8b939c',
      shadow: 'rgba(255,255,255,.7)',
    },
  };

  const modeState = { mode: 'dark' };
  function setMode(m) { modeState.mode = (m === 'light') ? 'light' : 'dark'; }
  const cat = () => CAT_COLOR[modeState.mode];
  const ink = () => INK[modeState.mode];

  const CAT_LABEL = {
    video: 'Video', image: 'Image', audio: 'Audio', archive: 'Archive',
    code: 'Code', doc: 'Document', app: 'App / binary', disk: 'Disk image',
    system: 'System / cache', other: 'Other',
  };

  const EXT_LOOKUP = (() => {
    const m = {};
    for (const [name, list] of Object.entries(EXT)) for (const e of list) m[e] = name;
    return m;
  })();

  function extOf(name) {
    const i = name.lastIndexOf('.');
    if (i <= 0 || i === name.length - 1) return '';
    return name.slice(i + 1).toLowerCase();
  }

  function categoryOf(node) {
    const name = node.n || '';
    const ext = extOf(name);
    if (ext && EXT_LOOKUP[ext]) return EXT_LOOKUP[ext];
    // A directory is classified by its own name before falling back, so that
    // "Xcode DerivedData" or a Caches tree reads as system rather than Other.
    if (/(^|\/)(Caches?|Logs|tmp|temp|DerivedData|\.Trash|node_modules)(\/|$)/i.test(name)) return 'system';
    if (isDir(node)) return 'folder';
    return 'other';
  }

  // Stable hue per top-level branch, so every folder keeps one colour family
  // as you drill deeper and children read as shades of their parent.
  function hueOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  /* Which branch a node belongs to is measured *relative to the scan root*.
   * Using absolute path components instead would put every folder under
   * /Users/you in a single branch, and the whole map would come out one hue. */
  const rootState = { path: '', hueCache: new Map() };

  function setRoot(path) {
    const next = (path || '').replace(/\/+$/, '');
    if (next !== rootState.path) {
      rootState.path = next;
      rootState.hueCache.clear();
    }
  }

  function branchOf(path) {
    let rel = path || '';
    if (rootState.path && rel.startsWith(rootState.path)) rel = rel.slice(rootState.path.length);
    rel = rel.replace(/^\/+/, '');
    if (!rel) return path || '/';
    const slash = rel.indexOf('/');
    return slash === -1 ? rel : rel.slice(0, slash);
  }

  const mode = { color: 'type' };

  function colorFor(node, depth) {
    // Named `category`, not `cat`: `cat()` is the mode-aware palette accessor
    // and a local called `cat` shadows it into "call a string".
    const category = categoryOf(node);
    if (mode.color === 'folder' || category === 'folder') {
      const branch = branchOf(node.p);
      let hue = rootState.hueCache.get(branch);
      if (hue === undefined) {
        hue = hueOf(branch);
        // Nudge neighbours apart: hashes of similar short names can land close
        // together, and adjacent folders in a treemap need to be tellable apart.
        // Pick the hue that keeps the most distance from every hue already in
        // use. Stepping by a fixed angle instead can land right on top of an
        // existing branch, and two adjacent folders sharing a colour makes the
        // map unreadable.
        const n = rootState.hueCache.size;
        if (n && n <= 240) {
          // Beyond a couple of hundred branches no assignment can keep them
          // apart anyway, so stop paying for the search.
          const want = Math.max(6, Math.min(30, 300 / (n + 1)));
          let bestHue = hue, bestScore = -1;
          for (let cand = 0; cand < 360; cand++) {
            let minD = 360;
            for (const h of rootState.hueCache.values()) {
              const d = Math.abs(((h - cand + 540) % 360) - 180);
              if (d < minD) { minD = d; if (minD === 0) break; }
            }
            if (minD > bestScore) { bestScore = minD; bestHue = cand; }
            if (minD >= want) break;
          }
          hue = bestHue;
        }
        rootState.hueCache.set(branch, hue);
        if (rootState.hueCache.size > 4000) rootState.hueCache.clear();
      }
      if (modeState.mode === 'light') {
        // On white, a 34% lightness fill reads as mud. Go darker and keep the
        // saturation up so adjacent folders stay separable.
        const sat = Math.max(34, 62 - depth * 6);
        const light = Math.max(38, 54 - depth * 5);
        return `hsl(${hue} ${sat}% ${light}%)`;
      }
      const sat = Math.max(26, 58 - depth * 7);
      const light = Math.min(72, 34 + depth * 7);
      return `hsl(${hue} ${sat}% ${light}%)`;
    }
    const base = cat()[category] || cat().other;
    if (!isDir(node)) return base;
    return base;
  }

  function setColorMode(m) { mode.color = m; }

  // ---------------------------------------------------------------- canvas

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Lighten/darken a hex or hsl string by mixing toward white/black.
  function shade(color, amount) {
    let r, g, b;
    if (color.startsWith('#')) {
      const h = color.slice(1);
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    } else {
      const m = color.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/);
      if (!m) return color;
      return `hsl(${m[1]} ${m[2]}% ${Math.max(4, Math.min(92, parseFloat(m[3]) + amount))}%)`;
    }
    const t = amount > 0 ? 255 : 0;
    const a = Math.abs(amount) / 100;
    r = Math.round(r + (t - r) * a);
    g = Math.round(g + (t - g) * a);
    b = Math.round(b + (t - b) * a);
    return `rgb(${r},${g},${b})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function contrastText(color) {
    // Approximate perceived luminance; hsl strings are parsed for lightness.
    if (color.startsWith('#')) {
      const h = color.slice(1);
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10141a' : '#f2f6fa';
    }
    const m = color.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    if (m) return parseFloat(m[3]) > 62 ? '#10141a' : '#f2f6fa';
    return '#f2f6fa';
  }

  /* Deepest level actually present in a pruned subtree. Depth-based layouts
   * (flame, sunburst) use this to size their bands to the data they were
   * given -- relying on a fixed cap leaves the view half empty whenever the
   * server prunes shallower than requested. */
  function depthOf(node, cap) {
    let best = 0;
    const walk = (n, d) => {
      if (d >= cap) return;
      // Measure the tree as drawn, i.e. after generic wrappers are collapsed.
      // Measuring the raw tree sizes the bands for levels that never appear,
      // which leaves the chart thin and half empty.
      const kids = (n.ch || []).filter((c) => c.d > 0).map(unwrap);
      if (!kids.length) return;
      if (d + 1 > best) best = d + 1;
      for (const k of kids) walk(k, d + 1);
    };
    walk(node, 0);
    return best;
  }

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid + 1;
      else hi = mid;
    }
    return text.slice(0, Math.max(0, lo - 1)) + '…';
  }

  // ==================================================================
  // 1. Treemap -- squarified
  // ==================================================================

  /* Directory names that carry no information on their own. Every macOS app
   * bundle is <App>.app/Contents/..., so without collapsing these the entire
   * map reads "Contents". */
  const GENERIC_DIRS = new Set(['contents', 'versions', '_codesignature']);

  /* Follow a chain of generic single-child folders down to something worth
   * naming, keeping the outermost name. Google Chrome.app -> Contents -> …
   * becomes "Google Chrome.app" holding MacOS, Frameworks, Resources. */
  function unwrap(node) {
    let cur = node;
    for (let guard = 0; guard < 8; guard++) {
      const kids = (cur.ch || []).filter((c) => c.d > 0);
      if (kids.length !== 1) break;
      const only = kids[0];
      if (!(only.f & 1)) break;                       // must be a directory
      if (only.d < cur.d * 0.98) break;               // must hold ~all of it
      if (!GENERIC_DIRS.has((only.n || '').toLowerCase())) break;
      // Keep the outer identity (id, name, path) but adopt the inner contents,
      // so clicking still selects the app you can see.
      cur = { ...cur, ch: only.ch, d: only.d, s: only.s, c: only.c, dc: only.dc };
    }
    return cur;
  }

  /* Last line of defence for every view: never draw a bare container name as a
   * label. Even after unwrapping, a folder legitimately called "Contents" that
   * has several children would otherwise fill the screen with the word. */
  function labelFor(node) {
    const n = node && node.n ? String(node.n) : '';
    if (!n || node.aggregate) return '';
    if (GENERIC_DIRS.has(n.toLowerCase())) return '';
    return n;
  }

  const treemap = {
    actions: { zoom: true, hover: true, labels: true },
    items: [],
    _layout: [],

    _squarify(nodes, x, y, w, h) {
      const out = [];
      const total = nodes.reduce((s, n) => s + n.value, 0);
      if (total <= 0 || w <= 0 || h <= 0) return out;
      const scale = (w * h) / total;
      const items = nodes.map((n) => ({ node: n.node, area: Math.max(n.value * scale, 1e-6) }));

      let rx = x, ry = y, rw = w, rh = h;
      let i = 0;

      const worst = (row, side, rowArea) => {
        let max = -Infinity, min = Infinity;
        for (const r of row) { if (r.area > max) max = r.area; if (r.area < min) min = r.area; }
        const s2 = rowArea * rowArea, l2 = side * side;
        return Math.max((l2 * max) / s2, s2 / (l2 * Math.min(min, 1e-9)));
      };

      while (i < items.length) {
        const side = Math.min(rw, rh);
        const row = [];
        let rowArea = 0, best = Infinity;

        while (i + row.length < items.length) {
          const cand = items[i + row.length];
          const testArea = rowArea + cand.area;
          const testRow = row.concat([cand]);
          const ratio = worst(testRow, side, testArea);
          if (row.length > 0 && ratio > best) break;
          best = ratio;
          row.push(cand);
          rowArea = testArea;
        }

        if (!row.length) break;

        if (rw >= rh) {
          const colW = rowArea / rh;
          let cy = ry;
          for (const r of row) {
            const cellH = r.area / colW;
            out.push({ node: r.node, x: rx, y: cy, w: colW, h: cellH });
            cy += cellH;
          }
          rx += colW;
          rw -= colW;
        } else {
          const rowH = rowArea / rw;
          let cx = rx;
          for (const r of row) {
            const cellW = r.area / rowH;
            out.push({ node: r.node, x: cx, y: ry, w: cellW, h: rowH });
            cx += cellW;
          }
          ry += rowH;
          rh -= rowH;
        }
        i += row.length;
      }
      return out;
    },

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const pad = 2;
      const items = [];
      const depth = opts.depth || 0;

      const kids = (focus.ch || []).filter((c) => c.d > 0);
      if (!kids.length) { this.items = []; this._layout = []; return; }

      // Recurse a couple of levels so the map reads as a hierarchy rather than
      // one flat grid of the root's children.
      const draw = (node, x, y, wd, ht, lvl) => {
        const cs = (node.ch || []).filter((c) => c.d > 0).map(unwrap);
        if (lvl >= (opts.levels || 2) || !cs.length) return;
        const rects = this._squarify(cs.map((c) => ({ node: c, value: c.d })), x, y, wd, ht);
        for (const r of rects) {
          const inner = {
            x: r.x + pad, y: r.y + pad,
            w: Math.max(0, r.w - pad * 2), h: Math.max(0, r.h - pad * 2),
          };
          const hasKids = (r.node.ch || []).some((c) => c.d > 0);
          const expands = hasKids && inner.w > 24 && inner.h > 20;
          items.push({ ...inner, node: r.node, level: lvl, depth, leaf: !expands });
          if (expands) draw(r.node, inner.x, inner.y, inner.w, inner.h, lvl + 1);
        }
      };

      draw(unwrap(focus), 0, 0, w, h, 0);

      const hovered = opts.hover;
      const isAncestor = (it) => hovered && hovered.p && it.node.p &&
        (hovered.p === it.node.p || hovered.p.startsWith(it.node.p === '/' ? it.node.p : it.node.p + '/'));

      const ordered = items.slice().sort((a, b) => a.level - b.level);

      for (const it of ordered) {
        const { x, y, w: iw, h: ih, node, level } = it;
        if (iw <= 0 || ih <= 0) continue;
        const base = colorFor(node, depth + level);
        const dim = hovered && !isAncestor(it) && hovered.i !== node.i;
        ctx.globalAlpha = dim ? 0.34 : 1;
        ctx.fillStyle = shade(base, level === 0 ? 4 : level === 1 ? -2 : -8);
        roundRect(ctx, x, y, iw, ih, level === 0 ? 3 : 2);
        ctx.fill();

        if (hovered && hovered.i === node.i) {
          ctx.strokeStyle = ink().center;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (level === 0) {
          ctx.strokeStyle = ink().seamSoft;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
      }

      /* Labels go on last and largest-first, so the biggest cells claim the
       * names you actually recognise and smaller ones fill the gaps. Labelling
       * only the deepest level -- the obvious implementation -- makes an app
       * folder read "Contents, Contents, Contents", because that is what the
       * deepest level nearly always is. */
      const drawn = [];
      if (opts.labels !== false) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const claimed = [];
        const overlaps = (x, y, wd, ht) => claimed.some(
          (r) => !(x + wd < r.x || x > r.x2 || y + ht < r.y || y > r.y2));

        const byArea = items.slice().sort((a, b) => b.w * b.h - a.w * a.h);
        for (const it of byArea) {
          if (it.w < 46 || it.h < 17) continue;
          if (!labelFor(it.node)) continue;
          const dim2 = hovered && !isAncestor(it) && hovered.i !== it.node.i;
          const twoLine = it.h >= 31;

          ctx.font = '600 11px ui-sans-serif, -apple-system, system-ui, sans-serif';
          const name = ellipsize(ctx, labelFor(it.node), it.w - 12);
          const textW = ctx.measureText(name).width;
          if (textW + 12 > it.w) continue;
          const boxH = twoLine ? 27 : 15;
          if (overlaps(it.x + 3, it.y + 2, textW + 8, boxH)) continue;

          const base2 = colorFor(it.node, depth + it.level);
          ctx.globalAlpha = dim2 ? 0.4 : 1;
          // A soft shadow keeps the text readable over any fill colour, which
          // matters now that labels sit on top of nested rectangles.
          ctx.shadowColor = ink().shadow;
          ctx.shadowBlur = 3;
          ctx.fillStyle = contrastText(shade(base2, -8));
          ctx.fillText(name, it.x + 6, it.y + 13);
          if (twoLine) {
            ctx.font = '400 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
            ctx.globalAlpha = (dim2 ? 0.4 : 1) * 0.8;
            ctx.fillText(human(it.node.d), it.x + 6, it.y + 25);
          }
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          claimed.push({ x: it.x + 3, y: it.y + 2, x2: it.x + textW + 11, y2: it.y + 2 + boxH });
          drawn.push(labelFor(it.node));
        }
      }
      this.labels = drawn;

      this.items = items;
      this._layout = items;
    },

    hit(x, y) {
      // Smallest containing cell wins, so nested cells take priority.
      let best = null;
      for (const it of this.items) {
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
          if (!best || it.w * it.h < best.w * best.h) best = it;
        }
      }
      return best ? best.node : null;
    },
  };

  // ==================================================================
  // 2. Sunburst -- rings radiating from the root
  // ==================================================================

  const sunburst = {
    actions: { zoom: true, hover: true, labels: true },
    items: [],

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const cx = w / 2, cy = h / 2;
      const maxR = Math.min(w, h) / 2 - 8;
      const maxDepth = Math.max(2, depthOf(focus, Math.max(1, opts.depth || 4)));
      const inner = Math.max(38, maxR * (maxDepth > 3 ? 0.17 : 0.26));
      const band = (maxR - inner) / maxDepth;
      const items = [];

      const total = focus.d || 1;
      // A flat sweep of the root's share, so the root ring is complete and the
      // remaining rings are proportional to it.
      const layout = (node, a0, a1, level, startAngle) => {
        if (node !== focus) {
          items.push({ node, a0, a1, r0: inner + (level - 1) * band, r1: inner + level * band, level });
        }
        if (level >= maxDepth) return;
        const kids = (node.ch || []).filter((c) => c.d > 0).map(unwrap);
        if (!kids.length) return;
        const sum = kids.reduce((s, c) => s + c.d, 0) || 1;
        let a = a0;
        const span = a1 - a0;
        for (const k of kids) {
          const share = (k.d / sum) * span;
          if (share < 0.0016) { a += share; continue; }
          layout(k, a, a + share, level + 1, a);
          a += share;
        }
      };

      layout(unwrap(focus), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, 0, -Math.PI / 2);

      const hovered = opts.hover;
      const isAncestor = (node) => hovered && (hovered.i === node.i ||
        (hovered.p && node.p && (hovered.p === node.p || hovered.p.startsWith(node.p + '/'))));

      ctx.clearRect(0, 0, w, h);

      for (const it of items) {
        const { node, a0, a1, r0, r1, level } = it;
        const dim = hovered && !isAncestor(node);
        ctx.globalAlpha = dim ? 0.28 : 1;
        const color = colorFor(node, level);
        ctx.beginPath();
        ctx.arc(cx, cy, r1, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = ink().seam;
        ctx.lineWidth = 1;
        ctx.stroke();

        if (hovered && hovered.i === node.i) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }

        if (opts.labels !== false && level <= 2 && labelFor(node)) {
          const mid = (a0 + a1) / 2;
          const arcLen = (a1 - a0) * ((r0 + r1) / 2);
          if (arcLen > 46 && (r1 - r0) > 13) {
            ctx.save();
            ctx.globalAlpha = dim ? 0.3 : 0.95;
            ctx.translate(cx, cy);
            ctx.rotate(mid);
            ctx.font = '600 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
            ctx.fillStyle = contrastText(color);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(ellipsize(ctx, labelFor(node), r1 - r0 - 8), r1 - 4, 0);
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
      }

      // Centre disc doubles as the way back up one level.
      ctx.beginPath();
      ctx.arc(cx, cy, inner - 2, 0, Math.PI * 2);
      ctx.fillStyle = ink().disc;
      ctx.fill();
      ctx.strokeStyle = ink().discRim;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = ink().center;
      ctx.font = '600 12px ui-sans-serif, -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = focus.n || 'root';
      ctx.fillText(ellipsize(ctx, name, inner * 1.8), cx, cy - 8);
      ctx.font = '400 11px ui-sans-serif, -apple-system, system-ui, sans-serif';
      ctx.fillStyle = ink().centerDim;
      ctx.fillText(human(focus.d), cx, cy + 8);

      this.items = items;
    },

    hit(x, y) {
      const canvas = document.getElementById('viz');
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (!this.items.length) return null;
      let ang = Math.atan2(dy, dx);
      for (const it of this.items) {
        if (r >= it.r0 && r <= it.r1 && ang >= it.a0 && ang <= it.a1) return it.node;
      }
      return null;
    },
  };

  // ==================================================================
  // 3. Flame -- depth top to bottom, size left to right
  // ==================================================================

  const flame = {
    actions: { zoom: true, hover: true, labels: true },
    items: [],

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const maxDepth = Math.max(2, depthOf(focus, Math.max(1, opts.depth || 6)));
      // Bands stretch to fill the stage, but stay within a range that keeps a
      // two-level tree from producing absurd slabs and a deep one from
      // collapsing into unreadable slivers.
      const levelH = Math.min(84, Math.max(18, (h - 6) / maxDepth));
      const items = [];

      const walk = (node, x, wd, level, parentTotal) => {
        if (level >= maxDepth || wd < 1) return;
        const kids = (node.ch || []).filter((c) => c.d > 0).map(unwrap);
        if (!kids.length) return;
        const sum = kids.reduce((s, c) => s + c.d, 0) || 1;
        const usable = wd;
        let cx = x;
        for (const k of kids) {
          const kw = Math.max(0.6, (k.d / sum) * usable);
          items.push({
            node: k, x: cx, y: level * levelH, w: kw, h: levelH - 2, level,
          });
          walk(k, cx, kw, level + 1, k.d);
          cx += kw;
        }
      };

      walk(unwrap(focus), 0, w, 0, focus.d || 1);

      const hovered = opts.hover;
      const isAncestor = (node) => hovered && (hovered.i === node.i ||
        (hovered.p && node.p && (hovered.p === node.p || hovered.p.startsWith(node.p + '/'))));

      for (const it of items) {
        const { node, x, y, w: iw, h: ih, level } = it;
        const dim = hovered && !isAncestor(node);
        ctx.globalAlpha = dim ? 0.3 : 1;
        const color = colorFor(node, level);
        ctx.fillStyle = color;
        roundRect(ctx, x + 0.5, y, Math.max(0.5, iw - 1), ih, 2);
        ctx.fill();
        if (hovered && hovered.i === node.i) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        if (opts.labels !== false && iw > 46 && ih > 12 && labelFor(node)) {
          ctx.font = '600 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
          ctx.fillStyle = contrastText(color);
          ctx.textBaseline = 'middle';
          const label = ellipsize(ctx, labelFor(node), iw - 8);
          ctx.fillText(label, x + 4, y + ih / 2 + 0.5);
        }
        ctx.globalAlpha = 1;
      }

      // Depth guides on the left, so the vertical axis is legible.
      ctx.font = '400 9px ui-sans-serif, -apple-system, system-ui, sans-serif';
      for (let d = 1; d < maxDepth; d++) {
        const y = d * levelH;
        if (y > h - 4) break;
        ctx.strokeStyle = ink().grid;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      this.items = items;
      this._levelH = levelH;
    },

    hit(x, y) {
      let best = null;
      for (const it of this.items) {
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
          if (!best || it.level > best.level) best = it;
        }
      }
      return best ? best.node : null;
    },
  };

  // ==================================================================
  // 4. Bubbles -- nested circles
  // ==================================================================

  function packChildren(items, containerR) {
    // Deterministic spiral packing. Items arrive sorted largest-first; each is
    // walked outward along an Archimedean spiral until it clears every circle
    // already placed and still fits inside the parent.
    const placed = [];
    for (const it of items) {
      if (!placed.length) { placed.push({ ...it, x: 0, y: 0 }); continue; }
      const ref = placed[0].r + it.r;
      let found = null;
      const maxT = 900;
      for (let t = 1; t <= maxT; t++) {
        const ang = t * 0.55;
        const rad = ref * 0.42 * Math.sqrt(t) * 0.62;
        const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
        if (Math.hypot(x, y) + it.r > containerR + 0.5) {
          if (rad > containerR * 2.2) break;
          continue;
        }
        let ok = true;
        for (const p of placed) {
          if (Math.hypot(x - p.x, y - p.y) < p.r + it.r - 0.5) { ok = false; break; }
        }
        if (ok) { found = { x, y }; break; }
      }
      placed.push({ ...it, x: found ? found.x : 0, y: found ? found.y : 0 });
    }
    return placed;
  }

  const bubbles = {
    actions: { zoom: true, hover: true, labels: true },
    items: [],

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const maxDepth = Math.min(3, opts.depth || 2);
      const items = [];
      const rootR = Math.min(w, h) / 2 - 10;

      // Radius follows the square root of bytes, so area stays proportional to
      // size -- the only mapping where a bubble twice as wide really is twice
      // as big.
      const layout = (node, cx, cy, r, level) => {
        if (level >= maxDepth) return;
        const kids = (node.ch || []).filter((c) => c.d > 0).map(unwrap);
        if (!kids.length) return;
        const sum = kids.reduce((s, c) => s + c.d, 0) || 1;
        const avail = r * 0.94;
        const sized = kids.map((k) => ({
          node: k,
          r: Math.max(2, Math.sqrt(k.d / sum) * avail * 0.92),
        }));
        sized.sort((a, b) => b.r - a.r);
        const placed = packChildren(sized, avail);
        for (const p of placed) {
          const px = cx + p.x, py = cy + p.y;
          items.push({ node: p.node, x: px, y: py, r: p.r, level });
          if (p.r > 14) layout(p.node, px, py, p.r, level + 1);
        }
      };

      items.push({ node: focus, x: w / 2, y: h / 2, r: rootR, level: -1, isRoot: true });
      layout(unwrap(focus), w / 2, h / 2, rootR, 0);

      const hovered = opts.hover;
      const isAncestor = (node) => hovered && (hovered.i === node.i ||
        (hovered.p && node.p && (hovered.p === node.p || hovered.p.startsWith(node.p + '/'))));

      const ordered = items.slice().sort((a, b) => b.r - a.r);
      for (const it of ordered) {
        const dim = hovered && !isAncestor(it.node);
        ctx.globalAlpha = dim ? 0.25 : 1;
        const color = it.isRoot ? ink().disc : colorFor(it.node, it.level + 1);
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = hovered && hovered.i === it.node.i ? ink().center : ink().seamSoft;
        ctx.lineWidth = hovered && hovered.i === it.node.i ? 2 : 1;
        ctx.stroke();

        if (opts.labels !== false && it.r > 26 && !it.isRoot && labelFor(it.node)) {
          ctx.font = '600 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
          ctx.fillStyle = contrastText(color);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = ellipsize(ctx, labelFor(it.node), it.r * 1.7);
          ctx.fillText(label, it.x, it.y - (it.r > 44 ? 7 : 0));
          if (it.r > 44) {
            ctx.font = '400 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
            ctx.globalAlpha = (dim ? 0.25 : 1) * 0.8;
            ctx.fillText(human(it.node.d), it.x, it.y + 8);
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
      this.items = items.filter((i) => !i.isRoot);
    },

    hit(x, y) {
      let best = null;
      for (const it of this.items) {
        if (Math.hypot(x - it.x, y - it.y) <= it.r) {
          if (!best || it.r < best.r) best = it;
        }
      }
      return best ? best.node : null;
    },
  };

  // ==================================================================
  // 5. Mind map -- radial branches weighted by size
  // ==================================================================

  const mindmap = {
    actions: { zoom: true, hover: true, labels: true },
    items: [],
    _edges: [],

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const maxDepth = Math.min(3, opts.depth || 2);
      const cx = w * 0.30, cy = h / 2;
      const maxR = Math.min(w * 0.62, h / 2) - 30;
      const items = [];
      const edges = [];

      const rootR = Math.max(16, Math.min(46, Math.sqrt(focus.d || 1) / 900));
      items.push({ node: focus, x: cx, y: cy, r: rootR, level: 0, isRoot: true });

      const layout = (node, nx, ny, a0, a1, level) => {
        if (level >= maxDepth) return;
        const kids = (node.ch || []).filter((c) => c.d > 0).map(unwrap);
        if (!kids.length) return;
        const sum = kids.reduce((s, c) => s + c.d, 0) || 1;
        const ringR = (level + 1) * (maxR / maxDepth);
        let a = a0;
        const span = a1 - a0;
        for (const k of kids) {
          const share = (k.d / sum) * span;
          const mid = a + share / 2;
          const px = cx + Math.cos(mid) * ringR;
          const py = cy + Math.sin(mid) * ringR;
          const pr = Math.max(3.5, Math.min(26, Math.sqrt(k.d / sum) * (ringR * 0.34) + 3));
          items.push({ node: k, x: px, y: py, r: pr, level: level + 1 });
          edges.push({ x1: nx, y1: ny, x2: px, y2: py, level: level + 1, node: k, parent: node });
          layout(k, px, py, mid - share / 2, mid + share / 2, level + 1);
          a += share;
        }
      };

      layout(unwrap(focus), cx, cy, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, 0);

      const hovered = opts.hover;
      const isAncestor = (node) => hovered && (hovered.i === node.i ||
        (hovered.p && node.p && (hovered.p === node.p || hovered.p.startsWith(node.p + '/'))));

      // Links first, so nodes sit on top of them.
      for (const e of edges) {
        const dim = hovered && !isAncestor(e.node);
        ctx.globalAlpha = dim ? 0.18 : 0.6;
        const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.quadraticCurveTo(mx, my, e.x2, e.y2);
        ctx.strokeStyle = colorFor(e.node, e.level);
        ctx.lineWidth = Math.max(0.8, Math.min(7, Math.log2((e.node.d || 1) / 4096 + 1)));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const ordered = items.slice().sort((a, b) => a.level - b.level);
      for (const it of ordered) {
        const dim = hovered && !isAncestor(it.node);
        ctx.globalAlpha = dim ? 0.25 : 1;
        const color = it.isRoot ? ink().discRim : colorFor(it.node, it.level);
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = hovered && hovered.i === it.node.i ? ink().center : ink().seamSoft;
        ctx.lineWidth = hovered && hovered.i === it.node.i ? 2 : 1;
        ctx.stroke();

        if (opts.labels !== false && it.level <= 2 && labelFor(it.node)) {
          ctx.font = '600 10px ui-sans-serif, -apple-system, system-ui, sans-serif';
          ctx.fillStyle = ink().label;
          ctx.textAlign = it.x >= cx ? 'left' : 'right';
          ctx.textBaseline = 'middle';
          const offset = it.x >= cx ? it.r + 5 : -it.r - 5;
          ctx.fillText(ellipsize(ctx, labelFor(it.node), 120), it.x + offset, it.y);
          ctx.fillStyle = ink().labelDim;
          ctx.font = '400 9px ui-sans-serif, -apple-system, system-ui, sans-serif';
          ctx.fillText(human(it.node.d), it.x + offset, it.y + 11);
        }
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';

      if (opts.labels !== false) {
        ctx.font = '600 12px ui-sans-serif, -apple-system, system-ui, sans-serif';
        ctx.fillStyle = ink().center;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ellipsize(ctx, labelFor(focus) || 'root', rootR * 1.9), cx, cy);
        ctx.textAlign = 'left';
      }

      this.items = items;
      this._edges = edges;
    },

    hit(x, y) {
      let best = null;
      for (const it of this.items) {
        if (Math.hypot(x - it.x, y - it.y) <= Math.max(it.r, 6)) {
          if (!best || it.r < best.r) best = it;
        }
      }
      return best ? best.node : null;
    },
  };

  // ==================================================================
  // 6. Folder / directory breakdown is rendered in the DOM (see app.js)
  // ==================================================================

  // ==================================================================
  // 7. Age map -- bytes by last-modified date
  // ==================================================================

  const agemap = {
    actions: { hover: true, labels: true },
    items: [],

    render(canvas, focus, opts) {
      const { ctx, w, h } = setupCanvas(canvas);
      const data = opts.buckets || [];
      const items = [];

      if (!data.length) {
        ctx.fillStyle = ink().empty;
        ctx.font = '13px ui-sans-serif, -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No dated files in this selection.', w / 2, h / 2);
        ctx.textAlign = 'left';
        this.items = [];
        return;
      }

      const padL = 62, padR = 14, padT = 16, padB = 34;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      const maxV = Math.max(...data.map((d) => d.bytes)) || 1;
      const niceMax = maxV * 1.12;
      const logScale = !!opts.logScale;
      // Byte counts across a drive are wildly skewed -- one recent bucket
      // routinely dwarfs a decade of history. Log mode keeps the tail legible.
      const scale = (v) => (logScale ? Math.log(1 + v) / Math.log(1 + niceMax) : v / niceMax);

      // Horizontal grid + byte labels.
      ctx.font = '10px ui-sans-serif, -apple-system, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const y = padT + (plotH * i) / 4;
        const frac = 1 - i / 4;
        const val = logScale ? Math.exp(Math.log(1 + niceMax) * frac) - 1 : niceMax * frac;
        ctx.strokeStyle = ink().grid;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(y) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = ink().empty;
        ctx.textAlign = 'right';
        ctx.fillText(val >= 1 ? human(val, 0) : '0', padL - 8, y);
      }
      ctx.textAlign = 'left';

      const bw = plotW / data.length;
      const barW = Math.max(1, bw * 0.82);
      const now = Date.now() / 1000;

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const x = padL + i * bw + (bw - barW) / 2;
        const bh = scale(d.bytes) * plotH;
        const y = padT + plotH - bh;

        // Recent buckets read warm, old ones cool -- the same idea as the
        // "Big & Untouched" list, expressed as colour.
        const ageYears = Math.max(0, (now - d.t) / (86400 * 365));
        const t = Math.min(1, ageYears / 4);
        const hue = 190 - t * 190;
        const lum = modeState.mode === 'light' ? 46 + t * 4 : 58 - t * 6;
        const color = `hsl(${hue} ${66 - t * 18}% ${lum}%)`;

        const hit = { node: null, x: padL + i * bw, y: padT, w: bw, h: plotH, bucket: d };
        items.push(hit);

        if (d.bytes > 0) {
          ctx.fillStyle = color;
          roundRect(ctx, x, y, barW, Math.max(1.5, bh), 2);
          ctx.fill();
          if (opts.hover && opts.hover.bucket === d) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = ink().grid;
          ctx.fillRect(x, padT + plotH - 1.5, barW, 1.5);
        }
      }

      // X labels, thinned so they never collide.
      ctx.font = '10px ui-sans-serif, -apple-system, system-ui, sans-serif';
      ctx.fillStyle = ink().empty;
      ctx.textAlign = 'center';
      const every = Math.max(1, Math.ceil((data.length * 58) / plotW));
      for (let i = 0; i < data.length; i += every) {
        const d = data[i];
        const x = padL + i * bw + bw / 2;
        ctx.fillText(d.label, x, padT + plotH + 14);
      }
      ctx.textAlign = 'left';

      this.items = items;
    },

    hit(x, y) {
      for (const it of this.items) {
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
      }
      return null;
    },
  };

  // ==================================================================
  // 8. Top sizes is a DOM list (see app.js)
  // ==================================================================

  const API = {
    treemap, sunburst, flame, bubbles, mindmap, agemap,
    human, pctOf, relTime, colorFor, categoryOf, CAT_LABEL,
    catColor: (k) => cat()[k] || cat().other,
    setColorMode, setRoot, setMode, ink, CAT_COLOR, isDir, isLink, shade, ellipsize, contrastText, branchOf,
  };
  // A top-level const never lands on window, which makes it invisible to the
  // theme board, tests and devtools. Expose it explicitly.
  window.Viz = API;
  return API;
})();
