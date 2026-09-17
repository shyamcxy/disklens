// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 DiskLens contributors
/* DiskLens application shell. */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    }
    for (const kid of [].concat(kids)) {
      if (kid === null || kid === undefined || kid === false || kid === '') continue;
      // Strings become text nodes so call sites can pass bare labels.
      n.appendChild(typeof kid === 'object' || typeof kid === 'function'
        ? kid
        : document.createTextNode(String(kid)));
    }
    return n;
  };

  const human = Viz.human;
  const pctOf = Viz.pctOf;

  // ---------------------------------------------------------------- icons

  const ico = (d, size = 15) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = d;
    return s;
  };

  const ICON = {
    treemap: '<rect x="3" y="3" width="8" height="12" rx="1"/><rect x="13" y="3" width="8" height="7" rx="1"/><rect x="13" y="12" width="8" height="9" rx="1"/><rect x="3" y="17" width="8" height="4" rx="1"/>',
    sunburst: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3v5.6M12 15.4V21M3 12h5.6M15.4 12H21"/>',
    flame: '<path d="M4 5h16M4 9h10M4 13h7M4 17h13"/>',
    bubbles: '<circle cx="9" cy="9" r="5"/><circle cx="17" cy="15" r="4"/><circle cx="8" cy="17.5" r="2.6"/>',
    mindmap: '<circle cx="5" cy="12" r="2.6"/><circle cx="19" cy="6" r="2.4"/><circle cx="19" cy="18" r="2.4"/><path d="M7.4 11l9.3-4.2M7.4 13l9.3 4.2"/>',
    folders: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    topsizes: '<path d="M4 6h16M4 11h11M4 16h7M4 21h4"/>',
    agemap: '<path d="M3 20h18M6 20V9M11 20V4M16 20v-8M21 20v-5"/>',
    quickwins: '<path d="M13 2 4.5 13H11l-1 9 8.5-11H12z"/>',
    duplicates: '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 21H5a2 2 0 0 1-2-2V8"/>',
    untouched: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="1.7"/><rect x="14" y="3" width="7" height="7" rx="1.7"/><rect x="3" y="14" width="7" height="7" rx="1.7"/><rect x="14" y="14" width="7" height="7" rx="1.7"/>',
    snapshots: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/>',
    cleanup: '<path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l1 12.1A1.5 1.5 0 0 0 9 20.5h6a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>',
    reveal: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    open: '<path d="M15 3h6v6M21 3l-9 9M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    scan: '<circle cx="12" cy="12" r="9"/><path d="M12 12V4.5"/><path d="M12 12l6.2 4.3"/>',
    outline: '<path d="M4 6h4M4 12h9M4 18h14"/><path d="M4 6v12"/>',
    disk: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3v6M12 15v6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  // ---------------------------------------------------------------- state

  /* Embedded previews (the theme board) render six copies at once, so they ask
   * for a much smaller tree. Nothing in a 760px preview needs 9000 nodes. */
  const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1';

  /* Each view pulls the tree shape it actually needs. A treemap reads well at
   * two levels; a flame or sunburst chart *is* its depth, so it needs more.
   * Requesting the same shape for all of them either starves the depth views
   * or wastes bandwidth on the ones that do not care. */
  const VIEWS = [
    { id: 'treemap', label: 'Treemap', icon: ICON.treemap, hint: 'Every file as a rectangle, sized by bytes',
      tree: { depth: 3, children: 28 }, levels: 3 },
    { id: 'sunburst', label: 'Sunburst', icon: ICON.sunburst, hint: 'Rings radiating out from the scan root',
      tree: { depth: 4, children: 26 }, levels: 4 },
    { id: 'flame', label: 'Flame', icon: ICON.flame, hint: 'Depth top to bottom, size left to right',
      tree: { depth: 5, children: 26 }, levels: 5 },
    { id: 'bubbles', label: 'Bubbles', icon: ICON.bubbles, hint: 'Nested bubbles, one per folder',
      tree: { depth: 3, children: 26 }, levels: 3 },
    { id: 'mindmap', label: 'Mind Map', icon: ICON.mindmap, hint: 'Branches from the root, sized by weight',
      tree: { depth: 3, children: 26 }, levels: 3 },
    { id: 'folders', label: 'Folders', icon: ICON.folders, hint: 'Browse folder by folder, sized as you go',
      tree: { depth: 2, children: 44 }, levels: 2 },
    { id: 'topsizes', label: 'Top Sizes', icon: ICON.topsizes, hint: 'The biggest items, ranked',
      tree: { depth: 1, children: 8 }, levels: 1 },
    { id: 'agemap', label: 'Age Map', icon: ICON.agemap, hint: 'Where your bytes sit on a timeline',
      tree: { depth: 2, children: 44 }, levels: 2 },
    { id: 'outline', label: 'Outline', icon: ICON.outline, hint: 'Expand folder after folder, to any depth',
      tree: { depth: 1, children: 1 }, levels: 1 },
  ];

  const DISK_VIEW = { id: 'disk', label: 'Disk', icon: ICON.disk,
    hint: 'Reconcile the whole drive: volumes, and what the scan could not read',
    tree: { depth: 1, children: 1 }, levels: 1 };

  const viewCfg = (id) => VIEWS.find((v) => v.id === id) || VIEWS[0];

  const TOOLS = [
    { id: 'quickwins', label: 'Quick Wins', icon: ICON.quickwins, hint: 'Caches, logs, build artifacts' },
    { id: 'duplicates', label: 'Duplicates', icon: ICON.duplicates, hint: 'Byte-for-byte matching' },
    { id: 'untouched', label: 'Big & Untouched', icon: ICON.untouched, hint: 'Large files you have not opened in a year' },
    { id: 'apps', label: 'Applications', icon: ICON.apps, hint: 'Apps and their leftovers' },
    { id: 'snapshots', label: 'Snapshots', icon: ICON.snapshots, hint: 'Compare a past scan with today' },
    DISK_VIEW,
  ];

  const MANAGE = [{ id: 'cleanup', label: 'Cleanup', icon: ICON.cleanup, hint: 'The staged removal list' }];

  const state = {
    accounting: null,
    scanId: null,
    root: null,
    rootPath: '',
    view: 'treemap',
    focus: null,
    focusDepth: 0,
    trail: [],
    subtree: null,
    hover: null,
    selected: null,
    cleanup: { items: [], total: 0, count: 0 },
    snapshots: [],
    loading: false,
    scanning: false,
    scanError: null,
    savedScans: [],
    outlineOpen: new Set(),
    outlineKids: {},
    outlinePending: {},
    scanListOk: null,
    scanListError: null,
    targetInfo: null,
    usage: null,
    colorMode: 'type',
    ageLog: false,
    sort: { folders: { key: 'd', dir: -1 } },
    cache: {},
  };

  // ------------------------------------------------------------------ api

  /* Every request gets a deadline. Without one, a dropped connection leaves
   * the await pending forever and the UI sits on a spinner with no error and
   * no way out -- which is exactly what six embedded previews did. */
  async function api(path, opts = {}) {
    const { timeoutMs = 30000, ...rest } = opts;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...rest,
        signal: ctl ? ctl.signal : undefined,
        body: rest.body ? JSON.stringify(rest.body) : undefined,
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        const err = new Error(`The server did not answer within ${Math.round(timeoutMs / 1000)}s. It may still be working on something heavy.`);
        err.timeout = true;
        throw err;
      }
      // A bare "Failed to fetch" tells you nothing. This nearly always means
      // the server process is gone, which is a thing you can act on.
      const err = new Error(
        'Cannot reach the DiskLens server — it looks like the process stopped. ' +
        'Start it again (./run.sh in the disklens folder), then reload this page.');
      err.offline = true;
      throw err;
    }
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function toast(msg, kind = '') {
    const t = el('div', { class: `toast ${kind}` }, [el('span', { class: 'dot' }), el('span', { text: msg })]);
    $('#toasts').appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 320);
    }, kind === 'err' ? 6000 : 3200);
  }

  // --------------------------------------------------------------- rail

  function buildRail() {
    const rv = $('#railViews');
    rv.innerHTML = '';
    for (const v of VIEWS) {
      rv.appendChild(el('button', {
        class: `rail-item${state.view === v.id ? ' active' : ''}`,
        'data-view': v.id, title: v.hint,
        onclick: () => setView(v.id),
      }, [
        el('span', { class: 'rail-ico', html: '' }, [ico(v.icon)]),
        el('span', { class: 'label', text: v.label }),
      ]));
    }

    const rt = $('#railTools');
    rt.innerHTML = '';
    for (const v of TOOLS) {
      rt.appendChild(el('button', {
        class: `rail-item${state.view === v.id ? ' active' : ''}`,
        'data-view': v.id, title: v.hint,
        onclick: () => setView(v.id),
      }, [
        el('span', { class: 'rail-ico' }, [ico(v.icon)]),
        el('span', { class: 'label', text: v.label }),
      ]));
    }

    const rm = $('#railManage');
    rm.innerHTML = '';
    const badge = state.cleanup.count
      ? el('span', { class: 'badge good', text: String(state.cleanup.count) }) : null;
    rm.appendChild(el('button', {
      class: `rail-item${state.view === 'cleanup' ? ' active' : ''}`,
      'data-view': 'cleanup', title: MANAGE[0].hint,
      onclick: () => setView('cleanup'),
    }, [
      el('span', { class: 'rail-ico' }, [ico(MANAGE[0].icon)]),
      el('span', { class: 'label', text: MANAGE[0].label }),
      badge,
    ]));

    // Past scans, always listed. Reopening one is instant and never re-walks
    // the filesystem, so this is the escape hatch from re-scanning.
    const rs = $('#railScans');
    rs.innerHTML = '';
    const past = (state.savedScans || []).slice(0, 8);
    if (!past.length) {
      rs.appendChild(el('div', { class: 'rail-note', text: 'None yet' }));
      return;
    }
    for (const s of past) {
      const name = s.path.split('/').filter(Boolean).pop() || s.path;
      const live = s.id === state.scanId;
      const running = s.status === 'scanning' || s.status === 'queued';
      rs.appendChild(el('button', {
        class: `rail-item${live ? ' active' : ''}`,
        title: `${s.path}\n${human(s.total || 0)} · ${(s.nodes || 0).toLocaleString()} items`,
        onclick: () => {
          if (live) { setView('treemap'); return; }
          openSavedScan(s.id);
        },
      }, [
        el('span', { class: 'rail-ico' }, [ico(running ? ICON.scan : ICON.folder)]),
        el('span', { class: 'label', text: name }),
        running ? el('span', { class: 'badge', text: '…' })
          : el('span', { class: 'badge', text: human(s.total || 0) }),
      ]));
    }
  }

  function markRail() {
    document.querySelectorAll('.rail-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
  }

  // --------------------------------------------------------------- views

  const CANVAS_VIEWS = new Set(['treemap', 'sunburst', 'flame', 'bubbles', 'mindmap', 'agemap']);

  function setView(id, opts = {}) {
    state.view = id;
    markRail();
    $('#modalSlot').innerHTML = '';
    if (!opts.keepFocus) { /* focus is preserved across view switches */ }

    const isCanvas = CANVAS_VIEWS.has(id);
    $('#viz').classList.toggle('hidden', !isCanvas);
    $('#colorSeg').classList.toggle('hidden', !isCanvas || id === 'agemap');
    $('#panelSlot').innerHTML = '';
    $('#legend').classList.remove('show');
    // The age map splits the area with a table; every other view gives the
    // canvas the whole stage.
    $('#viz').style.flex = '';
    document.getElementById('ageBelow')?.remove();

    if (!isCanvas) {
      renderPanel();
      return;
    }
    if (id !== 'agemap') buildColorSeg();
    if (!state.scanId) { showScanPrompt(); return; }
    if (id === 'agemap') { renderAge(); return; }
    // Re-fetch at this view's depth: the tree shape a treemap needs is not the
    // shape a flame chart needs.
    loadFocus(state.focus?.i ?? 0, { silent: true }).then((t) => { if (t) draw(); });
  }

  /* The segmented control in the stage header is shared: colour mode for the
   * canvas views, scale for the age map. Rebuild it per view. */
  function buildSeg(pairs, activeValue, onPick) {
    const seg = $('#colorSeg');
    seg.innerHTML = '';
    seg.classList.remove('hidden');
    for (const [label, value] of pairs) {
      seg.appendChild(el('button', {
        class: activeValue === value ? 'on' : '',
        text: label,
        onclick: () => onPick(value),
      }));
    }
  }

  function buildColorSeg() {
    buildSeg([['By type', 'type'], ['By folder', 'folder']], state.colorMode, (mode) => {
      state.colorMode = mode;
      Viz.setColorMode(mode);
      buildColorSeg();
      if (state.subtree) draw();
    });
  }

  function showScanPrompt() {
    const wrap = $('#canvasWrap');
    $('#panelSlot').innerHTML = '';
    document.getElementById('scanPrompt')?.remove();
    if (state.scanError) { showScanError(state.scanError); return; }

    const home = state.targetInfo?.targets?.find((t) => t.label === 'Home folder')?.path
      || ('/Users/' + 'user');
    const kids = [
      ico(ICON.treemap, 34),
      el('div', { class: 'big', text: 'Scan your whole Mac' }),
      el('div', { class: 'lbl', text: 'Every volume and folder in one tree. Nothing is moved or deleted without you confirming it first.' }),
      el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
        el('button', { class: 'btn primary', onclick: () => startScan('/') }, [ico(ICON.scan, 13), el('span', { text: 'Scan entire Mac' })]),
        el('button', { class: 'btn', onclick: openBrowser }, [ico(ICON.folder, 13), el('span', { text: 'Pick a folder or disk' })]),
        el('button', { class: 'btn ghost', onclick: () => startScan(home) }, [ico(ICON.folder, 13), el('span', { text: 'Just my home folder' })]),
      ]),
    ];

    // Past scans are offered up front: reopening one is instant, and it saves
    // walking a tree that has already been walked.
    const past = (state.savedScans || []).filter((s) => s.status === 'ready').slice(0, 6);
    if (past.length) {
      kids.push(el('div', { class: 'recent' }, [
        el('div', { class: 'recent-h', text: 'Reopen a recent scan — no re-scan needed' }),
        el('div', { class: 'recent-list' }, past.map((s) => el('button', {
          class: 'target', onclick: () => openSavedScan(s.id),
        }, [
          el('div', { class: 't', text: s.path.split('/').filter(Boolean).pop() || s.path }),
          el('div', { class: 'h', text: `${human(s.total || 0)} · ${(s.nodes || 0).toLocaleString()} items` }),
          el('div', { class: 'p', text: s.path }),
        ]))),
      ]));
    }

    wrap.appendChild(el('div', { class: 'scanbar', id: 'scanPrompt' }, kids));
  }

  /* A scan that failed has to stay on screen with the real reason and a way to
   * try again -- a toast that disappears after three seconds is how you end up
   * re-scanning blind. */
  function showScanError(err) {
    const wrap = $('#canvasWrap');
    $('#panelSlot').innerHTML = '';
    document.getElementById('scanPrompt')?.remove();
    document.getElementById('scanErrorBar')?.remove();
    wrap.appendChild(el('div', { class: 'scanbar', id: 'scanErrorBar' }, [
      ico(ICON.warn, 30),
      el('div', { class: 'big', text: 'That scan did not finish' }),
      el('div', { class: 'lbl', style: 'max-width:640px', text: err.message || 'Unknown error.' }),
      err.path ? el('div', { class: 'cur', text: err.path }) : null,
      err.detail ? el('details', { class: 'errbox' }, [
        el('summary', { text: 'Technical detail' }),
        el('pre', { text: String(err.detail).slice(0, 4000) }),
      ]) : null,
      el('div', { style: 'display:flex;gap:8px;margin-top:4px' }, [
        err.offline
          ? el('button', { class: 'btn primary', onclick: () => location.reload() }, [ico(ICON.history, 13), el('span', { text: 'Reload the page' })])
          : (err.path ? el('button', { class: 'btn primary', onclick: () => startScan(err.path) }, [ico(ICON.scan, 13), el('span', { text: 'Retry' })]) : null),
        el('button', { class: 'btn', text: 'Choose another folder', onclick: openBrowser }),
        el('button', { class: 'btn ghost', text: 'Dismiss', onclick: () => { state.scanError = null; showScanPrompt(); } }),
      ].filter(Boolean)),
    ]));
  }

  // ------------------------------------------------------------- scanning

  async function loadTargets() {
    try {
      state.targetInfo = await api('/api/targets');
    } catch (e) { /* non-fatal */ }
  }

  /* Remember which scan this browser was last looking at, so a reload comes
   * back to it instead of starting from an empty screen. */
  const LAST_KEY = 'disklens.lastScan';

  function rememberScan(id) {
    try {
      if (id) localStorage.setItem(LAST_KEY, id);
      else localStorage.removeItem(LAST_KEY);
    } catch (_) { /* private mode */ }
  }

  function lastScanId() {
    try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; }
  }

  async function refreshScanList() {
    try {
      const d = await api('/api/scans');
      state.savedScans = d.scans || [];
      state.scanListOk = true;
      state.scanListError = null;
    } catch (e) {
      // "There are no scans" and "I could not ask" must not be treated the
      // same. Conflating them is how one dropped request turns into an
      // unrequested full-disk scan.
      state.savedScans = [];
      state.scanListOk = false;
      state.scanListError = e;
    }
    buildRail();
    markRail();
    return state.savedScans;
  }

  /* Reopen a scan that already exists, either in memory or on disk. This is
   * the whole point of persisting them: no second walk of the filesystem. */
  async function openSavedScan(id, { silent } = {}) {
    closeModal();
    document.getElementById('scanPrompt')?.remove();
    document.getElementById('scanErrorBar')?.remove();
    state.scanError = null;
    state.scanning = false;
    showProgress('Opening the saved scan…');
    try {
      const r = await api('/api/scans/open', { method: 'POST', body: { id }, timeoutMs: 120000 });
      if (r.status === 'error') throw new Error(r.error || 'That scan could not be reopened.');
      state.scanId = id;
      state.rootPath = r.path || '';
      state.scanTotal = r.total || null;
      state.usage = null;
      $('#pathInput').value = r.path || '';
      Viz.setRoot(r.path || '');
      rememberScan(id);
      state.cache = {};
      state.trail = [];
      state.subtree = null;
      state.focus = null;
      state.outlineOpen = new Set();
      state.outlineKids = {};
      state.outlinePending = {};
      hideProgress();
      $('#refreshBtn').hidden = false;
      toast(`Reopened ${r.path} — ${(r.nodes || 0).toLocaleString()} items, no re-scan.`, 'ok');
      state.usage = await api(`/api/volumes?path=${encodeURIComponent(r.path || '/')}`);
      updateGauge(state.usage);
      await onScanReady();
    } catch (e) {
      hideProgress();
      rememberScan(null);
      state.scanError = { message: e.message, path: state.rootPath };
      showScanError(state.scanError);
      if (!silent) toast(e.message, 'err');
    }
  }

  /* Called once at startup. Prefers, in order: an explicit ?path=, the scan
   * this browser was last on, then whatever the server still has. */
  async function restoreOrPrompt() {
    const params = new URLSearchParams(location.search);
    const want = params.get('path');
    if (want) { startScan(want); return; }

    // Embedded previews (the theme board) must never kick off a scan: six
    // frames opening at once would each start one.
    const embedded = params.get('embed') === '1';

    const scans = await refreshScanList();

    const remembered = lastScanId();
    if (remembered) {
      const known = scans.find((s) => s.id === remembered);
      if (known && known.status === 'ready') { openSavedScan(remembered, { silent: true }); return; }
      if (known && (known.status === 'scanning' || known.status === 'queued')) {
        // A scan was mid-flight when the page went away: reattach to it.
        state.scanId = remembered;
        state.rootPath = known.path || '';
        $('#pathInput').value = known.path || '';
        state.scanning = true;
        showProgress('Reattaching to the running scan…');
        subscribe(remembered);
        return;
      }
      rememberScan(null);
    }

    // Any usable scan at all: land straight on the newest one. The point is
    // to never open on an empty screen, and never make you choose before you
    // can see anything.
    const ready = scans.filter((s) => s.status === 'ready');
    if (ready.length) { openSavedScan(ready[0].id, { silent: true }); return; }

    // Only start a scan when we positively know there is nothing to reopen.
    // If the list could not be fetched, say so instead of launching a
    // multi-minute whole-disk walk the user never asked for.
    if (!state.scanListOk) {
      state.scanError = {
        message: state.scanListError?.message
          || 'Could not read the list of previous scans, so DiskLens will not start one on its own.',
        path: '/', offline: !!state.scanListError?.offline,
      };
      showScanError(state.scanError);
      return;
    }

    if (embedded) { showScanPrompt(); return; }

    // Truly nothing saved: scan the whole machine rather than asking.
    startScan('/');
  }

  async function startScan(path) {
    if (!path) return;
    path = path.trim();
    if (!path) return;
    $('#pathInput').value = path;
    closeModal();
    document.getElementById('scanPrompt')?.remove();
    document.getElementById('scanErrorBar')?.remove();
    state.scanError = null;

    state.scanning = true;
    state.subtree = null;
    state.cache = {};
    state.focus = null;
    state.trail = [];
    state.selected = null;
    showInspector(null);

    try {
      const { id } = await api('/api/scan', { method: 'POST', body: { path } });
      state.scanId = id;
      state.rootPath = path;
      // Colours key off the branch below the scan root, so the root has to be
      // known before anything is drawn.
      Viz.setRoot(path);
      rememberScan(id);
      showProgress();
      subscribe(id);
    } catch (err) {
      state.scanning = false;
      hideProgress();
      state.scanError = {
        message: err.offline ? err.message : `Could not start the scan: ${err.message}`,
        path, offline: err.offline,
      };
      showScanError(state.scanError);
    }
  }

  function showProgress(label) {
    let bar = document.getElementById('scanProgress');
    if (bar && label) {
      const l = bar.querySelector('.lbl');
      if (l) l.textContent = label;
      $('#spBig').textContent = '…';
      return;
    }
    if (!bar) {
      bar = el('div', { class: 'scanbar', id: 'scanProgress' }, [
        el('div', { class: 'spinner' }),
        el('div', { class: 'big', id: 'spBig', text: '0 files' }),
        el('div', { class: 'lbl', text: 'Walking the tree…' }),
        el('div', { class: 'cur', id: 'spCur', text: '' }),
        el('div', { class: 'stats' }, [
          el('div', {}, [el('div', { class: 'v', id: 'spBytes', text: '0 B' }), el('div', { class: 'k', text: 'Scanned' })]),
          el('div', {}, [el('div', { class: 'v', id: 'spTime', text: '0s' }), el('div', { class: 'k', text: 'Elapsed' })]),
          el('div', {}, [el('div', { class: 'v', id: 'spRate', text: '—' }), el('div', { class: 'k', text: 'Files / sec' })]),
        ]),
        el('button', { class: 'btn small', text: 'Cancel', onclick: () => cancelScan(), style: 'margin-top:8px' }),
      ]);
      $('#canvasWrap').appendChild(bar);
    }
    bar.classList.remove('hidden');
  }

  function hideProgress() {
    document.getElementById('scanProgress')?.remove();
  }

  async function cancelScan() {
    if (!state.scanId) return;
    try { await api('/api/scan/cancel', { method: 'POST', body: { id: state.scanId } }); } catch (_) {}
  }

  function subscribe(id) {
    const es = new EventSource(`/api/scan/${id}/events`);
    const t0 = Date.now();
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.kind === 'progress') {
        $('#spBig').textContent = `${(msg.files || 0).toLocaleString()} files`;
        $('#spBytes').textContent = human(msg.bytes || 0);
        const secs = (Date.now() - t0) / 1000;
        $('#spTime').textContent = `${secs.toFixed(0)}s`;
        const rate = secs > 0.5 ? Math.round((msg.files || 0) / secs) : 0;
        $('#spRate').textContent = rate ? `${rate.toLocaleString()}` : '—';
        const cur = $('#spCur');
        cur.textContent = msg.current || '';
        cur.scrollLeft = cur.scrollWidth;
      } else if (msg.kind === 'status') {
        if (msg.status === 'ready' || msg.status === 'cancelled') {
          es.close();
          state.scanning = false;
          hideProgress();
          state.usage = msg.usage || null;
          state.scanTotal = msg.total || null;
          updateGauge(msg.usage);
          if (msg.status === 'cancelled' && !msg.nodes) {
            rememberScan(null);
            toast('Scan cancelled.');
            showScanPrompt();
            return;
          }
          const note = msg.saved ? ' — saved, so you will not have to scan it again'
                                 : ' (too big to save, so reopening means re-scanning)';
          toast(`Scanned ${(msg.nodes || 0).toLocaleString()} items in ${msg.elapsed}s${note}`, 'ok');
          onScanReady();
        } else if (msg.status === 'error') {
          es.close();
          state.scanning = false;
          hideProgress();
          rememberScan(null);
          state.scanError = {
            message: msg.error || 'The scan stopped unexpectedly.',
            detail: msg.detail, path: state.rootPath,
          };
          showScanError(state.scanError);
        }
      } else if (msg.kind === 'end') {
        es.close();
      }
    };
    // A dropped event stream used to surface as a bare toast, which hid the
    // most common real cause: the server is no longer running.
    es.onerror = async () => {
      es.close();
      if (!state.scanning) return;
      state.scanning = false;
      hideProgress();
      let alive = false;
      try { await api('/api/scans'); alive = true; } catch (_) { alive = false; }
      if (!alive) {
        state.scanError = {
          message: 'Lost the connection to the DiskLens server. If it was stopped or restarted, start it again and reload this page.',
          path: state.rootPath,
        };
        showScanError(state.scanError);
      } else {
        // The server is fine; the scan itself is gone. Offer what still exists.
        await refreshScanList();
        state.scanError = { message: 'The scan stopped before it finished.', path: state.rootPath };
        showScanError(state.scanError);
      }
    };
  }

  async function onScanReady() {
    $('#refreshBtn').hidden = false;
    state.sort.folders = { key: 'd', dir: -1 };
    document.getElementById('scanErrorBar')?.remove();
    state.scanError = null;
    if (CANVAS_VIEWS.has(state.view) && state.view !== 'agemap') {
      await loadFocus(0, { silent: true });
      draw();
    } else {
      renderPanel();
    }
    refreshBadges();
    refreshScanList();
    loadAccounting();
  }

  async function loadFocus(idx, { silent } = {}) {
    if (!state.scanId) return null;
    let cfg = viewCfg(state.view).tree;
    if (EMBEDDED) cfg = { depth: Math.min(cfg.depth, 2), children: Math.min(cfg.children, 20) };
    const budget = EMBEDDED ? 2500 : 9000;
    const key = `${idx}:${cfg.depth}:${cfg.children}:${budget}`;
    if (state.cache[key]) {
      state.subtree = state.cache[key];
      state.focus = state.subtree;
      state.focusDepth = depthOf(state.subtree);
      updateCrumbs();
      return state.subtree;
    }
    if (!silent) state.loading = true;
    try {
      const t = await api(`/api/scan/${state.scanId}/tree?node=${idx}&depth=${cfg.depth}&maxChildren=${cfg.children}&maxNodes=${budget}`);
      state.cache[key] = t;
      if (Object.keys(state.cache).length > 24) {
        const first = Object.keys(state.cache).find((k) => k !== key);
        delete state.cache[first];
      }
      state.subtree = t;
      state.focus = t;
      state.focusDepth = depthOf(t);
      // First load seeds the trail; a re-fetch of the same node just refreshes
      // the entry in place so the breadcrumb keeps its history.
      if (!state.trail.length) state.trail = [t];
      else state.trail[state.trail.length - 1] = t;
      updateCrumbs();
      return t;
    } catch (e) {
      // A scan that has gone away must not leave the UI poking at a dead id.
      if (/no longer available|not found/i.test(e.message)) {
        rememberScan(null);
        state.scanId = null;
        await refreshScanList();
        state.scanError = {
          message: `That scan is no longer available (${e.message}). Reopen one below, or start a new scan.`,
          path: state.rootPath,
        };
        showScanError(state.scanError);
      } else {
        toast(`Could not load: ${e.message}`, 'err');
      }
      return null;
    } finally { state.loading = false; }
  }

  function depthOf(node) {
    if (!state.rootPath || !node?.p) return 0;
    const rel = node.p.slice(state.rootPath.length).replace(/^\/+/, '');
    return rel ? rel.split('/').length : 0;
  }

  /* `trail` is the path from the scan root to whatever is focused right now,
   * so the breadcrumb is exactly this array and its last entry is the current
   * node. Keeping the current node in here is what makes "up" and a click on
   * any crumb the same operation. */
  function zoomTo(node) {
    if (!node || node.i === undefined || node.i < 0) return;
    if (!Viz.isDir(node)) return;
    if (state.focus && node.i === state.focus.i) return;
    const at = state.trail.findIndex((t) => t.i === node.i);
    if (at >= 0) state.trail = state.trail.slice(0, at + 1);
    else state.trail.push(node);
    loadFocus(node.i, { silent: true }).then((t) => {
      if (!t) return;
      updateCrumbs();
      if (state.view === 'agemap') renderAge(); else draw();
    });
  }

  function zoomUp() {
    if (state.trail.length <= 1) return;
    state.trail.pop();
    const target = state.trail[state.trail.length - 1];
    loadFocus(target.i, { silent: true }).then((t) => {
      if (!t) return;
      updateCrumbs();
      if (state.view === 'agemap') renderAge(); else draw();
    });
  }

  function updateCrumbs() {
    const c = $('#crumbs');
    c.innerHTML = '';
    if (!state.trail.length) {
      c.appendChild(el('span', { class: 'crumb last', text: state.rootPath || 'No scan yet' }));
      return;
    }
    state.trail.forEach((h, i) => {
      if (i) c.appendChild(el('span', { class: 'crumb-sep', text: '/' }));
      c.appendChild(el('button', {
        class: `crumb${i === state.trail.length - 1 ? ' last' : ''}`,
        text: h.n || h.p,
        title: h.p,
        onclick: () => {
          state.trail = state.trail.slice(0, i + 1);
          loadFocus(h.i, { silent: true }).then((t) => {
            if (!t) return;
            updateCrumbs();
            if (state.view === 'agemap') renderAge(); else draw();
          });
        },
      }));
    });
    const up = $('#upBtn');
    if (up) up.hidden = state.trail.length <= 1;
    const sub = $('#stageSub');
    if (sub) {
      const head = state.focus
        ? `${human(state.focus.d)} · ${(state.focus.c || 0).toLocaleString()} files`
        : '';
      sub.innerHTML = '';
      sub.appendChild(document.createTextNode(head));
      const note = coverageNote();
      if (note) {
        sub.appendChild(el('button', {
          class: 'coverage', text: note + ' — see where it went',
          title: 'Open the disk accounting',
          onclick: () => setView('disk'),
        }));
      }
    }
  }

  /* The gap between files and the volume total, named properly.
   *
   * This used to blame "APFS snapshots and purgeable space", which was a
   * guess: on this machine there are no local snapshots at all, and most of
   * the difference is other volumes plus folders macOS refuses to open. Never
   * print a cause you have not measured. */
  function coverageNote() {
    const a = state.accounting;
    if (!a || state.rootPath !== '/') return '';
    if (a.gap < (4 << 30)) return '';
    const parts = [];
    if (a.skipped_bytes > 0) parts.push(`${human(a.skipped_bytes)} other volumes`);
    if (a.purgeable_used > 0) parts.push(`${human(a.purgeable_used)} purgeable`);
    if (a.blocked_bytes > 0) parts.push(`${human(a.blocked_bytes)} blocked by macOS`);
    return ` · ${human(a.gap)} not in any file: ${parts.join(' · ')}`;
  }

  async function loadAccounting() {
    if (!state.scanId) return;
    try {
      state.accounting = await api(`/api/scan/${state.scanId}/accounting`);
      updateCrumbs();
    } catch (_) { /* the note simply stays hidden */ }
  }

  // ------------------------------------------------------------- drawing

  function draw(retry) {
    const canvas = $('#viz');
    if (!state.subtree) return;
    // A canvas in a freshly-created iframe, a hidden tab or a collapsed pane
    // measures zero. Painting anyway leaves a 1px sliver that never recovers,
    // so wait a frame and try again instead.
    const box = canvas.getBoundingClientRect();
    if ((box.width < 8 || box.height < 8) && !retry) {
      requestAnimationFrame(() => draw(true));
      return;
    }
    const opts = { hover: state.hover, depth: state.focusDepth, levels: viewCfg(state.view).levels };
    try {
      Viz[state.view].render(canvas, state.subtree, opts);
    } catch (e) {
      console.error(e);
      toast(`Render error: ${e.message}`, 'err');
    }
    updateLegend();
  }

  function updateLegend() {
    const lg = $('#legend');
    if (state.colorMode !== 'type' || !['treemap', 'sunburst', 'flame', 'bubbles'].includes(state.view)) {
      lg.classList.remove('show');
      return;
    }
    lg.innerHTML = '';
    for (const [k, label] of Object.entries(Viz.CAT_LABEL)) {
      if (k === 'system' || k === 'other') continue;
      lg.appendChild(el('span', {}, [
        el('i', { style: `background:${Viz.catColor(k)}` }),
        el('span', { text: label }),
      ]));
    }
    lg.classList.add('show');
  }

  // ------------------------------------------------------------ tooltips

  const tipEl = () => $('#tip');

  function showTip(node, x, y) {
    const t = tipEl();
    const color = Viz.colorFor(node, 0);
    t.innerHTML = '';
    t.appendChild(el('div', { class: 'tt' }, [
      el('span', { style: `display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:7px` }),
      document.createTextNode(node.n),
    ]));
    const total = state.subtree ? state.subtree.d : node.d;
    const rows = [
      ['Size on disk', human(node.d)],
      ['Logical size', human(node.s)],
      ['Share of view', pctOf(node.d, total)],
    ];
    if (Viz.isDir(node)) rows.push(['Files', (node.c || 0).toLocaleString()]);
    rows.push(['Modified', Viz.relTime(node.t)]);
    for (const [k, v] of rows) {
      t.appendChild(el('div', { class: 'tr' }, [el('span', { text: k }), el('b', { text: v })]));
    }
    t.appendChild(el('div', { class: 'tpath', text: node.p }));
    t.classList.add('show');
    positionTip(x, y);
  }

  function positionTip(x, y) {
    const t = tipEl();
    const r = t.getBoundingClientRect();
    let nx = x + 16, ny = y + 16;
    if (nx + r.width > window.innerWidth - 10) nx = x - r.width - 14;
    if (ny + r.height > window.innerHeight - 10) ny = y - r.height - 14;
    t.style.left = `${Math.max(8, nx)}px`;
    t.style.top = `${Math.max(8, ny)}px`;
  }

  function hideTip() { tipEl().classList.remove('show'); }

  // --------------------------------------------------------- canvas input

  function canvasPoint(ev) {
    const r = $('#viz').getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function wireCanvas() {
    const canvas = $('#viz');
    let clickTimer = null;

    canvas.addEventListener('mousemove', (ev) => {
      if (!state.subtree) return;
      const { x, y } = canvasPoint(ev);
      const view = Viz[state.view];
      if (!view || !view.hit) return;

      if (state.view === 'agemap') {
        const hit = view.hit(x, y);
        if (hit) {
          const d = hit.bucket;
          const t = tipEl();
          t.innerHTML = '';
          t.appendChild(el('div', { class: 'tt', text: d.label }));
          for (const [k, v] of [['Bytes', human(d.bytes)], ['Files', d.files.toLocaleString()], ['Share', pctOf(d.bytes, state.subtree.d)]]) {
            t.appendChild(el('div', { class: 'tr' }, [el('span', { text: k }), el('b', { text: v })]));
          }
          t.classList.add('show');
          positionTip(ev.clientX, ev.clientY);
          state.hover = { bucket: d };
          draw();
        } else {
          hideTip();
          if (state.hover) { state.hover = null; draw(); }
        }
        return;
      }

      const node = view.hit(x, y);
      const changed = (node?.i ?? null) !== (state.hover?.i ?? null);
      state.hover = node;
      if (node) { showTip(node, ev.clientX, ev.clientY); canvas.style.cursor = Viz.isDir(node) ? 'pointer' : 'default'; }
      else { hideTip(); canvas.style.cursor = 'default'; }
      if (changed) draw();
    });

    canvas.addEventListener('mouseleave', () => {
      if (state.hover) { state.hover = null; draw(); }
      hideTip();
    });

    /* One click on a folder goes into it. Requiring a double-click made
     * walking a deep tree a two-step-per-level chore, which is the opposite of
     * what you want when you are hunting for something to delete. Files still
     * select, and shift-click selects a folder without descending. */
    canvas.addEventListener('click', (ev) => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      if (state.view === 'agemap') return;
      const { x, y } = canvasPoint(ev);
      const node = Viz[state.view].hit(x, y);
      if (!node || node.i < 0) return;
      if (Viz.isDir(node) && !ev.shiftKey && !ev.altKey) {
        state.selected = node;
        zoomTo(node);
        return;
      }
      state.selected = node;
      inspect(node);
    });

    // Keep the double-click as well: some people reach for it out of habit,
    // and on a file it does nothing extra.
    canvas.addEventListener('dblclick', (ev) => {
      if (state.view === 'agemap') return;
      const { x, y } = canvasPoint(ev);
      const node = Viz[state.view].hit(x, y);
      if (node && node.i >= 0) zoomTo(node);
    });

    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (state.view === 'agemap') return;
      const { x, y } = canvasPoint(ev);
      const node = Viz[state.view].hit(x, y);
      if (node && node.i >= 0) showContextMenu(node, ev.clientX, ev.clientY);
      else zoomUp();
    });
  }

  // ---------------------------------------------------------- inspector

  async function inspect(node) {
    if (!state.scanId || node.i === undefined || node.i < 0) return;
    try {
      const d = await api(`/api/scan/${state.scanId}/node?i=${node.i}`);
      showInspector(d);
    } catch (e) { toast(e.message, 'err'); }
  }

  function showInspector(d) {
    const empty = $('#inspEmpty');
    const body = $('#inspBody');
    if (!d) { empty.classList.remove('hidden'); body.classList.add('hidden'); return; }
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    body.innerHTML = '';

    body.appendChild(el('div', { class: 'insp-title', text: d.n }));
    body.appendChild(el('div', { class: 'insp-path', text: d.p }));

    const color = Viz.colorFor({ n: d.n, f: d.flags, p: d.p }, 1);
    body.appendChild(el('div', { style: 'display:flex;gap:7px;flex-wrap:wrap;margin-bottom:11px' }, [
      el('span', { class: 'chip' }, [
        el('span', { style: `width:8px;height:8px;border-radius:2px;background:${color};display:block` }),
        el('span', { text: Viz.CAT_LABEL[Viz.categoryOf({ n: d.n, f: d.flags })] || 'Other' }),
      ]),
      d.dir ? el('span', { class: 'chip row', text: 'Folder' }) : null,
      d.hidden ? el('span', { class: 'chip row', text: 'Hidden' }) : null,
      d.compressed ? el('span', { class: 'chip good', text: 'Compressed' }) : null,
    ].filter(Boolean)));

    const grid = el('div', { class: 'insp-grid' });
    const cell = (k, v, wide) => el('div', { class: `insp-cell${wide ? ' wide' : ''}` }, [
      el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }),
    ]);
    grid.appendChild(cell('Size on disk', human(d.disk)));
    grid.appendChild(cell('Logical size', human(d.logical)));
    if (d.dir) {
      grid.appendChild(cell('Files inside', d.files.toLocaleString()));
      grid.appendChild(cell('Folders inside', d.dirs.toLocaleString()));
    } else {
      grid.appendChild(cell('Share of parent', `${d.pct_parent}%`));
      grid.appendChild(cell('Share of scan', `${d.pct_total}%`));
    }
    if (d.dir) {
      grid.appendChild(cell('Share of parent', `${d.pct_parent}%`));
      grid.appendChild(cell('Share of scan', `${d.pct_total}%`));
    }
    grid.appendChild(cell('Created', new Date(d.created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
    grid.appendChild(cell('Modified', new Date(d.modified * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })));
    if (d.saved > 0) grid.appendChild(cell('APFS compression saved', human(d.saved), true));
    body.appendChild(grid);

    const acts = el('div', { class: 'insp-actions' });
    if (d.dir) acts.appendChild(el('button', { class: 'btn small', html: '', onclick: () => zoomTo({ i: d.i, n: d.n, d: d.disk, f: d.flags, p: d.p, dir: true, c: d.files, dc: d.dirs }) }, [ico(ICON.reveal, 13), el('span', { text: 'Open' })]));
    acts.appendChild(el('button', { class: 'btn small', onclick: () => reveal(d.p), title: 'Reveal in Finder' }, [ico(ICON.folder, 13), el('span', { text: 'Reveal' })]));
    acts.appendChild(el('button', { class: 'btn small', onclick: () => openPath(d.p) }, [ico(ICON.open, 13), el('span', { text: 'Open' })]));
    acts.appendChild(el('button', { class: 'btn small', onclick: () => openPath(d.p, true) }, ['Quick Look']));
    acts.appendChild(el('button', { class: 'btn small danger', onclick: () => stage([{ path: d.p, size: d.disk, label: d.n }]) }, [ico(ICON.plus, 13), el('span', { text: 'Stage' })]));
    body.appendChild(acts);

    if (d.largest && d.largest.length) {
      body.appendChild(el('div', { class: 'insp-h', text: 'Largest inside' }));
      for (const l of d.largest) {
        const row = el('div', { class: `largest-row${l.dir ? ' clickable' : ''}`, onclick: l.dir ? () => zoomTo({ i: l.i, n: l.n, d: l.d, f: 1, p: l.p, dir: true, c: 0, dc: 0 }) : null }, [
          el('span', { class: 'nm' }, [
            el('span', { class: 'dot', style: `background:${Viz.colorFor({ n: l.n, f: l.dir ? 1 : 0 }, 1)}` }),
            el('span', { class: 'txt', text: l.n }),
          ]),
          el('span', { class: 'pct', text: `${l.pct}%` }),
          el('span', { style: 'font-variant-numeric:tabular-nums;flex:0 0 auto', text: human(l.d) }),
        ]);
        body.appendChild(row);
      }
    }
  }

  async function reveal(path) {
    const r = await api('/api/reveal', { method: 'POST', body: { path } });
    if (!r.ok) toast(r.error || 'Could not reveal.', 'err');
  }

  async function openPath(path, quicklook) {
    const r = await api('/api/open', { method: 'POST', body: { path, quicklook } });
    if (!r.ok) toast(r.error || 'Could not open.', 'err');
  }

  async function stage(items) {
    if (!items.length) return;
    const r = await api('/api/cleanup/stage', { method: 'POST', body: { items } });
    const failed = r.results.filter((x) => !x.ok);
    const okCount = r.results.length - failed.length;
    state.cleanup = r.queue;
    buildRail();
    if (okCount) toast(`${okCount} item${okCount > 1 ? 's' : ''} staged for cleanup. Nothing removed yet.`, 'ok');
    for (const f of failed) toast(f.error, 'err');
    if (state.view === 'cleanup') renderPanel();
  }

  // ------------------------------------------------------------- panels

  function showPanelShell(title, sub, controls = []) {
    $('#viz').classList.add('hidden');
    $('#legend').classList.remove('show');
    const slot = $('#panelSlot');
    slot.innerHTML = '';
    const head = el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: title }),
        sub ? el('div', { class: 'stage-sub', text: sub }) : null,
      ].filter(Boolean)),
      el('div', { class: 'spacer' }),
      ...controls,
    ]);
    const panel = el('div', { class: 'panel', id: 'panelInner' });
    slot.appendChild(el('div', { style: 'height:100%;display:flex;flex-direction:column;padding:0 14px 0' }, [head, panel]));
    return panel;
  }

  function loadingPanel(label, note) {
    const p = showPanelShell(label, 'Reading the scan…');
    const msg = el('div', { text: note || label });
    p.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'spinner', style: 'margin:0 auto 12px' }), msg,
    ]));
    // A whole-Mac scan makes these walks genuinely slow; show the clock so it
    // is obviously still working rather than hung.
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (!document.body.contains(msg)) { clearInterval(timer); return; }
      const s = ((Date.now() - t0) / 1000).toFixed(0);
      msg.textContent = `${note || label} — ${s}s`;
    }, 500);
    return p;
  }

  async function renderPanel() {
    const v = state.view;
    if (!state.scanId && !['apps', 'cleanup', 'snapshots'].includes(v)) { showScanPrompt(); return; }
    if (v === 'folders') return renderFolders();
    if (v === 'outline') return renderOutline();
    if (v === 'disk') return renderDisk();
    if (v === 'topsizes') return renderTop();
    if (v === 'quickwins') return renderQuickWins();
    if (v === 'duplicates') return renderDuplicates();
    if (v === 'untouched') return renderUntouched();
    if (v === 'apps') return renderApps();
    if (v === 'snapshots') return renderSnapshots();
    if (v === 'cleanup') return renderCleanup();
  }

  function nodeIcon(node) {
    return ico(Viz.isDir(node) ? ICON.folder : ICON.file, 14);
  }

  // ---- Folders -------------------------------------------------------

  async function renderFolders() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Folders', 'Reading the scan');
    let data;
    try {
      data = await api(`/api/scan/${state.scanId}/children?node=${state.focus?.i ?? 0}`);
    } catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    const node = state.subtree || { d: 0, n: '' };
    const kids = data.children;
    const shown = kids.slice(0, 600);
    const total = node.d || 0;
    const s = state.sort.folders;

    const sorters = {
      n: (a, b) => a.n.localeCompare(b.n) * s.dir,
      d: (a, b) => (a.d - b.d) * s.dir,
      s: (a, b) => (a.s - b.s) * s.dir,
      t: (a, b) => (a.t - b.t) * s.dir,
      c: (a, b) => (a.c - b.c) * s.dir,
      p: (a, b) => (a.d / (total || 1) - b.d / (total || 1)) * s.dir,
    };
    shown.sort(sorters[s.key] || sorters.d);

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: state.focus?.n || state.rootPath }),
        el('div', { class: 'stage-sub', text: `${kids.length.toLocaleString()} items directly inside · ${human(total)} total` }),
      ]),
      el('div', { class: 'spacer' }),
      state.trail.length > 1 ? el('button', { class: 'btn small', onclick: zoomUp }, [ico(ICON.up, 12), el('span', { text: 'Up' })]) : null,
    ].filter(Boolean)));

    const table = el('table', { class: 'tbl' });
    const th = (key, label, cls = '') => {
      const arrow = s.key === key ? el('span', { class: 'arrow', text: s.dir < 0 ? '▼' : '▲' }) : null;
      return el('th', {
        class: `sortable ${cls}`, onclick: () => {
          if (s.key === key) s.dir *= -1; else { s.key = key; s.dir = key === 'n' ? 1 : -1; }
          renderFolders();
        },
      }, [el('span', { text: label }), arrow].filter(Boolean));
    };
    const head = el('thead', {}, [el('tr', {}, [
      th('n', 'Name'), th('d', 'Size'), th('p', 'Share'), el('th', { text: '' }),
      th('c', 'Files'), th('t', 'Modified'), el('th', { text: '' }),
    ])]);
    const tbody = el('tbody');

    for (const k of shown) {
      const pv = total ? (k.d / total) * 100 : 0;
      const color = Viz.colorFor(k, depthOf(k) + 1);
      const tr = el('tr', { class: k.dir ? 'rowlink' : '' }, [
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'dot', style: `background:${color}` }),
          nodeIcon(k),
          el('span', { class: 'txt', text: k.n }),
        ])]),
        el('td', { class: 'num', text: human(k.d) }),
        el('td', { class: 'bar-cell' }, [el('div', { class: 'bar' }, [el('i', { style: `width:${Math.max(pv, 0.6)}%;background:${color}` })])]),
        el('td', { class: 'num', style: 'color:var(--muted)', text: pctOf(k.d, total) }),
        el('td', { class: 'num', style: 'color:var(--muted)', text: k.dir ? k.c.toLocaleString() : '—' }),
        el('td', { class: 'num', style: 'color:var(--muted)', text: Viz.relTime(k.t) }),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: (e) => { e.stopPropagation(); reveal(k.p); } }, [ico(ICON.reveal, 11)]),
          el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: (e) => { e.stopPropagation(); stage([{ path: k.p, size: k.d, label: k.n }]); } }, [ico(ICON.plus, 11)]),
        ])]),
      ]);
      if (k.dir) {
        tr.addEventListener('click', () => zoomTo({ i: k.i, n: k.n, d: k.d, s: k.s, t: k.t, f: k.f, p: k.p, dir: true, c: k.c, dc: k.dc }));
        tr.addEventListener('dblclick', () => { state.view = 'folders'; setView('folders'); });
      } else {
        tr.addEventListener('click', () => inspect(k));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(head);
    table.appendChild(tbody);
    p.appendChild(table);
    if (kids.length > shown.length) {
      p.appendChild(el('div', { class: 'empty', text: `Showing the largest ${shown.length} of ${kids.length.toLocaleString()} items.` }));
    }
  }

  // ---- Outline -------------------------------------------------------
  //
  // The folder-in-folder tracker. Finder's list view with sizes attached:
  // expand a row, expand the row inside it, keep going to any depth, and stage
  // anything at any level. Children are fetched the first time a row is opened
  // and then kept, so re-opening a branch is instant.

  async function renderOutline() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = showPanelShell('Outline', 'Expand folder after folder. Stage anything, at any depth.');
    p.innerHTML = '';

    const ctl = el('div', { class: 'panel-head', style: 'margin:0 0 10px' }, [
      el('button', { class: 'btn small', onclick: () => expandTo(state.focus?.i ?? 0, 2) },
        [ico(ICON.chevron, 12), el('span', { text: 'Expand two levels' })]),
      el('button', { class: 'btn small', onclick: () => { state.outlineOpen.clear(); delete state.outlineOpen; state.outlineOpen = new Set(); renderPanel(); } },
        [ico(ICON.up, 12), el('span', { text: 'Collapse all' })]),
      el('div', { class: 'spacer' }),
      el('span', { class: 'stage-sub', text: `${state.outlineOpen.size} expanded` }),
    ]);
    p.appendChild(ctl);

    const tree = el('div', { class: 'outline', id: 'outlineTree' });
    p.appendChild(tree);

    const total = state.focus?.d || 1;
    tree.appendChild(outlineRow(state.focus || { i: 0, n: state.rootPath, d: total, c: 0 }, 0, total, true));
  }

  // children cache lives on state so collapsing and re-expanding is free
  function outlineChildrenKey(id) { return `${state.scanId}:${id}`; }

  async function loadChildren(id) {
    const k = outlineChildrenKey(id);
    if (state.outlineKids[k]) return state.outlineKids[k];
    if (state.outlineKids[k] === undefined && state.outlinePending[k]) return state.outlinePending[k];
    const pr = api(`/api/scan/${state.scanId}/children?node=${id}`)
      .then((d) => { state.outlineKids[k] = d.children || []; delete state.outlinePending[k]; return state.outlineKids[k]; })
      .catch((e) => { delete state.outlinePending[k]; toast(e.message, 'err'); return []; });
    state.outlinePending[k] = pr;
    return pr;
  }

  function outlineRow(node, depth, total, isRoot) {
    const kids = state.outlineKids[outlineChildrenKey(node.i)];
    const open = state.outlineOpen.has(node.i);
    const isDir = Viz.isDir(node);
    const pct = total ? (node.d / total) * 100 : 0;
    const color = Viz.colorFor(node, Math.min(depth + 1, 6));

    const twisty = isDir
      ? el('button', {
        class: `twisty${open ? ' open' : ''}`,
        title: open ? 'Collapse' : 'Expand',
        onclick: async (e) => {
          e.stopPropagation();
          if (open) { state.outlineOpen.delete(node.i); renderPanel(); return; }
          state.outlineOpen.add(node.i);
          if (!state.outlineKids[outlineChildrenKey(node.i)]) {
            const wrap = document.getElementById(`ol-${node.i}`);
            if (wrap) wrap.replaceChildren(el('div', { class: 'outline-loading', text: 'reading…' }));
            await loadChildren(node.i);
          }
          renderPanel();
        },
      }, [ico(ICON.chevron, 11)])
      : el('span', { class: 'twisty-spacer' });

    const row = el('div', {
      class: `outline-row${isRoot ? ' root' : ''}`,
      style: `padding-left:${8 + depth * 17}px`,
      onclick: () => { state.selected = node; inspect(node); },
    }, [
      twisty,
      el('span', { class: 'dot', style: `background:${color}` }),
      isDir ? ico(ICON.folder, 13) : ico(ICON.file, 13),
      el('span', { class: 'ol-name', title: node.p || node.n, text: node.n }),
      el('span', { class: 'ol-bar' }, [el('i', { style: `width:${Math.max(pct, 0.4)}%;background:${color}` })]),
      el('span', { class: 'ol-size', text: human(node.d) }),
      el('span', { class: 'ol-pct', text: pctOf(node.d, total) }),
      el('span', { class: 'ol-files', text: isDir ? (node.c || 0).toLocaleString() : '' }),
      el('span', { class: 'ol-acts' }, [
        el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: (e) => { e.stopPropagation(); reveal(node.p); } }, [ico(ICON.reveal, 11)]),
        el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: (e) => { e.stopPropagation(); stage([{ path: node.p, size: node.d, label: node.n }]); } }, [ico(ICON.plus, 11)]),
      ]),
    ]);

    const wrap = el('div', { class: 'outline-node', id: `ol-${node.i}` }, [row]);

    if (isDir && open) {
      const ul = el('div', { class: 'outline-kids' });
      if (!kids) ul.appendChild(el('div', { class: 'outline-loading', style: `padding-left:${8 + (depth + 1) * 17}px`, text: 'reading…' }));
      else if (!kids.length) ul.appendChild(el('div', { class: 'outline-loading', style: `padding-left:${8 + (depth + 1) * 17}px`, text: 'empty' }));
      else {
        const shown = kids.slice(0, 400);
        for (const k of shown) ul.appendChild(outlineRow(k, depth + 1, total, false));
        if (kids.length > shown.length) {
          ul.appendChild(el('div', { class: 'outline-loading', style: `padding-left:${8 + (depth + 1) * 17}px`, text: `+ ${(kids.length - shown.length).toLocaleString()} more` }));
        }
      }
      wrap.appendChild(ul);
    }
    return wrap;
  }

  /* Open every branch down to `levels`, loading as it goes. Bounded so a
   * whole-Mac scan cannot be asked to expand a million rows at once. */
  async function expandTo(rootId, levels) {
    const queue = [[rootId, 0]];
    let budget = 400;
    while (queue.length && budget > 0) {
      const [id, d] = queue.shift();
      if (d >= levels) continue;
      state.outlineOpen.add(id);
      const kids = await loadChildren(id);
      budget -= 1;
      for (const k of kids.slice(0, 60)) {
        if (Viz.isDir(k)) queue.push([k.i, d + 1]);
      }
    }
    renderPanel();
  }

  // ---- Disk accounting -----------------------------------------------
  //
  // The number that matters most on this screen is the one the app used to
  // shrug at. "64.7 GB is not in any file" is not an answer; it is three
  // different answers wearing one coat, and they have different fixes.

  async function renderDisk() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Disk', 'Reading the APFS volumes');
    let a;
    try { a = await api(`/api/scan/${state.scanId}/accounting`); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Where every byte went' }),
        el('div', { class: 'stage-sub', text: `Container ${a.container} · ${a.root}` }),
      ]),
    ]));

    const total = a.volume_total || 1;
    const blockedGuess = a.blocked_bytes;
    const purgeable = a.purgeable_used || 0;
    // A proportional bar: scanned, other volumes, and the part we could not
    // read. Seeing it drawn is the whole point.
    const seg = (bytes, color, label) => el('div', {
      class: 'acct-seg', style: `width:${(bytes / total) * 100}%;background:${color}`,
      title: bytes > 0 ? `${label}: ${human(bytes)}` : '',
    });
    p.appendChild(el('div', { class: 'acct-bar' }, [
      seg(a.scanned, 'var(--accent)', 'read by the scan'),
      seg(a.skipped_bytes, 'var(--warn)', 'other volumes'),
      seg(blockedGuess, 'var(--danger)', 'blocked by macOS'),
    ]));
    p.appendChild(el('div', { class: 'acct-legend' }, [
      el('span', {}, [el('i', { style: 'background:var(--accent)' }), el('span', { text: `Read by the scan ${human(a.scanned)}` })]),
      el('span', {}, [el('i', { style: 'background:var(--warn)' }), el('span', { text: `Other volumes ${human(a.skipped_bytes)}` })]),
      purgeable > 0 ? el('span', {}, [el('i', { style: 'background:var(--good)' }), el('span', { text: `Purgeable ${human(purgeable)}` })]) : null,
      el('span', {}, [el('i', { style: 'background:var(--danger)' }), el('span', { text: `Blocked by macOS ${human(blockedGuess)}` })]),
      el('span', {}, [el('i', { style: 'background:var(--surface-3)' }), el('span', { text: `Volume total ${human(a.volume_total)}` })]),
    ]));

    if (a.snapshot_count) {
      p.appendChild(el('div', { class: 'warnbox' }, [
        ico(ICON.warn, 15),
        el('span', { text: `This volume is holding ${a.snapshot_count} APFS snapshot${a.snapshot_count === 1 ? '' : 's'}. They are invisible to a file walk and can be large. \`tmutil deletelocalsnapshots\` reclaims them.` }),
      ]));
    }

    p.appendChild(el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat accent' }, [el('div', { class: 'k', text: 'Read by the scan' }), el('div', { class: 'v', text: human(a.scanned) })]),
      el('div', { class: 'stat warn' }, [el('div', { class: 'k', text: 'Other volumes' }), el('div', { class: 'v', text: human(a.skipped_bytes) }), el('div', { class: 'm', text: 'walked past by design' })]),
      purgeable > 0 ? el('div', { class: 'stat good' }, [el('div', { class: 'k', text: 'Purgeable' }), el('div', { class: 'v', text: human(purgeable) }), el('div', { class: 'm', text: 'macOS hands this back on its own' })]) : null,
      el('div', { class: 'stat danger' }, [el('div', { class: 'k', text: 'Blocked by macOS' }), el('div', { class: 'v', text: human(blockedGuess) }), el('div', { class: 'm', text: a.blocked_count ? `behind ${a.blocked_count.toLocaleString()} folders` : 'no blocked folders found' })]),
    ]));

    // The derivation, laid out so the arithmetic can be checked by eye.
    const row = (label, value, note, cls) => el('div', { class: 'kv' }, [
      el('span', { class: 'k' }, [
        el('span', { text: label }),
        note ? el('span', { style: 'color:var(--text-3);font-size:11px;margin-left:8px', text: note }) : null,
      ].filter(Boolean)),
      el('span', { class: 'v', style: cls || '', text: value }),
    ]);
    p.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'How this adds up' }),
      el('div', { class: 'card-sub', text: 'Every byte the container counts, and where it went. The three lines below the volume total sum to it exactly.' }),
      row('Volume total (all APFS volumes)', human(a.volume_total), `container ${a.container}`),
      row('Files this scan read', '− ' + human(a.scanned), 'everything it was allowed to open', 'color:var(--accent)'),
      row('Other volumes', '− ' + human(a.skipped_bytes), a.skipped_volumes.map((v) => v.role).join(', ') || 'none', 'color:var(--warn)'),
      purgeable > 0 ? row('Purgeable', '− ' + human(purgeable), 'macOS reclaims this itself', 'color:var(--good)') : null,
      row('Behind folders macOS blocks', '= ' + human(blockedGuess),
          a.blocked_count ? `${a.blocked_count.toLocaleString()} folders, plus APFS metadata` : 'metadata only',
          'color:var(--danger)'),
    ].filter(Boolean)));

    // Volumes
    p.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Volumes in this container' }),
      el('div', { class: 'card-sub', text: 'Every volume the container counts against your disk. Only some of them hold your files.' }),
      el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Volume' }), el('th', { text: 'Role' }),
          el('th', { text: 'Bytes' }), el('th', { text: 'What it is' }),
        ])]),
        el('tbody', {}, a.volumes.map((v) => el('tr', {}, [
          el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
            el('span', { class: 'dot', style: `background:${v.role === 'Data' ? 'var(--accent)' : 'var(--warn)'}` }),
            el('span', { class: 'txt', text: v.name }),
            el('span', { class: 'sub', text: v.device }),
          ])]),
          el('td', {}, [el('span', { class: 'chip row', text: v.role || '—' })]),
          el('td', { class: 'num', text: human(v.bytes) }),
          el('td', { style: 'color:var(--text-3);font-size:11.5px', text: v.note }),
        ]))),
      ]),
    ]));

    // Blocked
    if (a.blocked_groups.length) {
      p.appendChild(el('div', { class: 'card' }, [
        el('h3', {}, [ico(ICON.warn, 15), el('span', { text: `${a.blocked_count.toLocaleString()} folders macOS would not open` })]),
        el('div', { class: 'card-sub', text: 'These are why the scan finds less than the volume holds. macOS protects them from every app that has not been granted Full Disk Access, and they are where the biggest numbers usually hide.' }),
        el('div', { class: 'warnbox', style: 'margin-bottom:14px' }, [
          ico(ICON.warn, 15),
          el('span', { text: 'To include them: System Settings → Privacy & Security → Full Disk Access, add the app running DiskLens (Terminal, or the Python binary), then scan again.' }),
        ]),
        el('table', { class: 'tbl' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Folder' }), el('th', { text: 'Blocked' }), el('th', { text: 'What is in there' }),
          ])]),
          el('tbody', {}, a.blocked_groups.slice(0, 30).map((g) => el('tr', {}, [
            el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
              g.heavy ? el('span', { class: 'chip danger', text: 'likely large' }) : null,
              el('span', { class: 'txt', text: g.parent }),
            ].filter(Boolean))]),
            el('td', { class: 'num', text: String(g.count) }),
            el('td', { style: 'color:var(--text-2);font-size:11.5px', text: g.summary }),
          ]))),
        ]),
      ]));
    } else {
      p.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: 'Nothing was blocked' }),
        el('div', { class: 'card-sub', text: 'This scan could open every folder it walked. The remaining difference is APFS purgeable space and filesystem metadata.' }),
      ]));
    }
  }

  // ---- Top sizes -----------------------------------------------------  // ---- Top sizes -----------------------------------------------------

  async function renderTop() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Top sizes', 'Ranking the largest files');
    let rows;
    try { rows = await api(`/api/scan/${state.scanId}/top?node=${state.focus?.i ?? 0}&n=300&dirs=0`); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    const max = rows.length ? rows[0].d : 1;
    const total = state.subtree?.d || 1;
    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Top sizes' }),
        el('div', { class: 'stage-sub', text: `The ${rows.length} largest files under ${state.focus?.n || state.rootPath}` }),
      ]),
    ]));

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: '#' }), el('th', { text: 'Name' }), el('th', { text: 'Size' }),
      el('th', { text: 'Share of view' }), el('th', { text: 'Modified' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    rows.forEach((r, i) => {
      const color = Viz.colorFor(r, 3);
      const tr = el('tr', {}, [
        el('td', { class: 'num', style: 'color:var(--dim);width:38px', text: String(i + 1) }),
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'dot', style: `background:${color}` }),
          el('span', { class: 'txt', text: r.n }),
          el('span', { class: 'sub', text: r.p.replace(state.rootPath, '') || '/' }),
        ])]),
        el('td', { class: 'num', text: human(r.d) }),
        el('td', { class: 'bar-cell' }, [el('div', { class: 'bar' }, [el('i', { style: `width:${Math.max((r.d / max) * 100, 1)}%;background:${color}` })])]),
        el('td', { class: 'num', style: 'color:var(--muted)', text: Viz.relTime(r.t) }),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: () => reveal(r.p) }, [ico(ICON.reveal, 11)]),
          el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: () => stage([{ path: r.p, size: r.d, label: r.n }]) }, [ico(ICON.plus, 11)]),
        ])]),
      ]);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    p.appendChild(table);
  }

  // ---- Quick wins ----------------------------------------------------

  async function renderQuickWins() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Quick wins', 'Totalling caches, logs and build artifacts across the whole tree');
    let d;
    try { d = await api(`/api/scan/${state.scanId}/quickwins`); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Quick wins' }),
        el('div', { class: 'stage-sub', text: 'Known-expensive folders, totalled straight from the scan you already have.' }),
      ]),
      el('div', { class: 'spacer' }),
      d.items.length ? el('button', {
        class: 'btn small', onclick: () => stage(d.items.map((i) => ({ path: i.path, size: i.bytes, label: i.label, source: 'quickwin' }))),
      }, [ico(ICON.plus, 12), el('span', { text: 'Stage all' })]) : null,
    ].filter(Boolean)));

    if (!d.items.length) {
      p.appendChild(el('div', { class: 'empty' }, [ico(ICON.check, 30), el('div', { text: 'Nothing obvious to reclaim in this scan.' })]));
      return;
    }

    const stats = el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat accent' }, [el('div', { class: 'k', text: 'Reclaimable' }), el('div', { class: 'v', text: human(d.total) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Locations' }), el('div', { class: 'v', text: String(d.items.length) })]),
    ]);
    p.appendChild(stats);

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Category' }), el('th', { text: 'Location' }), el('th', { text: 'Size' }),
      el('th', { text: '' }), el('th', { text: 'Files' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    const max = Math.max(...d.items.map((i) => i.bytes), 1);
    for (const it of d.items) {
      const color = Viz.catColor('system');
      const tr = el('tr', {}, [
        el('td', {}, [el('span', { class: 'chip row', text: it.label })]),
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'sub', text: it.path.replace(state.rootPath, '') || it.path }),
        ])]),
        el('td', { class: 'num', text: human(it.bytes) }),
        el('td', { class: 'bar-cell' }, [el('div', { class: 'bar' }, [el('i', { style: `width:${Math.max((it.bytes / max) * 100, 1)}%;background:${color}` })])]),
        el('td', { class: 'num', style: 'color:var(--muted)', text: (it.files || 0).toLocaleString() }),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: () => reveal(it.path) }, [ico(ICON.reveal, 11)]),
          el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: () => stage([{ path: it.path, size: it.bytes, label: it.label, source: 'quickwin' }]) }, [ico(ICON.plus, 11)]),
        ])]),
      ]);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    p.appendChild(table);
  }

  // ---- Duplicates ----------------------------------------------------

  async function renderDuplicates() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Duplicates', 'Hashing candidate files — this reads file contents, so on a whole-Mac scan it takes a while');
    let d;
    try { d = await api(`/api/scan/${state.scanId}/dupes?minBytes=4096`); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Duplicates' }),
        el('div', { class: 'stage-sub', text: `${d.groups.length} groups found by matching content byte-for-byte, not names.` }),
      ]),
      el('div', { class: 'spacer' }),
      d.groups.length ? el('button', {
        class: 'btn small danger',
        onclick: () => {
          // Keep the first copy in every group, stage the rest.
          const items = [];
          for (const g of d.groups) for (const f of g.files.slice(1)) items.push({ path: f.p, label: f.n, source: 'duplicate' });
          if (items.length) stage(items);
        },
      }, [ico(ICON.plus, 12), el('span', { text: 'Stage all but the first' })]) : null,
    ].filter(Boolean)));

    if (!d.groups.length) {
      p.appendChild(el('div', { class: 'empty' }, [ico(ICON.check, 30), el('div', { text: 'No duplicates found above 4 KB.' })]));
      return;
    }

    p.appendChild(el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat danger' }, [el('div', { class: 'k', text: 'Wasted' }), el('div', { class: 'v', text: human(d.wasted) }), el('div', { class: 'm', text: 'across all copies after the first' })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Groups' }), el('div', { class: 'v', text: String(d.groups.length) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Files hashed' }), el('div', { class: 'v', text: d.hashed.toLocaleString() })]),
    ]));

    for (const g of d.groups) {
      const box = el('div', { class: 'dup-group' });
      box.appendChild(el('div', { class: 'dup-head' }, [
        el('span', { class: 'chip danger', text: `${g.count} copies` }),
        el('span', { style: 'font-weight:600', text: human(g.size) + ' each' }),
        el('span', { class: 'spacer' }),
        el('span', { style: 'color:var(--danger);font-weight:650', text: `wastes ${human(g.wasted)}` }),
        el('button', {
          class: 'btn tiny danger',
          onclick: () => stage(g.files.slice(1).map((f) => ({ path: f.p, size: g.size, label: f.n, source: 'duplicate' }))),
        }, [ico(ICON.plus, 11), el('span', { text: 'Stage copies' })]),
      ]));
      const body = el('div', { class: 'dup-body' });
      g.files.forEach((f, i) => {
        body.appendChild(el('div', { class: 'dup-file' }, [
          el('span', { class: 'keep', style: 'width:36px', text: i === 0 ? 'keep' : '' }),
          el('span', { class: 'nm' }, [
            el('span', { class: 'txt', text: f.n }),
            el('span', { class: 'sub', text: f.p.replace(state.rootPath, '') || '/' }),
          ]),
          el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: () => reveal(f.p) }, [ico(ICON.reveal, 11)]),
          i > 0 ? el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: () => stage([{ path: f.p, size: g.size, label: f.n, source: 'duplicate' }]) }, [ico(ICON.plus, 11)]) : null,
        ].filter(Boolean)));
      });
      box.appendChild(body);
      p.appendChild(box);
    }
  }

  // ---- Big & untouched -----------------------------------------------

  async function renderUntouched() {
    if (!state.scanId) { showScanPrompt(); return; }
    const p = loadingPanel('Big & untouched', 'Looking for large files you have not touched in a year');
    let d;
    try { d = await api(`/api/scan/${state.scanId}/untouched?minBytes=${100 << 20}&minDays=365`); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Big & untouched' }),
        el('div', { class: 'stage-sub', text: 'Over 100 MB and not modified in more than a year.' }),
      ]),
      el('div', { class: 'spacer' }),
      d.items.length ? el('button', {
        class: 'btn small', onclick: () => stage(d.items.map((i) => ({ path: i.p, size: i.d, label: i.n, source: 'untouched' }))),
      }, [ico(ICON.plus, 12), el('span', { text: 'Stage all' })]) : null,
    ].filter(Boolean)));

    if (!d.items.length) {
      p.appendChild(el('div', { class: 'empty' }, [ico(ICON.check, 30), el('div', { text: 'Nothing large and stale in this scan.' })]));
      return;
    }

    p.appendChild(el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat warn' }, [el('div', { class: 'k', text: 'Total' }), el('div', { class: 'v', text: human(d.total) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Files' }), el('div', { class: 'v', text: d.count.toLocaleString() })]),
    ]));

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Name' }), el('th', { text: 'Size' }), el('th', { text: 'Untouched' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    for (const it of d.items.slice(0, 300)) {
      const color = Viz.colorFor(it, 4);
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'dot', style: `background:${color}` }),
          el('span', { class: 'txt', text: it.n }),
          el('span', { class: 'sub', text: it.p.replace(state.rootPath, '') || '/' }),
        ])]),
        el('td', { class: 'num', text: human(it.d) }),
        el('td', { class: 'num' }, [el('span', { class: 'chip warn', text: `${(it.age / 365).toFixed(1)} yr` })]),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny ghost', title: 'Reveal', onclick: () => reveal(it.p) }, [ico(ICON.reveal, 11)]),
          el('button', { class: 'btn tiny ghost', title: 'Stage for cleanup', onclick: () => stage([{ path: it.p, size: it.d, label: it.n, source: 'untouched' }]) }, [ico(ICON.plus, 11)]),
        ])]),
      ]));
    }
    table.appendChild(tb);
    p.appendChild(table);
  }

  // ---- Applications --------------------------------------------------

  async function renderApps() {
    const p = loadingPanel('Applications', 'Measuring every app bundle and the Library files each one left behind');
    let d;
    try { d = await api('/api/apps'); }
    catch (e) { p.innerHTML = ''; p.appendChild(el('div', { class: 'empty', text: e.message })); return; }

    p.innerHTML = '';
    p.appendChild(el('div', { class: 'panel-head' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Applications' }),
        el('div', { class: 'stage-sub', text: 'Every app with its true footprint — the bundle plus the caches, preferences and logs it scattered across your Library.' }),
      ]),
    ]));

    p.appendChild(el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat accent' }, [el('div', { class: 'k', text: 'Total footprint' }), el('div', { class: 'v', text: human(d.total) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Applications' }), el('div', { class: 'v', text: String(d.apps.length) })]),
    ]));

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Application' }), el('th', { text: 'Bundle' }), el('th', { text: 'Leftovers' }),
      el('th', { text: 'Total' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    for (const a of d.apps.slice(0, 400)) {
      const tr = el('tr', {}, [
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'dot', style: `background:${Viz.catColor('app')}` }),
          el('span', { class: 'txt', text: a.name }),
          a.system ? el('span', { class: 'chip row', text: 'system' }) : null,
          a.bid ? el('span', { class: 'sub', text: a.bid }) : null,
        ].filter(Boolean))]),
        el('td', { class: 'num', text: human(a.bundle_bytes) }),
        el('td', { class: 'num' }, [el('span', {
          class: `chip ${a.leftover_bytes > 500 << 20 ? 'warn' : 'row'}`,
          text: a.leftovers.length ? `${human(a.leftover_bytes)} · ${a.leftovers.length}` : 'none',
        })]),
        el('td', { class: 'num', style: 'font-weight:650', text: human(a.total_bytes) }),
        el('td', {}, [el('div', { class: 'actions' }, [
          a.leftovers.length ? el('button', {
            class: 'btn tiny ghost', title: 'Show the files it left behind',
            onclick: () => showLeftovers(a),
          }, [ico(ICON.folder, 11), el('span', { text: 'Leftovers' })]) : null,
          el('button', { class: 'btn tiny ghost', title: 'Reveal in Finder', onclick: () => reveal(a.path) }, [ico(ICON.reveal, 11)]),
          !a.system ? el('button', {
            class: 'btn tiny danger', title: 'Uninstall completely — bundle plus leftovers',
            onclick: () => stage([{ path: a.path, size: a.bundle_bytes, label: a.name, source: 'uninstall' },
              ...a.leftovers.map((l) => ({ path: l.path, size: l.bytes, label: a.name + ' leftover', source: 'uninstall' }))]),
          }, [ico(ICON.cleanup, 11), el('span', { text: 'Uninstall' })]) : null,
        ].filter(Boolean))]),
      ]);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    p.appendChild(table);
    p.appendChild(el('div', { class: 'empty', text: 'Uninstall stages the bundle and every leftover it found. Review the list on the Cleanup page before anything is removed.' }));
  }

  function showLeftovers(app) {
    openModal(`Leftovers — ${app.name}`, [
      el('div', { class: 'warnbox' }, [
        ico(ICON.warn, 15),
        el('span', { text: `These files live outside the app bundle. Dragging ${app.app} to the Trash would leave all of them behind — ${human(app.leftover_bytes)} in total.` }),
      ]),
      el('table', { class: 'tbl' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Path' }), el('th', { text: 'Size' }), el('th', { text: 'Files' })])]),
        el('tbody', {}, app.leftovers.map((l) => el('tr', {}, [
          el('td', { class: 'name' }, [el('span', { class: 'sub', text: l.path })]),
          el('td', { class: 'num', text: human(l.bytes) }),
          el('td', { class: 'num', style: 'color:var(--muted)', text: String(l.files) }),
        ]))),
      ]),
    ], [
      el('button', { class: 'btn', text: 'Close', onclick: closeModal }),
      el('button', {
        class: 'btn danger', onclick: () => {
          stage([{ path: app.path, size: app.bundle_bytes, label: app.name, source: 'uninstall' },
            ...app.leftovers.map((l) => ({ path: l.path, size: l.bytes, label: app.name + ' leftover', source: 'uninstall' }))]);
          closeModal();
        },
      }, [ico(ICON.cleanup, 13), el('span', { text: 'Stage the whole set' })]),
    ]);
  }

  // ---- Snapshots -----------------------------------------------------

  async function renderSnapshots() {
    let d;
    try { d = await api('/api/snapshots'); } catch (e) { return; }
    state.snapshots = d.snapshots;
    const p = showPanelShell('Snapshots', 'Keep the result of a past scan and hold it against today\'s to see what grew.');
    p.innerHTML = '';

    if (state.scanId) {
      p.appendChild(el('div', { class: 'card' }, [
        el('h3', { text: 'Save the current scan' }),
        el('div', { class: 'card-sub', text: `Take a snapshot of ${state.focus?.n || state.rootPath} so you can compare it later.` }),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('input', { type: 'text', id: 'snapName', placeholder: 'Name (optional)', style: 'flex:1;height:34px;padding:0 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;outline:none' }),
          el('button', { class: 'btn primary', onclick: saveSnapshot }, [ico(ICON.plus, 13), el('span', { text: 'Take snapshot' })]),
        ]),
      ]));
    }

    if (!state.snapshots.length) {
      p.appendChild(el('div', { class: 'empty' }, [ico(ICON.snapshots, 30), el('div', { text: 'No snapshots yet. Scan something, then take one.' })]));
      return;
    }

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Snapshot' }), el('th', { text: 'Root' }), el('th', { text: 'Total' }),
      el('th', { text: 'Taken' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    for (const s of state.snapshots) {
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [el('span', { class: 'txt', text: s.name })])]),
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [el('span', { class: 'sub', text: s.root })])]),
        el('td', { class: 'num', text: human(s.total) }),
        el('td', { class: 'num', style: 'color:var(--muted)', text: Viz.relTime(s.created) }),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny danger', title: 'Delete snapshot', onclick: async () => {
            await api('/api/snapshots/delete', { method: 'POST', body: { id: s.id } });
            renderSnapshots();
          } }, ['Delete']),
        ])]),
      ]));
    }
    table.appendChild(tb);
    p.appendChild(table);

    if (state.snapshots.length >= 2) {
      const card = el('div', { class: 'card', style: 'margin-top:14px' }, [
        el('h3', { text: 'Compare two snapshots' }),
        el('div', { class: 'card-sub', text: 'Shows which folders grew or shrank between the two.' }),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          sel(state.snapshots, 'cmpA', 0), el('span', { class: 'stage-sub', text: 'to' }), sel(state.snapshots, 'cmpB', 1),
          el('button', { class: 'btn', onclick: runCompare }, [ico(ICON.snapshots, 13), el('span', { text: 'Compare' })]),
        ]),
      ]);
      p.appendChild(card);
      p.appendChild(el('div', { id: 'cmpOut' }));
    }
  }

  function sel(list, id, idx) {
    const s = el('select', { id, style: 'height:34px;padding:0 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;outline:none;flex:1;min-width:150px' });
    list.forEach((x, i) => s.appendChild(el('option', { value: x.id, selected: i === idx ? 'selected' : null, text: x.name })));
    return s;
  }

  async function saveSnapshot() {
    const name = $('#snapName')?.value || '';
    try {
      await api('/api/snapshots', { method: 'POST', body: { scanId: state.scanId, name } });
      toast('Snapshot saved.', 'ok');
      renderSnapshots();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function runCompare() {
    const a = $('#cmpA').value, b = $('#cmpB').value;
    const out = $('#cmpOut');
    out.innerHTML = '';
    try {
      const d = await api(`/api/snapshots/${a}/compare/${b}`);
      const up = d.rows.filter((r) => r.delta > 0).slice(0, 200);
      const down = d.rows.filter((r) => r.delta < 0).slice(0, 100);
      out.appendChild(el('div', { class: 'stat-row', style: 'margin-top:14px' }, [
        el('div', { class: `stat ${d.total_delta > 0 ? 'danger' : 'good'}` }, [
          el('div', { class: 'k', text: 'Total change' }),
          el('div', { class: 'v', text: (d.total_delta >= 0 ? '+' : '') + human(d.total_delta) }),
          el('div', { class: 'm', text: `${human(d.a.total)} → ${human(d.b.total)}` }),
        ]),
        el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Grew' }), el('div', { class: 'v', text: String(up.length) })]),
        el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Shrank' }), el('div', { class: 'v', text: String(down.length) })]),
      ]));
      const table = el('table', { class: 'tbl' });
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Folder' }), el('th', { text: 'Before' }), el('th', { text: 'After' }), el('th', { text: 'Change' }),
      ])]));
      const tb = el('tbody');
      for (const r of [...up, ...down]) {
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'name' }, [el('div', { class: 'nm' }, [el('span', { class: 'txt', text: r.path })])]),
          el('td', { class: 'num', style: 'color:var(--muted)', text: human(r.before) }),
          el('td', { class: 'num', style: 'color:var(--muted)', text: human(r.after) }),
          el('td', { class: 'num' }, [el('span', { class: `chip ${r.delta > 0 ? 'danger' : 'good'}`, text: (r.delta > 0 ? '+' : '') + human(r.delta) })]),
        ]));
      }
      table.appendChild(tb);
      out.appendChild(table);
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---- Cleanup -------------------------------------------------------

  async function renderCleanup() {
    let d;
    try { d = await api('/api/cleanup'); } catch (e) { return; }
    state.cleanup = d;
    buildRail();

    const p = showPanelShell('Cleanup', 'Staged items. Nothing has been removed — review the list, then run it.');
    p.innerHTML = '';

    if (!d.items.length) {
      // Kept on the empty state too: the fact that the Trash still holds your
      // space is most worth knowing when the list looks done.
      p.appendChild(trashNote());
      p.appendChild(el('div', { class: 'empty' }, [
        ico(ICON.check, 32),
        el('div', { text: 'The cleanup list is empty.' }),
        el('div', { style: 'margin-top:6px;font-size:11.5px',
          text: 'Right-click anything in a map to move it straight to the Trash, or use the + button to stage it for review first.' }),
      ]));
      return;
    }

    p.appendChild(el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat warn' }, [el('div', { class: 'k', text: 'Staged' }), el('div', { class: 'v', text: human(d.total) })]),
      el('div', { class: 'stat' }, [el('div', { class: 'k', text: 'Items' }), el('div', { class: 'v', text: String(d.count) })]),
    ]));

    p.appendChild(el('div', { class: 'warnbox' }, [
      ico(ICON.warn, 15),
      el('span', { text: 'Running the queue moves each item to the Trash, so a mistake is recoverable from the Finder. DiskLens will never remove anything you have not staged here.' }),
    ]));
    p.appendChild(trashNote());

    const table = el('table', { class: 'tbl' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Item' }), el('th', { text: 'Size' }), el('th', { text: 'Source' }), el('th', { text: '' }),
    ])]));
    const tb = el('tbody');
    for (const it of d.items) {
      tb.appendChild(el('tr', {}, [
        el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
          el('span', { class: 'txt', text: it.label || it.path.split('/').pop() }),
          el('span', { class: 'sub', text: it.path }),
        ])]),
        el('td', { class: 'num', text: human(it.size) }),
        el('td', {}, [el('span', { class: 'chip row', text: it.source || 'manual' })]),
        el('td', {}, [el('div', { class: 'actions' }, [
          el('button', { class: 'btn tiny ghost', title: 'Reveal', onclick: () => reveal(it.path) }, [ico(ICON.reveal, 11)]),
          el('button', {
            class: 'btn tiny ghost', title: 'Remove from the list', onclick: async () => {
              const r = await api('/api/cleanup/unstage', { method: 'POST', body: { path: it.path } });
              state.cleanup = r.queue; renderCleanup();
            },
          }, ['Remove']),
        ])]),
      ]));
    }
    table.appendChild(tb);
    p.appendChild(table);

    const foot = el('div', { class: 'card', style: 'margin-top:14px;display:flex;gap:9px;align-items:center;flex-wrap:wrap' }, [
      el('button', { class: 'btn danger', onclick: runCleanup }, [ico(ICON.cleanup, 13), el('span', { text: `Move ${d.count} item${d.count > 1 ? 's' : ''} to Trash` })]),
      el('button', { class: 'btn ghost', text: 'Clear the list', onclick: async () => {
        await api('/api/cleanup/clear', { method: 'POST', body: {} });
        state.cleanup = { items: [], total: 0, count: 0 };
        renderCleanup();
      } }),
      el('span', { class: 'stage-sub', text: `Frees ${human(d.total)}` }),
    ]);
    p.appendChild(foot);
  }

  /* Moving something to the Trash does not give the space back -- the blocks
   * stay allocated until the Trash is emptied. macOS does not let an app list
   * or clear ~/.Trash without Full Disk Access, so the honest thing is to say
   * so and hand over a way to finish the job. */
  function trashNote() {
    const box = el('div', { class: 'trashnote', id: 'trashNote' }, [
      el('div', { class: 'tn-ico' }, [ico(ICON.trash, 15)]),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'tn-title', text: 'Deleted items are not gone yet' }),
        el('div', { class: 'tn-sub', text: 'Space is only reclaimed when you empty the Trash. macOS does not let an app do that for you without Full Disk Access.' }),
      ]),
      el('button', { class: 'btn small', onclick: openTrash }, [ico(ICON.folder, 12), el('span', { text: 'Open Trash' })]),
    ]);
    return box;
  }

  async function openTrash() {
    const r = await api('/api/trash/open', { method: 'POST', body: {} });
    if (!r.ok) toast(r.error || 'Could not open the Trash.', 'err');
  }

  function runCleanup() {
    const d = state.cleanup;
    openModal('Move to Trash?', [
      el('div', { class: 'warnbox danger' }, [
        ico(ICON.warn, 16),
        el('span', { text: `${d.count} item${d.count > 1 ? 's' : ''} totalling ${human(d.total)} will be moved to the Trash. They stay recoverable in the Finder until you empty it.` }),
      ]),
      el('div', { style: 'max-height:230px;overflow-y:auto' }, d.items.slice(0, 100).map((i) =>
        el('div', { class: 'kv' }, [el('span', { class: 'k', text: i.path }), el('span', { class: 'v', text: human(i.size) })]))),
    ], [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', {
        class: 'btn danger', onclick: async () => {
          closeModal();
          try {
            const r = await api('/api/cleanup/run', { method: 'POST', body: { useTrash: true } });
            const ok = r.results.filter((x) => x.ok).length;
            const bad = r.results.filter((x) => !x.ok);
            toast(`Moved ${ok} item${ok === 1 ? '' : 's'} to the Trash (${human(r.freed)}). Empty the Trash to reclaim the space.`, 'ok');
            for (const b of bad.slice(0, 3)) toast(`${b.path}: ${b.error}`, 'err');
            state.cleanup = r.queue;
            state.cache = {};
            state.subtree = null;
            state.focus = null;
            state.trail = [];
            renderCleanup();
          } catch (e) { toast(e.message, 'err'); }
        },
      }, [ico(ICON.cleanup, 13), el('span', { text: 'Move to Trash' })]),
    ]);
  }

  // ---- Age map -------------------------------------------------------

  async function renderAge() {
    if (!state.scanId) { showScanPrompt(); return; }
    $('#viz').classList.remove('hidden');
    $('#panelSlot').innerHTML = '';
    const slot = $('#panelSlot');
    slot.innerHTML = '';

    let d;
    try { d = await api(`/api/scan/${state.scanId}/age?node=${state.focus?.i ?? 0}&buckets=40`); }
    catch (e) { toast(e.message, 'err'); return; }

    // The canvas keeps the top 60%; the untouched list fills the rest. This one
    // goes straight into the canvas column rather than the overlay slot, so
    // both are on screen at once.
    document.getElementById('ageBelow')?.remove();
    const canvas = $('#viz');
    canvas.style.flex = '0 0 60%';
    const below = el('div', { class: 'panel', id: 'ageBelow', style: 'border-top:1px solid var(--border-soft);flex:1 1 auto' });
    $('#canvasWrap').appendChild(below);

    Viz.agemap.render(canvas, state.subtree, {
      buckets: d.buckets, hover: state.hover, logScale: state.ageLog,
    });
    updateLegend();
    // Linear reads magnitudes; log reads the shape of a lopsided distribution.
    buildSeg([['Linear', false], ['Log', true]], state.ageLog, (log) => {
      state.ageLog = log;
      renderAge();
    });

    let un;
    try { un = await api(`/api/scan/${state.scanId}/untouched?minBytes=${50 << 20}&minDays=365&limit=60`); }
    catch (e) { un = { items: [], total: 0, count: 0 }; }

    below.appendChild(el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap' }, [
      el('div', {}, [
        el('div', { class: 'stage-title', text: 'Big & untouched' }),
        el('div', { class: 'stage-sub', text: 'Large files not modified in over a year — usually the fastest space back.' }),
      ]),
      el('div', { class: 'spacer', style: 'flex:1' }),
      el('span', { class: 'chip warn', text: human(un.total) }),
      un.items.length ? el('button', {
        class: 'btn small', onclick: () => stage(un.items.map((i) => ({ path: i.p, size: i.d, label: i.n, source: 'untouched' }))),
      }, [ico(ICON.plus, 12), el('span', { text: 'Stage all' })]) : null,
    ].filter(Boolean)));

    if (!un.items.length) {
      below.appendChild(el('div', { class: 'empty', text: 'Nothing over 50 MB is older than a year here.' }));
    } else {
      const table = el('table', { class: 'tbl' });
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Name' }), el('th', { text: 'Size' }), el('th', { text: 'Untouched' }), el('th', { text: '' }),
      ])]));
      const tb = el('tbody');
      for (const it of un.items) {
        tb.appendChild(el('tr', {}, [
          el('td', { class: 'name' }, [el('div', { class: 'nm' }, [
            el('span', { class: 'dot', style: `background:${Viz.colorFor(it, 4)}` }),
            el('span', { class: 'txt', text: it.n }),
            el('span', { class: 'sub', text: it.p.replace(state.rootPath, '') || '/' }),
          ])]),
          el('td', { class: 'num', text: human(it.d) }),
          el('td', { class: 'num' }, [el('span', { class: 'chip warn', text: `${(it.age / 365).toFixed(1)} yr` })]),
          el('td', {}, [el('div', { class: 'actions' }, [
            el('button', { class: 'btn tiny ghost', onclick: () => reveal(it.p) }, [ico(ICON.reveal, 11)]),
            el('button', { class: 'btn tiny ghost', onclick: () => stage([{ path: it.p, size: it.d, label: it.n, source: 'untouched' }]) }, [ico(ICON.plus, 11)]),
          ])]),
        ]));
      }
      table.appendChild(tb);
      below.appendChild(table);
    }
  }

  // ------------------------------------------------------- context menu
  //
  // Right-clicking something in a map is how you say "this one, get rid of
  // it" without going hunting for a button. Left-click drills down, so the
  // menu is also where selecting-without-descending lives.

  function closeCtx() {
    document.getElementById('ctxmenu')?.remove();
    document.removeEventListener('click', closeCtx, true);
    document.removeEventListener('keydown', ctxEsc);
  }
  function ctxEsc(e) { if (e.key === 'Escape') closeCtx(); }

  function showContextMenu(node, x, y) {
    closeCtx();
    const isDir = Viz.isDir(node);
    const color = Viz.colorFor(node, 1);

    const item = (label, icon, fn, danger) => el('button', {
      class: `ctx-item${danger ? ' danger' : ''}`,
      onclick: () => { closeCtx(); fn(); },
    }, [el('span', { class: 'ctx-ico' }, [ico(icon, 13)]), el('span', { text: label })]);

    const menu = el('div', { class: 'ctxmenu', id: 'ctxmenu', onclick: (e) => e.stopPropagation() }, [
      el('div', { class: 'ctx-head' }, [
        el('span', { class: 'dot', style: `background:${color}` }),
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'ctx-name', text: node.n }),
          el('div', { class: 'ctx-sub', text: `${human(node.d)}${isDir ? ` · ${(node.c || 0).toLocaleString()} files` : ''}` }),
        ]),
      ]),
      isDir ? item('Open in this view', ICON.reveal, () => zoomTo(node)) : null,
      item('Reveal in Finder', ICON.folder, () => reveal(node.p)),
      item('Quick Look', ICON.file, () => openPath(node.p, true)),
      item('Copy path', ICON.copy, () => {
        navigator.clipboard?.writeText(node.p).then(
          () => toast('Path copied.', 'ok'), () => toast('Could not copy.', 'err'));
      }),
      el('div', { class: 'ctx-sep' }),
      item('Stage for cleanup', ICON.plus, () => stage([{ path: node.p, size: node.d, label: node.n }])),
      item('Move to Trash', ICON.cleanup, () => confirmTrash([{ path: node.p, size: node.d, label: node.n }]), true),
    ].filter(Boolean));

    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
    // Defer so the click that opened the menu does not immediately close it.
    setTimeout(() => {
      document.addEventListener('click', closeCtx, true);
      document.addEventListener('keydown', ctxEsc);
    }, 0);
  }

  /* One explicit confirmation, naming the path and what it costs. Then it goes
   * to the Trash, where it stays recoverable. */
  function confirmTrash(items) {
    if (!items.length) return;
    const total = items.reduce((s, i) => s + (i.size || 0), 0);
    openModal(items.length === 1 ? 'Move to Trash?' : `Move ${items.length} items to Trash?`, [
      el('div', { class: 'warnbox' }, [
        ico(ICON.warn, 16),
        el('span', { text: items.length === 1
          ? `"${items[0].label || items[0].path}" will be moved to the Trash. It is recoverable from the Finder until you empty it.`
          : `${items.length} items totalling ${human(total)} will be moved to the Trash.` }),
      ]),
      el('div', { style: 'max-height:220px;overflow:auto;font-family:var(--mono);font-size:11px;color:var(--muted)' },
        items.slice(0, 60).map((i) => el('div', { style: 'padding:3px 0;border-bottom:1px solid var(--border-soft);word-break:break-all', text: i.path }))),
    ], [
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', {
        class: 'btn danger',
        onclick: async () => {
          closeModal();
          const r = await api('/api/cleanup/stage', { method: 'POST', body: { items } });
          const bad = r.results.filter((x) => !x.ok);
          const good = r.results.filter((x) => x.ok);
          if (!good.length) { bad.forEach((b) => toast(b.error, 'err')); return; }
          const run = await api('/api/cleanup/run', {
            method: 'POST', body: { useTrash: true, only: good.map((g) => g.path) },
          });
          state.cleanup = run.queue;
          buildRail(); markRail();
          const freed = run.freed || 0;
          toast(`Moved ${run.removed} item${run.removed === 1 ? '' : 's'} to the Trash (${human(freed)}). Empty the Trash to reclaim the space.`, 'ok');
          for (const b of bad.slice(0, 3)) toast(b.error, 'err');
          refreshGauge(state.rootPath || '/');
          if (state.view === 'cleanup') renderCleanup();
        },
      }, [ico(ICON.cleanup, 13), el('span', { text: 'Move to Trash' })]),
    ]);
  }

  // --------------------------------------------------------------- modals

  function openModal(title, bodyNodes, footNodes) {
    const slot = $('#modalSlot');
    slot.innerHTML = '';
    const m = el('div', { class: 'scrim', onclick: (e) => { if (e.target.classList.contains('scrim')) closeModal(); } }, [
      el('div', { class: 'modal' }, [
        el('div', { class: 'modal-head' }, [
          el('h2', { text: title }),
          el('button', { class: 'btn tiny ghost', text: '✕', onclick: closeModal }),
        ]),
        el('div', { class: 'modal-body' }, bodyNodes),
        footNodes ? el('div', { class: 'modal-foot' }, footNodes) : null,
      ].filter(Boolean)),
    ]);
    slot.appendChild(m);
    document.addEventListener('keydown', escClose);
  }

  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    $('#modalSlot').innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  // -------------------------------------------------------- folder picker

  let browsePath = null;

  async function openBrowser(path) {
    const d = await api(`/api/browse?path=${encodeURIComponent(path || state.rootPath || '~')}`);
    browsePath = d.path;
    const list = el('div', { class: 'browser-list', id: 'browserList' });
    const fill = () => list.replaceChildren(...d.dirs.map((x) => el('button', {
      class: 'browser-row', onclick: () => { closeModal(); openBrowser(x.path); },
    }, [ico(ICON.folder, 14), el('span', { text: x.name })])));

    const body = [
      el('div', { class: 'target-grid' }, (state.targetInfo?.targets || []).map((t) => el('button', {
        class: 'target', onclick: () => { closeModal(); startScan(t.path); },
      }, [el('div', { class: 't', text: t.label }), el('div', { class: 'h', text: t.hint }), el('div', { class: 'p', text: t.path })]))),
      state.targetInfo?.volumes?.length ? el('div', {}, [
        el('div', { class: 'field' }, [el('label', { text: 'Volumes' })]),
        el('div', { class: 'target-grid' }, state.targetInfo.volumes.map((t) => el('button', {
          class: 'target', onclick: () => { closeModal(); startScan(t.path); },
        }, [el('div', { class: 't', text: t.label }), el('div', { class: 'p', text: t.path })]))),
      ]) : null,
      el('div', { class: 'field' }, [el('label', { text: 'Or browse' })]),
      el('div', { class: 'browser' }, [
        el('div', { class: 'browser-path' }, [
          el('button', {
            class: 'btn tiny ghost', disabled: !d.parent, onclick: () => { closeModal(); openBrowser(d.parent); },
          }, [ico(ICON.up, 11)]),
          el('span', { text: d.path, style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
          el('span', { class: 'stage-sub', text: d.usage ? `${human(d.usage.free)} free` : '' }),
        ]),
        list,
      ]),
    ].filter(Boolean);

    fill();
    openModal('Choose a folder to scan', body, [
      el('span', { class: 'stage-sub', text: 'Anything on this Mac, plus mounted volumes.' }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', onclick: () => { closeModal(); startScan(d.path); } }, [ico(ICON.check, 13), el('span', { text: `Scan this folder` })]),
    ]);
  }

  // --------------------------------------------------------------- gauge

  function updateGauge(usage) {
    if (!usage || !usage.total) return;
    const fill = $('#gaugeFill');
    fill.style.width = `${usage.pct}%`;
    fill.style.background = usage.pct > 90 ? 'linear-gradient(90deg,#f87171,#fbbf24)'
      : usage.pct > 75 ? 'linear-gradient(90deg,#fbbf24,#34d399)' : '#4c8dff';
    $('#gaugeText').innerHTML = '';
    $('#gaugeText').append(
      el('b', { text: human(usage.free) }),
      document.createTextNode(` free of ${human(usage.total)}`),
    );
  }

  async function refreshGauge(path) {
    try { updateGauge(await api(`/api/volumes?path=${encodeURIComponent(path || '/')}`)); } catch (_) {}
  }

  async function refreshBadges() {
    try { state.cleanup = await api('/api/cleanup'); buildRail(); markRail(); } catch (_) {}
  }

  // -------------------------------------------------------------- theme

  function buildThemeSwitcher() {
    const ts = $('#themeSeg');
    const ms = $('#modeSeg');
    if (!ts || !ms || typeof Theme === 'undefined') return;

    ts.innerHTML = '';
    for (const t of Theme.THEMES) {
      ts.appendChild(el('button', {
        class: Theme.theme === t.id ? 'on' : '',
        text: t.label,
        title: t.blurb,
        onclick: () => Theme.setTheme(t.id),
      }));
    }
    ms.innerHTML = '';
    for (const m of Theme.MODES) {
      ms.appendChild(el('button', {
        class: Theme.mode === m.id ? 'on' : '',
        text: m.label,
        title: m.id === 'system' ? 'Follow the macOS appearance' : `Always ${m.label.toLowerCase()}`,
        onclick: () => Theme.setMode(m.id),
      }));
    }
  }

  /* The canvas cannot read CSS variables, so it has to be told the mode and
   * then redrawn. Everything else follows the stylesheet on its own. */
  function onThemeChange(e) {
    const mode = e.detail.mode;
    if (typeof Viz.setMode === 'function') Viz.setMode(mode);
    buildThemeSwitcher();
    const c = $('#viz');
    if (c && !c.classList.contains('hidden') && state.subtree) {
      try { draw(); } catch (_) { /* not on a canvas view */ }
    }
    if (state.view === 'agemap' && state.scanId) renderAge();
  }

  // ----------------------------------------------------------------- boot

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'agemap' && state.subtree) { renderAge(); return; }
      if (CANVAS_VIEWS.has(state.view) && state.subtree) draw();
    }, 130);
  }

  /* window.resize never fires when an element's own box changes, which is
   * exactly what happens inside an iframe or when a pane is resized. Watch the
   * canvas instead. */
  function watchSize() {
    if (typeof ResizeObserver === 'undefined') return;
    let last = '';
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (key === last) return;
      last = key;
      onResize();
    });
    ro.observe($('#canvasWrap'));
  }

  async function boot() {
    if (typeof Theme !== 'undefined' && typeof Viz.setMode === 'function') {
      Viz.setMode(Theme.resolved);
      buildThemeSwitcher();
      window.addEventListener('themechange', onThemeChange);
    }
    buildRail();
    wireCanvas();
    watchSize();
    updateCrumbs();
    await loadTargets();
    await refreshBadges();
    refreshGauge('/');
    window.addEventListener('resize', onResize);

    $('#scanBtn').addEventListener('click', () => {
      const v = $('#pathInput').value.trim();
      if (v) startScan(v); else openBrowser();
    });
    $('#pathInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) startScan(v); }
    });
    $('#browseBtn').addEventListener('click', () => openBrowser($('#pathInput').value.trim() || state.rootPath));
    $('#refreshBtn').addEventListener('click', () => state.rootPath && startScan(state.rootPath));
    $('#upBtn').addEventListener('click', zoomUp);

    buildColorSeg();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#modalSlot').innerHTML) {
        if (CANVAS_VIEWS.has(state.view)) zoomUp();
      }
    });

    // Prefers a ?path= scan, then the scan this browser was last on, then
    // whatever the server still has.
    await restoreOrPrompt();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
