/* global api, Nav */
'use strict';

const state = {
  snap: null,
  view: 'home',      // 'home' | 'system' | 'settings'
  systemId: null,
  query: '',
  sort: 'recent',    // 'recent' | 'az'
  detailId: null,
  padName: null,
};

const coverCache = new Map(); // gameId -> url | null
const fileUrlCache = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function fullDate(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const lib = () => state.snap.library;
const sysById = (id) => lib().systems.find((s) => s.id === id);
const gameById = (id) => lib().games.find((g) => g.id === id) || lib().orphans.find((g) => g.id === id);
const emuOf = (sys) => state.snap.emulators[sys.emulator];

function slotLabel(slot) {
  if (slot === 'auto') return 'Auto save';
  return `Slot ${slot}`;
}

function colorVars(sys) {
  return `--c1:${sys.color[0]};--c2:${sys.color[1]}`;
}

function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.5 16h-5l-2.3 2.2A2.5 2.5 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7zm0 3v1.5H5.5v1.5H7v1.5h1.5V13H10v-1.5H8.5V10zm9.5.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  resume: '<svg viewBox="0 0 24 24"><path d="M5 4h3v16H5zM10 4.5v15l11-7.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.key : null;
  const hadFocusInMain = active && active.closest && (active.closest('.main') || active.closest('.overlay'));

  renderSidebar();
  renderMain();
  renderDetail();
  hydrateArt();

  // Keep focus where it was (important for controller use).
  let target = focusKey && document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
  if (!target && (hadFocusInMain || !active || active === document.body)) {
    const scope = document.querySelector('.overlay') || $('#main');
    target = scope.querySelector('.nav');
  }
  if (target && document.activeElement !== target) target.focus({ preventScroll: true });
}

function renderSidebar() {
  const systems = lib().systems;
  const item = (key, action, id, label, extra, active) =>
    `<button class="nav side-item ${active ? 'active' : ''}" data-key="${key}" data-action="${action}" ${id ? `data-id="${id}"` : ''}>${label}${extra || ''}</button>`;

  $('#sidebar').innerHTML = `
    <div class="brand"><span class="brand-mark">R</span><span>Retro Library</span></div>
    <div class="side-group">
      ${item('side-home', 'home', null, `${ICON.home}<span>Home</span>`, '', state.view === 'home')}
    </div>
    <div class="side-label">Consoles</div>
    <div class="side-group side-consoles">
      ${systems.map((s) => item(`side-${s.id}`, 'system', s.id,
        `<span class="dot" style="${colorVars(s)}"></span><span>${esc(s.short)}</span>`,
        `<span class="count">${s.configured ? s.gameCount : ''}</span>`,
        state.view === 'system' && state.systemId === s.id)).join('')}
    </div>
    <div class="side-bottom">
      ${item('side-settings', 'settings', null, `${ICON.gear}<span>Settings</span>`, '', state.view === 'settings')}
      ${item('side-rescan', 'rescan', null, `${ICON.refresh}<span>Rescan</span>`, '', false)}
      <div class="pad-status ${state.padName ? 'on' : ''}" title="${esc(state.padName || '')}">
        ${ICON.pad}<span>${state.padName ? 'Controller connected' : 'No controller'}</span>
      </div>
    </div>`;
}

function renderMain() {
  const main = $('#main');
  if (state.view === 'settings') main.innerHTML = viewSettings();
  else if (state.view === 'system' && sysById(state.systemId)) main.innerHTML = viewSystem(sysById(state.systemId));
  else main.innerHTML = viewHome();
}

function continueCard(g) {
  const sys = sysById(g.systemId);
  const save = g.saves[0];
  return `
    <button class="nav cont-card" data-key="cont-${g.id}" data-action="detail" data-id="${g.id}">
      <div class="cont-art art" style="${colorVars(sys)}" data-cover="${g.id}" ${save && save.thumb ? `data-thumb="${esc(save.thumb)}"` : ''}>
        <span class="ph-title">${esc(g.title)}</span>
        <span class="cont-play">${ICON.resume}</span>
      </div>
      <div class="cont-meta">
        <div class="cont-title">${esc(g.title)}</div>
        <div class="cont-sub"><span class="badge" style="${colorVars(sys)}">${esc(sys.short)}</span>${esc(ago(g.lastSave))}${save ? ` · ${esc(slotLabel(save.slot))}` : ''}</div>
        ${g.orphan ? '<div class="warn">Game file not found</div>' : ''}
      </div>
    </button>`;
}

function continueRow(list, title) {
  if (!list.length) return '';
  return `
    <section class="section">
      <div class="section-head"><h2>${title}</h2><span class="muted">${list.length} with save states</span></div>
      <div class="row-scroll">${list.slice(0, 24).map(continueCard).join('')}</div>
    </section>`;
}

function viewHome() {
  const systems = lib().systems;
  const anyConfigured = systems.some((s) => s.configured || s.saveCount);
  const totalGames = lib().games.length;

  const welcome = anyConfigured ? '' : `
    <section class="welcome">
      <h2>Let's set up your library</h2>
      <ol>
        <li>RetroArch (with its cores) and Dolphin are already set up. None of them need a BIOS.</li>
        <li>In <b>Settings</b>, under <b>Consoles</b>, click <b>Add folder</b> and choose where you keep each console's games.</li>
        <li>Your save states are found automatically and show up under <b>Continue Playing</b>.</li>
      </ol>
      <button class="nav btn primary" data-key="welcome-settings" data-action="settings">Open Settings</button>
    </section>`;

  const tiles = systems.map((s) => {
    const foot = s.configured
      ? `${s.gameCount} game${s.gameCount === 1 ? '' : 's'}${s.saveCount ? ` · ${s.saveCount} with saves` : ''}`
      : (s.saveCount ? `${s.saveCount} with saves · add games` : (s.emulatorReady ? 'Add your games folder' : 'Set up'));
    return `
      <button class="nav console-tile ${s.configured || s.saveCount ? '' : 'dim'}" data-key="tile-${s.id}" data-action="system" data-id="${s.id}" style="${colorVars(s)}">
        <span class="console-mark ${s.short.length > 4 ? 'long' : ''}">${esc(s.short)}</span>
        <span class="console-year">${s.year}</span>
        <span class="console-name">${esc(s.name)}</span>
        <span class="console-maker">${esc(s.maker)}</span>
        <span class="console-foot">${esc(foot)}</span>
      </button>`;
  }).join('');

  return `
    <header class="page-head">
      <h1>Library</h1>
      <p class="muted">${totalGames} game${totalGames === 1 ? '' : 's'} across ${systems.filter((s) => s.configured).length} console${systems.filter((s) => s.configured).length === 1 ? '' : 's'}</p>
    </header>
    ${welcome}
    ${continueRow(lib().continuePlaying, 'Continue Playing')}
    <section class="section">
      <div class="section-head"><h2>Consoles</h2><span class="muted hint">LB / RB to switch consoles</span></div>
      <div class="console-grid">${tiles}</div>
    </section>`;
}

function gameTile(g) {
  const sys = sysById(g.systemId);
  const sub = [g.lastPlayed ? ago(g.lastPlayed) : '', g.saves.length ? `${g.saves.length} save${g.saves.length > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(' · ');
  return `
    <button class="nav game-tile" data-key="game-${g.id}" data-action="detail" data-id="${g.id}">
      <div class="cover art" style="${colorVars(sys)}" data-cover="${g.id}">
        <span class="ph-sys">${esc(sys.short)}</span>
        <span class="ph-title">${esc(g.title)}</span>
        ${g.saves.length ? '<span class="save-dot" title="Has save states"></span>' : ''}
      </div>
      <div class="tile-title">${esc(g.title)}</div>
      <div class="tile-sub">${esc(sub) || '&nbsp;'}</div>
    </button>`;
}

function viewSystem(sys) {
  const emu = emuOf(sys);
  const all = lib().games.filter((g) => g.systemId === sys.id);
  const q = state.query.trim().toLowerCase();
  let list = q ? all.filter((g) => g.title.toLowerCase().includes(q) || (g.key || '').toLowerCase().includes(q)) : all.slice();
  if (state.sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
  else list.sort((a, b) => (b.lastPlayed - a.lastPlayed) || a.title.localeCompare(b.title));

  const cont = lib().continuePlaying.filter((g) => g.systemId === sys.id);
  const engine = sys.coreName ? `${emu.name} · ${sys.coreName}` : emu.name;
  let chip;
  if (sys.emulatorReady) chip = `<span class="chip ok">${esc(engine)} ready</span>`;
  else if (emu.found && sys.coreName) chip = `<button class="nav chip bad" data-key="chip-setup" data-action="settings">${esc(sys.coreName)} core missing</button>`;
  else chip = `<button class="nav chip bad" data-key="chip-setup" data-action="settings">${esc(emu.name)} not set up</button>`;

  let body;
  if (!sys.configured) {
    body = `
      <div class="empty">
        <h3>Add your ${esc(sys.short)} games</h3>
        <p>Choose the folder where you keep your ${esc(sys.name)} games. Supported files: ${esc(sys.extensions.join(', '))}</p>
        <button class="nav btn primary" data-key="empty-add" data-action="add-romdir" data-id="${sys.id}">Choose games folder</button>
      </div>`;
  } else if (!all.length) {
    body = `
      <div class="empty">
        <h3>No ${esc(sys.short)} games found</h3>
        <p>Nothing matching ${esc(sys.extensions.join(', '))} was found in your folder. Check the folder in Settings, then Rescan.</p>
        <button class="nav btn" data-key="empty-settings" data-action="settings">Open Settings</button>
      </div>`;
  } else {
    body = `
      <div class="toolbar">
        <input class="nav search" data-key="search" id="search" type="search" placeholder="Search ${esc(sys.short)} games" value="${esc(state.query)}" autocomplete="off">
        <div class="seg">
          <button class="nav ${state.sort === 'recent' ? 'on' : ''}" data-key="sort-recent" data-action="sort" data-id="recent">Recently played</button>
          <button class="nav ${state.sort === 'az' ? 'on' : ''}" data-key="sort-az" data-action="sort" data-id="az">A–Z</button>
        </div>
        <span class="muted">${list.length} of ${all.length}</span>
      </div>
      ${list.length ? `<div class="game-grid">${list.map(gameTile).join('')}</div>` : '<p class="muted">No games match your search.</p>'}`;
  }

  return `
    <nav class="crumbs"><button class="nav link" data-key="crumb-home" data-action="home">Library</button><span>›</span><span>${esc(sys.name)}</span></nav>
    <header class="sys-head" style="${colorVars(sys)}">
      <span class="sys-mark">${esc(sys.short)}</span>
      <div>
        <h1>${esc(sys.name)}</h1>
        <p>${esc(sys.maker)} · ${sys.year} · ${all.length} game${all.length === 1 ? '' : 's'}</p>
      </div>
      <div class="sys-chips">${chip}</div>
    </header>
    ${continueRow(cont, `Continue Playing on ${esc(sys.short)}`)}
    <section class="section">${body}</section>`;
}

function renderDetail() {
  const root = $('#detail-root');
  const g = state.detailId && gameById(state.detailId);
  if (!g) { root.innerHTML = ''; return; }
  const sys = sysById(g.systemId);
  const emu = emuOf(sys);
  const latest = g.saves[0];
  const canPlay = !g.orphan;

  const notice = !sys.emulatorReady
    ? `<div class="notice">To play this you need ${esc(emu.name)}. <button class="nav link" data-key="d-setup" data-action="settings">Set the ${esc(emu.name)} path in Settings</button></div>`
    : (g.orphan ? `<div class="notice">This save's game file wasn't found. Add the folder with the ${esc(sys.short)} game (ID ${esc(g.key)}) in Settings, then Rescan.</div>` : '');

  const saves = g.saves.length ? g.saves.map((s) => `
      <button class="nav save-row" data-key="save-${esc(s.file)}" data-action="load-state" data-id="${g.id}" data-file="${esc(s.file)}" ${canPlay ? '' : 'disabled'}>
        <span class="save-thumb art" style="${colorVars(sys)}" ${s.thumb ? `data-thumb="${esc(s.thumb)}"` : ''}></span>
        <span class="save-info"><b>${esc(slotLabel(s.slot))}</b><span class="muted">${esc(fullDate(s.mtime))} · ${esc(ago(s.mtime))}</span></span>
        <span class="save-go">${canPlay ? 'Load' : ''}</span>
      </button>`).join('')
    : '<p class="muted">No save states yet. Save inside the emulator and they will appear here.</p>';

  root.innerHTML = `
    <div class="overlay" data-action="close-detail-bg">
      <aside class="detail" role="dialog" aria-label="${esc(g.title)}">
        <button class="close-btn" data-action="close-detail" aria-label="Close">${ICON.close}</button>
        <div class="detail-hero" style="${colorVars(sys)}">
          <div class="cover art detail-cover" style="${colorVars(sys)}" data-cover="${g.id}">
            <span class="ph-sys">${esc(sys.short)}</span><span class="ph-title">${esc(g.title)}</span>
          </div>
          <div class="detail-head">
            <span class="badge" style="${colorVars(sys)}">${esc(sys.name)}</span>
            <h2>${esc(g.title)}</h2>
            <p class="muted">${g.lastPlayed ? `Last played ${esc(ago(g.lastPlayed))}` : 'Never played'}</p>
            <div class="actions">
              <button class="nav btn play" data-key="d-play" data-action="play" data-id="${g.id}" ${canPlay ? '' : 'disabled'}>${ICON.play}<span>Play</span></button>
              ${latest ? `<button class="nav btn" data-key="d-resume" data-action="load-state" data-id="${g.id}" data-file="${esc(latest.file)}" ${canPlay ? '' : 'disabled'}>${ICON.resume}<span>Resume latest save</span></button>` : ''}
            </div>
            ${notice}
          </div>
        </div>
        <div class="detail-body">
          <h3>Save states</h3>
          <div class="save-list">${saves}</div>
          <h3>Details</h3>
          <dl class="facts">
            <dt>Emulator</dt><dd>${esc(emu.name)}</dd>
            ${g.key ? `<dt>${{ gcid: 'Game ID', serial: 'Disc serial' }[sys.idType] || 'Save name'}</dt><dd>${esc(sys.idType === 'name' ? (g.rawName || g.key) : g.key)}</dd>` : ''}
            ${g.file ? `<dt>File</dt><dd class="path">${esc(g.file)}</dd>` : ''}
          </dl>
          ${g.file ? `<button class="nav btn small" data-key="d-show" data-action="show-file" data-file="${esc(g.file)}">Show in folder</button>` : ''}
        </div>
      </aside>
    </div>`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function viewSettings() {
  const s = state.snap.settings;
  const systems = lib().systems;
  const emus = state.snap.emulators;

  const emuRows = Object.entries(emus).map(([key, e]) => {
    const p = s.emulators[key].path;
    const inUse = systems.filter((x) => x.emulator === key).map((x) => x.short);
    const usedBy = inUse.length ? `used for ${inUse.join(', ')}` : `optional for ${e.usableFor.join(', ')}`;
    return `
      <div class="set-card">
        <div class="set-row">
          <div class="set-title"><b>${esc(e.name)}</b><span class="muted">${esc(usedBy)}</span></div>
          ${p ? (e.found ? '<span class="chip ok">Ready</span>' : '<span class="chip bad">File not found</span>') : '<span class="chip">Not installed</span>'}
        </div>
        <div class="path-line">${p ? esc(p) : `<span class="muted">Choose ${esc(e.exeHint)} after installing ${esc(e.name)}</span>`}</div>
        <div class="set-actions">
          <button class="nav btn small" data-key="emu-pick-${key}" data-action="pick-emu" data-id="${key}">${p ? 'Change' : 'Choose program'}</button>
          ${p ? `<button class="nav btn small ghost" data-key="emu-clear-${key}" data-action="clear-emu" data-id="${key}">Clear</button>` : ''}
          <button class="nav btn small ghost" data-key="emu-site-${key}" data-action="open-site" data-id="${key}">Get ${esc(e.name)} (${esc(e.site)})</button>
        </div>
        <p class="help">${ICON.pad}<span>${esc(e.controllerHelp)}</span></p>
      </div>`;
  }).join('');

  const sysRows = systems.map((x) => {
    const cfg = s.systems[x.id];
    const picker = x.options.length > 1 ? `
        <div class="set-sub">Emulator</div>
        <div class="opt-list">${x.options.map((o) => `
          <button class="nav opt ${o.id === x.option ? 'on' : ''}" data-key="opt-${x.id}-${esc(o.id)}" data-action="set-emu-option" data-id="${x.id}" data-opt="${esc(o.id)}" role="radio" aria-checked="${o.id === x.option}">
            <span class="radio"></span><span>${esc(o.label)}</span>
          </button>`).join('')}
        </div>` : '';
    const dirs = cfg.romDirs.length
      ? cfg.romDirs.map((d, i) => `
          <div class="dir-line"><span class="path">${esc(d)}</span>
            <button class="nav btn small ghost" data-key="rd-rm-${x.id}-${i}" data-action="remove-romdir" data-id="${x.id}" data-index="${i}">Remove</button></div>`).join('')
      : '<div class="muted">No games folder yet.</div>';
    const stateNote = cfg.stateDir ? 'custom' : 'found automatically';
    return `
      <div class="set-card" id="set-${x.id}">
        <div class="set-row">
          <div class="set-title"><span class="dot" style="${colorVars(x)}"></span><b>${esc(x.name)}</b><span class="muted">${esc(emus[x.emulator].name)}${x.coreName ? ` · ${esc(x.coreName)} core` : ''}</span></div>
          ${x.emulatorReady ? '<span class="chip ok">Ready</span>' : '<span class="chip bad">Not ready</span>'}
        </div>
        ${picker}
        <div class="set-sub">Games folders</div>
        ${dirs}
        <div class="set-actions"><button class="nav btn small" data-key="rd-add-${x.id}" data-action="add-romdir" data-id="${x.id}">Add folder</button></div>
        <div class="set-sub">Save states folder <span class="muted">(${stateNote})</span></div>
        <div class="dir-line"><span class="path">${x.stateDir ? esc(x.stateDir) : '<span class="muted">Set the emulator path first</span>'}</span>
          ${x.stateDir ? (x.stateDirExists ? '<span class="chip ok">Found</span>' : '<span class="chip">Not created yet</span>') : ''}</div>
        <div class="set-actions">
          <button class="nav btn small ghost" data-key="sd-pick-${x.id}" data-action="pick-statedir" data-id="${x.id}">Change</button>
          ${cfg.stateDir ? `<button class="nav btn small ghost" data-key="sd-reset-${x.id}" data-action="reset-statedir" data-id="${x.id}">Use default</button>` : ''}
        </div>
      </div>`;
  }).join('');

  const toggle = (key, label, desc) => `
    <button class="nav toggle ${s[key] ? 'on' : ''}" data-key="tg-${key}" data-action="toggle" data-id="${key}" role="switch" aria-checked="${!!s[key]}">
      <span class="switch"></span><span><b>${label}</b><span class="muted">${desc}</span></span>
    </button>`;

  return `
    <nav class="crumbs"><button class="nav link" data-key="crumb-home" data-action="home">Library</button><span>›</span><span>Settings</span></nav>
    <header class="page-head"><h1>Settings</h1><p class="muted">Changes save automatically.</p></header>

    <section class="section">
      <h2>Steam Controller</h2>
      <div class="set-card steam">
        <ol>
          <li>In Steam, click <b>Games › Add a Non-Steam Game to My Library › Browse</b> and choose the program below.</li>
          <li>Open that entry's <b>Properties</b> and set <b>Launch Options</b> to the text below (it opens the library full screen).</li>
          <li>Start Retro Library from Steam. Steam Input presents your Steam Controller as an Xbox controller, both here and in the emulators it opens.</li>
          <li>Set each emulator's controls once (see the tip under each emulator below).</li>
        </ol>
        <div class="steam-paths">
          <span class="muted">Program</span><code>${esc(state.snap.steam.target)}</code>
          <span class="muted">Launch Options</span><code>${esc(state.snap.steam.launchOptions)}</code>
        </div>
        <p class="help">Controls here: D-pad/stick move · A open/play · B back · X resume latest save · Y search · LB/RB switch console · Start settings. Keyboard arrows, Enter and Esc work too; F11 toggles full screen.</p>
      </div>
    </section>

    <section class="section"><h2>Emulators</h2><div class="set-grid">${emuRows}</div></section>
    <section class="section"><h2>Consoles</h2><div class="set-grid">${sysRows}</div></section>
    <section class="section">
      <h2>General</h2>
      <div class="set-grid">
        ${toggle('hideWhilePlaying', 'Minimize while playing', 'The library steps aside when a game starts and comes back when you quit.')}
        ${toggle('boxArt', 'Download box art', 'Fetch covers by game name from thumbnails.libretro.com and cache them. Works best with No-Intro/Redump file names.')}
      </div>
    </section>`;
}

async function saveSettings(mutator) {
  const draft = JSON.parse(JSON.stringify(state.snap.settings));
  mutator(draft);
  state.snap = await api.saveSettings(draft);
  coverCache.clear();
  render();
}

// ---------------------------------------------------------------------------
// Art (covers and save-state screenshots), loaded lazily
// ---------------------------------------------------------------------------
const artObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    artObserver.unobserve(e.target);
    loadArt(e.target);
  }
}, { rootMargin: '300px' });

function setArt(el, url) {
  if (!url || !el.isConnected) return;
  el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
  el.classList.add('has-art');
}

async function loadArt(el) {
  const thumb = el.dataset.thumb;
  if (thumb) {
    if (!fileUrlCache.has(thumb)) fileUrlCache.set(thumb, await api.fileUrl(thumb));
    if (fileUrlCache.get(thumb)) { setArt(el, fileUrlCache.get(thumb)); return; }
  }
  const id = el.dataset.cover;
  if (!id) return;
  if (!coverCache.has(id)) coverCache.set(id, api.cover(id));
  setArt(el, await coverCache.get(id));
}

function hydrateArt() {
  document.querySelectorAll('.art').forEach((el) => {
    if (el.dataset.cover || el.dataset.thumb) artObserver.observe(el);
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function go(view, systemId) {
  state.view = view;
  if (systemId !== undefined) {
    if (state.systemId !== systemId) state.query = '';
    state.systemId = systemId;
  }
  state.detailId = null;
  render();
  $('#main').scrollTop = 0;
  const first = $('#main').querySelector('.section .nav, .empty .nav') || $('#main').querySelector('.nav');
  if (first) first.focus({ preventScroll: true });
}

async function play(gameId, stateFile) {
  const g = gameById(gameId);
  toast(`Starting ${g ? g.title : 'game'}…`);
  const r = await api.launch(gameId, stateFile || null);
  if (!r.ok) toast(r.error, 'error');
}

const actions = {
  home: () => go('home'),
  system: (el) => go('system', el.dataset.id),
  settings: () => go('settings'),
  rescan: async () => { toast('Scanning…'); state.snap = await api.rescan(); coverCache.clear(); render(); toast('Library updated'); },
  detail: (el) => { state.detailId = el.dataset.id; render(); const p = $('.overlay [data-action="play"]:not([disabled])') || $('.overlay .nav'); if (p) p.focus(); },
  'close-detail': () => closeDetail(),
  'close-detail-bg': (el, ev) => { if (ev.target === el) closeDetail(); },
  play: (el) => play(el.dataset.id),
  'load-state': (el) => play(el.dataset.id, el.dataset.file),
  'show-file': (el) => api.showFile(el.dataset.file),
  sort: (el) => { state.sort = el.dataset.id; render(); },
  'open-site': (el) => api.openSite(el.dataset.id),
  'pick-emu': async (el) => {
    const key = el.dataset.id;
    const file = await api.pickFile(`Choose ${state.snap.emulators[key].exeHint}`);
    if (file) saveSettings((d) => { d.emulators[key].path = file; });
  },
  'clear-emu': (el) => saveSettings((d) => { d.emulators[el.dataset.id].path = ''; }),
  'add-romdir': async (el) => {
    const id = el.dataset.id;
    const dir = await api.pickFolder(`Choose your ${sysById(id).name} games folder`);
    if (dir) saveSettings((d) => { if (!d.systems[id].romDirs.includes(dir)) d.systems[id].romDirs.push(dir); });
  },
  'remove-romdir': (el) => saveSettings((d) => { d.systems[el.dataset.id].romDirs.splice(Number(el.dataset.index), 1); }),
  'pick-statedir': async (el) => {
    const id = el.dataset.id;
    const dir = await api.pickFolder(`Choose the ${sysById(id).short} save states folder`);
    if (dir) saveSettings((d) => { d.systems[id].stateDir = dir; });
  },
  'set-emu-option': (el) => saveSettings((d) => { d.systems[el.dataset.id].emulator = el.dataset.opt; }),
  'reset-statedir': (el) => saveSettings((d) => { d.systems[el.dataset.id].stateDir = ''; }),
  toggle: (el) => saveSettings((d) => { d[el.dataset.id] = !d[el.dataset.id]; }),
};

function closeDetail() {
  const id = state.detailId;
  state.detailId = null;
  render();
  const back = id && document.querySelector(`[data-action="detail"][data-id="${CSS.escape(id)}"]`);
  if (back) Nav.focus(back);
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, ev);
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'search') {
    state.query = ev.target.value;
    const pos = ev.target.selectionStart;
    renderMain();
    hydrateArt();
    const s = $('#search');
    if (s) { s.focus(); s.setSelectionRange(pos, pos); }
  }
});

// Controller handlers
Nav.on('back', () => {
  if (state.detailId) closeDetail();
  else if (state.view !== 'home') go('home');
});
Nav.on('resume', (el) => {
  const id = el && el.dataset && el.dataset.id;
  const g = id && gameById(id);
  if (g && g.saves.length && !g.orphan) play(g.id, g.saves[0].file);
  else if (g) toast('No save state for this game yet.');
});
Nav.on('search', () => { const s = $('#search'); if (s) s.focus(); });
Nav.on('settings', () => go('settings'));
Nav.on('cycle', (dir) => {
  const list = lib().systems.filter((s) => s.configured || s.saveCount);
  const pool = list.length ? list : lib().systems;
  const i = state.view === 'system' ? pool.findIndex((s) => s.id === state.systemId) : (dir > 0 ? -1 : 0);
  const next = pool[(i + dir + pool.length) % pool.length];
  if (next) go('system', next.id);
});
Nav.on('status', (connected, id) => {
  state.padName = connected ? (id || 'Controller') : null;
  if (state.snap) renderSidebar();
  if (connected) toast('Controller connected');
});

api.onGameExited(({ error, snapshot }) => {
  state.snap = snapshot;
  render();
  if (error) toast(error, 'error');
  else toast('Welcome back. Save states refreshed.');
});

(async function init() {
  state.snap = await api.getLibrary();
  render();
  const first = $('#main .nav');
  if (first) first.focus({ preventScroll: true });
})();
