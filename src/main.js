'use strict';

const {
  app, BrowserWindow, WebContentsView, Tray, Menu, globalShortcut, screen, ipcMain, nativeImage, shell, dialog, clipboard, crashReporter,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const appbar = require('./appbar');
const vault = require('./vault');

// SV_TEST=1 runs the built-in self-test (src/selftest.js) in a hidden window with its own throwaway profile, so it
// never touches the real settings or a Side View that's already running. See selftest.js.
const TEST = process.env.SV_TEST === '1';
if (TEST) app.setPath('userData', path.join(app.getPath('temp'), `side-view-test-${process.pid}`));

// If Side View ever crashes, keep the evidence: Chromium crash dumps in userData/Crashpad (never uploaded) and a
// short log in userData/side-view.log of crashed pages, crashed helper processes and uncaught errors.
crashReporter.start({ uploadToServer: false });
function logLine(msg) {
  try {
    const file = path.join(app.getPath('userData'), 'side-view.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}
`);
  } catch { /* logging must never take the app down */ }
}

const HEADER_H = 26;    // a screen's own bar (address, mute, ...)
const TOOLBAR_H = 36;   // the settings bar across the top
const TAB_H = 16;       // the settings bar turned off: a slim strip with a tab that brings it back
const TICKER_H = 24;    // optional scores along the bottom
const HIDDEN_H = 28;    // chips for turned-off and floating screens
const BLOCK_H = 24;     // the red popup-blocked bar under a screen's header
const FRAME_H = 8;      // resize strip under each screen
const FRAME_W = 6;      // resize strips on each side of a screen
const SNAP = 8;         // positions and sizes snap to this many px when you let go
const MIN_FREE_W = 200;
const MIN_FREE_H = 140;
const LEAGUES = [
  ['NBA', 'basketball/nba'],
  ['WNBA', 'basketball/wnba'],
  ['College basketball', 'basketball/mens-college-basketball'],
  ['NFL', 'football/nfl'],
  ['College football', 'football/college-football'],
  ['Premier League', 'soccer/eng.1'],
  ['Champions League', 'soccer/uefa.champions'],
  ['La Liga', 'soccer/esp.1'],
  ['MLS', 'soccer/usa.1'],
];
const ZOOM_PRESETS = [0.3, 0.4, 0.5, 0.6, 0.75];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const MIN_PANES = 2;
const MAX_PANES = 6;
const MAX_FAVORITES = 16;
const DOCK_EDGES = ['left', 'right', 'top', 'bottom'];
const DOCK_MIN = 0.2;
const DOCK_MAX = 0.8;
const DISCORD_INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,40}$/;
const WINDOW_COUNT = 3; // saved workspaces: "Window 1" .. "Window 3"
// presets: all in a row (equal widths), main + side column, main in the middle, even grid
const ARRANGE_STYLES = ['row', 'side', 'center', 'grid'];
// "show only video": off, whole video in the box, video fills the box (edges cropped), or fills it keeping the bottom
// of the picture (where score bugs and tickers live) and cropping from the top
const FIT_MODES = ['off', 'fit', 'fill', 'bottom'];
const PIP_W = 480; // a popped-out screen's starting size
const PIP_H = 270;
// Speed switches the self-test flips for A/B runs. The defaults are the faster choices it measured.
const PERF = {
  favoritesEveryState: false, // false: favorites (with their icons) go to the shell only when they change
  panelThrottleMs: 100, // the control panel gets at most one update per this many ms
  frameMs: 8, // how often drags, glides and fades step
  glideStills: true, // glide photos of the screens instead of the live pages (no black flashes) (16 lands on ~31 ms Windows ticks: 33 fps; 8 gives ~63 fps)
};
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

let cfg;
let win = null;
let tray = null;
let settingsWin = null;
let lastExport = ''; // the Chrome password file last imported, so settings can offer to bin it
let shellReady = false;
let visible = false;
let quitting = false;
let saveTimer = null;
let coverTimer = null;
let focusedId = ''; // the screen you last clicked: favorites open there
const views = new Map(); // pane id -> { view, muted, audible, title, favicon, fit, fs, pip, ... }

// ---------- config ----------

const configPath = () => path.join(app.getPath('userData'), 'config.json');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultConfig() {
  return {
    displayId: 0, // which monitor the wall covers (0 = primary)
    active: 0, // which window (workspace) is showing
    windows: [], // every window's own screens; the active one lives in the top-level panes/free fields
    freeLocked: false, // freeze the whole arrangement
    free: {}, // where each screen sits on the current monitor, as fractions of the wall: { id: { x, y, w, h } }
    freeBy: {}, // the same, remembered per monitor: { displayId: free }
    arrangeStyle: 'center', // preset for a fresh arrangement, and the starting layout on every monitor
    coverTaskbar: false, // cover the whole monitor, taskbar included
    dockOn: false, // take only part of the monitor and reserve it, so other apps' windows fill the rest
    dockEdge: 'right', // which edge the reserved part sits on: left, right, top, bottom
    dockSize: 0.5, // how much of the monitor it takes (of the width for left/right, of the height for top/bottom)
    topBar: true, // the settings bar across the top
    onTop: true, // stay above other windows
    glass: true, // frosted bars with rounded corners and light animations
    ticker: false, // scores along the bottom
    league: 'basketball/nba',
    zoom: 0.4,
    sharedLogins: false, // every screen uses one login session instead of its own
    boxes: true, // false = no header bars, gaps or frames: the screens butt up into one picture
    favorites: [], // [{ url, title, icon }] icon is a data: URL or ''
    discordInvite: '', // the Side View .1107 server's invite link, for the control panel's "Open Discord"
    siteZoom: {}, // page zoom remembered per website: { 'pluto.tv': 0.6 }
    panes: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, url: '', zoom: 0.4 })),
  };
}

function cleanFree(obj) {
  const free = {};
  for (const [id, r] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) free[id] = { x: r.x, y: r.y, w: r.w, h: r.h };
  }
  return free;
}

function cleanFreeBy(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) out[k] = cleanFree(v);
  return out;
}

function cleanFavorites(list) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.url !== 'string' || !/^https?:\/\//i.test(f.url) || seen.has(f.url)) continue;
    seen.add(f.url);
    out.push({
      url: f.url,
      title: cleanTitle(typeof f.title === 'string' ? f.title : '', f.url),
      icon: typeof f.icon === 'string' && f.icon.startsWith('data:image/') ? f.icon : '',
    });
  }
  return out.slice(0, MAX_FAVORITES);
}

// A short name for a favorite from the page's title: drop the site's own name and filler words.
//   "Watch NFL Channel: Live TV Channel for Free | Pluto TV" -> "NFL Channel"
//   "Big game highlights - YouTube" -> "Big game highlights"
//   "ESPN - Serving Sports Fans. Anytime. Anywhere." -> "ESPN"
function cleanTitle(title, url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* keep '' */ }
  const squash = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const siteKey = squash(host.replace(/\.[a-z]{2,}$/i, '')); // "pluto" for pluto.tv
  const isSiteName = (part) => {
    const q = squash(part);
    return Boolean(siteKey) && (q === squash(host) || (q.startsWith(siteKey) && q.length <= siteKey.length + 4));
  };
  const all = String(title || '').split(/\s+[|•·–—-]\s+/).map((x) => x.trim()).filter(Boolean);
  const rest = all.filter((x) => !isSiteName(x));
  // the site's own name first ("ESPN - Serving Sports Fans") or alone ("Discord") is the best name; otherwise the page part
  const pick = all.length && (isSiteName(all[0]) || !rest.length) ? all[0] : rest[0] || '';
  let t = pick.split(/:\s+/)[0];
  t = t.replace(/^(watch|stream|live)\s+/i, '').replace(/\s+(live stream|live|online|for free|free)$/i, '').trim();
  return (t || host || String(title || '')).slice(0, 40);
}

function cleanPanes(list, prefix, min, zoom) {
  const seen = new Set();
  const panes = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p.id !== 'string' || seen.has(p.id)) continue;
    seen.add(p.id);
    panes.push({
      id: p.id,
      url: typeof p.url === 'string' && /^https?:\/\//i.test(p.url) ? p.url : '',
      zoom: clamp(Number(p.zoom) || zoom, ZOOM_MIN, ZOOM_MAX),
      hidden: p.hidden === true,
      locked: p.locked === true, // this screen stays where it is: no moving, resizing or swapping
    });
  }
  let n = 1;
  while (panes.length < min) {
    while (seen.has(`${prefix}${n}`)) n += 1;
    seen.add(`${prefix}${n}`);
    panes.push({ id: `${prefix}${n}`, url: '', zoom });
  }
  return panes.slice(0, MAX_PANES);
}

function loadConfig() {
  const base = defaultConfig();
  let saved = {};
  try {
    // a byte-order mark (some editors add one) would make JSON.parse fail and silently reset everything
    saved = JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, ''));
  } catch {
    saved = {}; // first run or unreadable: build everything from the defaults (including the other windows)
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const out = { ...base, ...saved };
  // settings from the old docked strip
  for (const k of ['width', 'locked', 'side', 'collapsed', 'mode', 'layout', 'mainW']) delete out[k];
  out.zoom = clamp(Number(out.zoom) || base.zoom, ZOOM_MIN, ZOOM_MAX);
  out.ticker = out.ticker === true;
  out.free = cleanFree(out.free);
  out.freeBy = cleanFreeBy(out.freeBy);
  out.freeLocked = out.freeLocked === true;
  out.arrangeStyle = ARRANGE_STYLES.includes(out.arrangeStyle) ? out.arrangeStyle : base.arrangeStyle;
  out.coverTaskbar = out.coverTaskbar === true;
  out.dockOn = out.dockOn === true;
  out.dockEdge = DOCK_EDGES.includes(out.dockEdge) ? out.dockEdge : base.dockEdge;
  out.dockSize = clamp(Number(out.dockSize) || base.dockSize, DOCK_MIN, DOCK_MAX);
  out.topBar = out.topBar !== false;
  out.onTop = out.onTop !== false;
  out.glass = out.glass !== false;
  out.sharedLogins = out.sharedLogins === true;
  out.boxes = out.boxes !== false;
  out.favorites = cleanFavorites(out.favorites);
  out.discordInvite = DISCORD_INVITE.test(String(out.discordInvite || '')) ? out.discordInvite : '';
  out.siteZoom = Object.fromEntries(Object.entries(out.siteZoom && typeof out.siteZoom === 'object' ? out.siteZoom : {})
    .filter(([site, z]) => /^[a-z0-9.-]{1,253}$/i.test(site) && Number.isFinite(Number(z)))
    .slice(-200)
    .map(([site, z]) => [site, clamp(Number(z), ZOOM_MIN, ZOOM_MAX)]));
  if (!LEAGUES.some(([, id]) => id === out.league)) out.league = base.league;

  out.displayId = Number.isFinite(Number(out.displayId)) ? Number(out.displayId) : 0;
  out.active = clamp(Math.round(Number(out.active)) || 0, 0, WINDOW_COUNT - 1);
  out.panes = cleanPanes(saved.panes || base.panes, 'p', MIN_PANES, out.zoom);
  // The active window is the top-level fields; the others come from `windows`.
  const others = Array.isArray(saved.windows) ? saved.windows : [];
  out.windows = Array.from({ length: WINDOW_COUNT }, (_, k) => {
    if (k === out.active) return { panes: out.panes, free: out.free, freeBy: out.freeBy, freeLocked: out.freeLocked };
    const w = others[k] && typeof others[k] === 'object' ? others[k] : {};
    return {
      panes: cleanPanes(w.panes, `w${k + 1}p`, 4, out.zoom), // a fresh window starts with four empty screens
      free: cleanFree(w.free),
      freeBy: cleanFreeBy(w.freeBy),
      freeLocked: w.freeLocked === true,
    };
  });
  return out;
}

// The top-level panes/free fields are the active window on the current monitor; copy them into their slots
// before saving or switching.
function stashWindow() {
  cfg.freeBy[String(cfg.displayId)] = cfg.free;
  cfg.windows[cfg.active] = { panes: cfg.panes, free: cfg.free, freeBy: cfg.freeBy, freeLocked: cfg.freeLocked };
}

// Screen ids must be unique across all windows (they name the page views).
const idTaken = (id) => cfg.windows.some((w) => w.panes.some((p) => p.id === id)) || cfg.panes.some((p) => p.id === id);

function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      stashWindow();
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
    } catch (err) {
      console.error('[side-view] could not save settings:', err.message);
    }
  }, 300);
}

const paneById = (id) => cfg.panes.find((p) => p.id === id);

// ---------- helpers ----------

function normalizeInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(s)) return `http://${s}`;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function fromShell(e) {
  return win && !win.isDestroyed() && e.sender === win.webContents;
}

// ---------- placing the window on a monitor ----------

// dipToScreenRect / screenToDipRect exist on Windows only; elsewhere pixels and DIPs are treated as equal.
const IS_WIN = process.platform === 'win32';
const pxToDip = (r) => (IS_WIN ? screen.screenToDipRect(null, r) : r);

// The monitor the wall covers. Falls back to the primary one if that monitor isn't connected any more.
function targetDisplay() {
  return screen.getAllDisplays().find((d) => d.id === cfg.displayId) || screen.getPrimaryDisplay();
}

// Windows' monitor list, read once and again only when monitors change (plugged in, removed, resolution, taskbar).
// It used to be read on every screen update, up to 60 times a second.
let monitorCache = null;
const monitorsNow = () => monitorCache || (monitorCache = appbar.monitors());
const forgetMonitors = () => { monitorCache = null; };

// A display's rectangles in physical pixels, from Windows itself. screen.dipToScreenRect(null, ...) converts with the
// PRIMARY display's scale and Electron's nativeOrigin is wrong for a second monitor with different scaling, so
// ask Windows for the monitor rectangles and match them to Electron's displays by size.
function physical(display) {
  if (!IS_WIN) return { bounds: display.bounds, work: display.workArea, scale: 1 };
  const sf = display.scaleFactor;
  const wantW = display.size.width * sf;
  const wantH = display.size.height * sf;
  const mons = monitorsNow();
  if (mons.length) {
    const near = (m) => Math.abs(m.bounds.width - wantW) <= 3 && Math.abs(m.bounds.height - wantH) <= 3;
    const same = screen.getAllDisplays()
      .filter((d) => Math.abs(d.size.width * d.scaleFactor - wantW) <= 3 && Math.abs(d.size.height * d.scaleFactor - wantH) <= 3)
      .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    const cands = mons.filter(near).sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    // identical monitors are told apart by left-to-right order
    const m = display.id === screen.getPrimaryDisplay().id
      ? (cands.find((c) => c.primary) || cands[0])
      : cands.filter((c) => !c.primary || cands.length === 1)[Math.max(0, same.filter((d) => d.id !== screen.getPrimaryDisplay().id).findIndex((d) => d.id === display.id))] || cands[0];
    if (m) return { scale: sf, bounds: m.bounds, work: m.work };
  }
  const b = display.bounds;
  const w = display.workArea;
  const o = display.nativeOrigin || { x: Math.round(b.x * sf), y: Math.round(b.y * sf) };
  return {
    scale: sf,
    bounds: { x: o.x, y: o.y, width: Math.round(b.width * sf), height: Math.round(b.height * sf) },
    work: { x: o.x + Math.round((w.x - b.x) * sf), y: o.y + Math.round((w.y - b.y) * sf), width: Math.round(w.width * sf), height: Math.round(w.height * sf) },
  };
}

// Windows tells a window when it lands on a monitor with different scaling, and Chromium then resizes it, undoing
// the move. So check where the window actually ended up and place it again until it matches. done() runs once
// it has settled.
let placeToken = 0;
function placeUntilItSticks(move, target, done) {
  const token = ++placeToken;
  const attempt = (n) => {
    if (token !== placeToken || !win || win.isDestroyed()) return; // a newer placement took over
    move();
    setTimeout(() => {
      if (token !== placeToken || !win || win.isDestroyed()) return;
      const r = appbar.windowRect(win.getNativeWindowHandle());
      const close = (a, b) => Math.abs(a - b) <= 2;
      const ok = !r || (close(r.left, target.left) && close(r.top, target.top) && close(r.right, target.right) && close(r.bottom, target.bottom));
      if (!ok && n < 5) attempt(n + 1);
      else if (done) done();
    }, n === 0 ? 120 : 300);
  };
  attempt(0);
}

// Docked: reserve a band along one edge of the monitor the way the taskbar does, so Windows shrinks the work area and
// other apps' maximized and snapped windows fill what's left. Returns the band Windows granted (physical pixels).
const docked = () => cfg.dockOn && IS_WIN && appbar.available();
// All of these Windows calls run on a background thread (see appbar.js): done synchronously they crashed the app.
// They also run strictly one after another: an edge change, a size change and Windows' own "a docked band moved"
// message can all arrive together, and interleaved they released a band mid-placement and fell back to full screen.
let bandChain = Promise.resolve();
function inOrder(fn) {
  const run = bandChain.then(fn, fn);
  bandChain = run.catch(() => {});
  return run;
}

async function reserveBandNow() {
  const { bounds } = physical(targetDisplay());
  if (!appbar.isRegistered()) await appbar.registerAsync(win.getNativeWindowHandle());
  const across = cfg.dockEdge === 'left' || cfg.dockEdge === 'right' ? bounds.width : bounds.height;
  const rc = await appbar.setPosAsync(bounds, Math.round(across * cfg.dockSize), cfg.dockEdge); // Windows keeps it clear of the taskbar
  forgetMonitors(); // our reservation just changed the work area
  return rc;
}
async function releaseBandNow() {
  if (!appbar.isRegistered()) return;
  await appbar.unregisterAsync();
  forgetMonitors();
}
// Give the reserved band back (hiding, undocking, or before moving to another monitor).
const releaseBand = () => inOrder(releaseBandNow);

// Cover the monitor: its work area, or (coverTaskbar) all of it. Docked: just the reserved band.
let coverToken = 0;
const coverScreen = (done) => inOrder(() => coverScreenNow(done));
async function coverScreenNow(done) {
  if (!win || win.isDestroyed()) return;
  const token = ++coverToken;
  let rc = null;
  try {
    if (docked()) {
      rc = await reserveBandNow();
      if (!rc) { await releaseBandNow(); rc = await reserveBandNow(); } // one clean retry before giving up
    }
    if (!rc) await releaseBandNow();
  } catch (err) {
    logLine(`docking failed: ${err.message}`);
  }
  if (token !== coverToken || !win || win.isDestroyed()) return; // a newer placement took over
  if (!rc) {
    const { bounds: full, work: wa } = physical(targetDisplay());
    const r = cfg.coverTaskbar ? full : wa;
    rc = { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  }
  const target = rc;
  const move = () => {
    appbar.moveWindowAsync(win.getNativeWindowHandle(), target, cfg.onTop)
      .then((ok) => { if (!ok && !win.isDestroyed()) win.setBounds(pxToDip({ x: target.left, y: target.top, width: target.right - target.left, height: target.bottom - target.top })); })
      .catch((err) => logLine(`move failed: ${err.message}`));
  };
  placeUntilItSticks(move, target, () => { layoutPanes(); if (done) done(); });
}

const scheduleCover = () => { clearTimeout(coverTimer); coverTimer = setTimeout(() => coverScreen(), 150); };

// Moving between monitors fades out, moves, and fades back in once Windows has finished rescaling.
let fadeTimer = null;
function fadeTo(target, ms = 160) {
  clearInterval(fadeTimer);
  const from = win.getOpacity();
  const start = Date.now();
  fadeTimer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(fadeTimer); return; }
    const t = Math.min(1, (Date.now() - start) / ms);
    win.setOpacity(from + (target - from) * t);
    if (t === 1) clearInterval(fadeTimer);
  }, PERF.frameMs);
}

function showWall() {
  if (!win) return;
  coverScreen();
  layoutPanes();
  win.show();
  win.focus();
  eachPip((pip) => pip.showInactive());
  visible = true;
  refreshTray();
}

function hideWall() {
  if (!win) return;
  win.hide();
  releaseBand(); // the space goes back to your other windows while Side View is hidden
  eachPip((pip) => pip.hide());
  visible = false;
  refreshTray();
}

const toggleWall = () => (visible ? hideWall() : showWall());

function releaseSpace() {
  try { appbar.unregister(); } catch { /* nothing reserved */ }
}

// ---------- monitors ----------

function displayList() {
  const prim = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    index: i + 1,
    name: d.label || `Monitor ${i + 1}`,
    size: (() => { const b = physical(d).bounds; return `${b.width}x${b.height}`; })(), // real pixels from Windows, not a rounded DIP x scale
    primary: d.id === prim,
    current: d.id === targetDisplay().id,
  }));
}

// Every monitor starts from the same layout (the one you're looking at); changes made on a monitor stay with it.
function setDisplay(id) {
  if (!win || id === targetDisplay().id) { coverScreen(); return; }
  stopTween();
  cfg.freeBy[String(cfg.displayId)] = cfg.free;
  releaseBand(); // a reservation belongs to one monitor; coverScreen makes a new one on the next
  cfg.displayId = id;
  const mine = cfg.freeBy[String(id)];
  cfg.free = mine && Object.keys(mine).length ? { ...mine } : JSON.parse(JSON.stringify(cfg.free));
  ensurePlaced();
  saveConfig();
  fadeTo(0, 120);
  setTimeout(() => coverScreen(() => fadeTo(1, 200)), 130);
  refreshTray();
}

function nextDisplay() {
  const all = screen.getAllDisplays();
  if (all.length < 2) return;
  const i = all.findIndex((d) => d.id === targetDisplay().id);
  setDisplay(all[(i + 1) % all.length].id);
}

function monitorMenu() {
  return displayList().map((d) => ({
    label: `${d.index}: ${d.name}  ${d.size}${d.primary ? '  (main)' : ''}`,
    type: 'radio',
    checked: d.current,
    click: () => setDisplay(d.id),
  }));
}

// Drag the settings bar: the whole wall follows the pointer, and lands on whichever monitor you let go over.
let wallDrag = null;
function setWallDrag(on) {
  clearInterval(wallDrag?.timer);
  if (!on) {
    if (!wallDrag) return;
    wallDrag = null;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setOpacity(1);
    if (d && d.id !== targetDisplay().id) setDisplay(d.id);
    else coverScreen();
    return;
  }
  const start = screen.getCursorScreenPoint();
  const [x0, y0] = win.getPosition();
  win.setOpacity(0.8);
  wallDrag = {
    timer: setInterval(() => {
      if (appbar.mouseDown() === false) { setWallDrag(false); return; }
      const p = screen.getCursorScreenPoint();
      win.setPosition(Math.round(x0 + p.x - start.x), Math.round(y0 + p.y - start.y));
    }, PERF.frameMs),
  };
}

// ---------- screens ----------

// Screens laid out on the wall: not turned off and not popped out into their own window.
const visiblePanes = () => cfg.panes.filter((p) => !p.hidden && !views.get(p.id)?.pip);
const hiddenCount = () => cfg.panes.length - visiblePanes().length; // each one gets a chip
const anyLocked = () => visiblePanes().some((p) => p.locked);

const topH = () => (cfg.topBar ? TOOLBAR_H : TAB_H);
const bottomH = () => (hiddenCount() > 0 ? HIDDEN_H : 0) + (cfg.ticker ? TICKER_H : 0);
// The area the screens share, in window pixels.
function wall() {
  const [w, h] = win.getContentSize();
  return { W: Math.max(1, w), H: Math.max(1, h - topH() - bottomH()), top: topH() };
}

// Presets. The last screen is the main one.
//   side:   main big on the left, the rest tiled on the right
//   center: a row of small screens across the top, main big in the middle, and (with 3+ others) a wide one
//           along the bottom, e.g. for a scoreboard
//   grid:   every screen the same size
//   row:    every screen side by side, equal widths, full height (2 = halves, 3 = thirds)
function presetLayout(style) {
  const list = visiblePanes();
  const g = 0.004;
  const out = {};
  const put = (p, x, y, w, h) => { out[p.id] = { x: x + g, y: y + g, w: w - 2 * g, h: h - 2 * g }; };
  if (list.length === 0) return out;
  if (list.length === 1) { put(list[0], 0, 0, 1, 1); return out; }
  const main = list[list.length - 1];
  const rest = list.slice(0, -1);
  if (style === 'row') {
    list.forEach((p, k) => put(p, k / list.length, 0, 1 / list.length, 1));
  } else if (style === 'grid') {
    const cols = Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    list.forEach((p, k) => put(p, (k % cols) / cols, Math.floor(k / cols) / rows, 1 / cols, 1 / rows));
  } else if (style === 'center') {
    const bottom = rest.length >= 3 ? rest.pop() : null;
    const topRow = 0.26;
    const botRow = bottom ? 0.2 : 0;
    rest.forEach((p, k) => put(p, k / rest.length, 0, 1 / rest.length, topRow));
    put(main, 0, topRow, 1, 1 - topRow - botRow);
    if (bottom) put(bottom, 0, 1 - botRow, 1, botRow);
  } else {
    const mainW = 0.62;
    put(main, 0, 0, mainW, 1);
    const cols = rest.length >= 4 ? 2 : 1;
    const rows = Math.ceil(rest.length / cols);
    const cw = (1 - mainW) / cols;
    rest.forEach((p, k) => put(p, mainW + (k % cols) * cw, Math.floor(k / cols) / rows, cw, 1 / rows));
  }
  return out;
}

const overlap = (a, b) => a.x < b.x + b.w - 1e-4 && a.x + a.w > b.x + 1e-4 && a.y < b.y + b.h - 1e-4 && a.y + a.h > b.y + 1e-4;
const hitsOthers = (r, id) => visiblePanes().some((p) => p.id !== id && cfg.free[p.id] && overlap(r, cfg.free[p.id]));

// Find an empty spot on the wall for a screen that has none, without moving the others.
function placeNew(id) {
  for (const s of [0.3, 0.22, 0.16]) {
    for (let y = 0; y + s <= 1.0001; y += 0.02) {
      for (let x = 0; x + s <= 1.0001; x += 0.02) {
        if (!hitsOthers({ x, y, w: s, h: s }, id)) { cfg.free[id] = { x, y, w: s, h: s }; return true; }
      }
    }
  }
  return false;
}

// Screens that just turned on, came back from picture-in-picture or were added get a spot. Only if the wall is
// full does everything re-arrange.
function ensurePlaced() {
  // a screen coming back to a spot another screen has moved into since needs a new spot too
  const settled = [];
  for (const p of [...visiblePanes()].sort((a, b) => Number(b.locked) - Number(a.locked))) { // locked screens keep theirs
    const r = cfg.free[p.id];
    if (r && settled.some((o) => overlap(r, o))) delete cfg.free[p.id];
    else if (r) settled.push(r);
  }
  const missing = visiblePanes().filter((p) => !cfg.free[p.id]);
  if (!missing.length) return;
  if (missing.length === visiblePanes().length || !missing.every((p) => placeNew(p.id))) cfg.free = presetLayout(cfg.arrangeStyle);
  saveConfig();
}

// Glide screens to new spots. `replace` swaps in the whole arrangement (presets); otherwise only the named screens move.
//
// Live pages (video especially) can't repaint as fast as they're moved, so a moving page shows black where its
// picture hasn't caught up. So each screen that's about to move is photographed first, the shell glides the photo
// while the live page is hidden, and the live page reappears at its final spot. A screen whose photo doesn't come
// back quickly just glides live.
let tweenTimer = null;
let tweenToken = 0;
const gliding = new Set(); // screens currently shown as a still photo while they glide
let stillsShown = null; // resolves when the shell has painted the photos

function endGlide() {
  if (!gliding.size) return;
  gliding.clear();
  layoutPanes(); // live pages back at their final spots
  // give the video a moment to paint before the photos underneath go away
  setTimeout(() => { if (!gliding.size && shellReady && win && !win.isDestroyed()) win.webContents.send('stills', {}); }, 160);
}

function stopTween() {
  clearInterval(tweenTimer);
  tweenTimer = null;
  tweenToken++;
  endGlide();
}

async function captureStills(ids) {
  const shots = {};
  await Promise.all(ids.map(async (id) => {
    const e = views.get(id);
    if (!e || e.pip || e.fs) return;
    try {
      const img = await Promise.race([e.view.webContents.capturePage(), sleep(150).then(() => null)]);
      if (!img || img.isEmpty()) return;
      const small = img.getSize().width > 960 ? img.resize({ width: 960 }) : img;
      shots[id] = `data:image/jpeg;base64,${small.toJPEG(72).toString('base64')}`;
    } catch { /* this one glides live */ }
  }));
  return shots;
}

async function tweenTo(target, ms = 200, replace = false, done = null) {
  stopTween();
  const token = tweenToken;
  const from = JSON.parse(JSON.stringify(cfg.free));
  const moving = Object.keys(target).filter((id) => {
    const a = from[id];
    const b = target[id];
    return a && b && visiblePanes().some((p) => p.id === id) && (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) > 0.002);
  });
  if (PERF.glideStills && moving.length && visible && shellReady) {
    const shots = await captureStills(moving);
    if (token !== tweenToken) return; // a newer glide took over while we were photographing
    if (Object.keys(shots).length) {
      stillsShown = null;
      const shown = new Promise((resolve) => { stillsShown = resolve; setTimeout(resolve, 120); });
      win.webContents.send('stills', shots);
      await shown; // the shell has painted them (or we stop waiting)
      if (token !== tweenToken) return;
      for (const id of Object.keys(shots)) gliding.add(id);
    }
  }
  const base = replace ? {} : { ...cfg.free };
  const start = Date.now();
  const frame = () => {
    const t = Math.min(1, (Date.now() - start) / ms);
    const k = 1 - (1 - t) ** 3; // ease out
    const next = { ...base };
    for (const [id, b] of Object.entries(target)) {
      const a = from[id] || b;
      next[id] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
    }
    cfg.free = next;
    layoutPanes();
    if (t === 1) {
      clearInterval(tweenTimer);
      tweenTimer = null;
      endGlide();
      saveConfig();
      if (done) done();
    }
  };
  tweenTimer = setInterval(frame, PERF.frameMs);
  frame();
}

ipcMain.on('stills:shown', (e) => { if (fromShell(e) && stillsShown) { stillsShown(); stillsShown = null; } });

// Every turned-on screen's rectangle (header included), in pixels inside the window.
function computeLayout() {
  const { W, H, top } = wall();
  return visiblePanes().map((p) => {
    const f = cfg.free[p.id] || { x: 0, y: 0, w: 0.3, h: 0.3 };
    return { id: p.id, left: Math.round(f.x * W), top: top + Math.round(f.y * H), width: Math.round(f.w * W), height: Math.round(f.h * H) };
  });
}

// Make the biggest video (or, in the page around a player, the biggest embedded frame) cover the whole box and
// hide the rest of the site. Runs in every frame, so a player inside a cross-origin iframe works too.
// 'fit' shows the whole picture (black bars if the shapes differ); 'fill' fills the box edge to edge and crops.
// A transformed or clipped ancestor would trap the fixed-position player inside it, so those are flattened too.
const fitOn = (mode) => `(() => {
  const area = (el) => { const r = el.getBoundingClientRect(); return Math.max(0, r.width) * Math.max(0, r.height); };
  const biggest = (list, min) => list.filter((el) => area(el) > min).sort((a, b) => area(b) - area(a))[0];
  const target = biggest([...document.querySelectorAll('video')], 2500) || biggest([...document.querySelectorAll('iframe')], 10000);
  if (!target) return false;
  document.querySelectorAll('[data-sv-fit], [data-sv-fit-up]').forEach((el) => { el.removeAttribute('data-sv-fit'); el.removeAttribute('data-sv-fit-up'); });
  target.setAttribute('data-sv-fit', '1');
  for (let el = target.parentElement; el && el !== document.documentElement; el = el.parentElement) el.setAttribute('data-sv-fit-up', '1');
  let st = document.getElementById('__sv_fit_style');
  if (!st) { st = document.createElement('style'); st.id = '__sv_fit_style'; document.documentElement.appendChild(st); }
  st.textContent = 'html, body { overflow: hidden !important; background: #000 !important; }'
    + ' body * { visibility: hidden !important; }'
    + ' [data-sv-fit-up] { transform: none !important; filter: none !important; perspective: none !important; contain: none !important;'
    + ' clip-path: none !important; will-change: auto !important; }'
    + ' [data-sv-fit] { visibility: visible !important; position: fixed !important; inset: 0 !important; width: 100vw !important;'
    + ' height: 100vh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;'
    + ' border: 0 !important; transform: none !important; z-index: 2147483647 !important; object-fit: ${mode === 'fit' ? 'contain' : 'cover'} !important; object-position: ${mode === 'bottom' ? 'center bottom' : 'center center'} !important; background: #000 !important; }';
  return true;
})()`;
const FIT_OFF = `(() => {
  document.getElementById('__sv_fit_style')?.remove();
  document.querySelectorAll('[data-sv-fit], [data-sv-fit-up]').forEach((el) => { el.removeAttribute('data-sv-fit'); el.removeAttribute('data-sv-fit-up'); });
  return true;
})()`;

async function applyFit(entry) {
  const wc = entry.view.webContents;
  if (wc.isDestroyed()) return;
  const code = entry.fit === 'off' ? FIT_OFF : fitOn(entry.fit);
  for (const frame of wc.mainFrame.framesInSubtree) {
    try { await frame.executeJavaScript(code); } catch { /* frame went away */ }
  }
}

function setFit(id, mode) {
  const e = views.get(id);
  if (!e || !FIT_MODES.includes(mode) || e.fit === mode) return;
  e.fit = mode;
  clearInterval(e.fitTimer);
  // players often load late, so keep looking while it's on
  if (mode !== 'off') e.fitTimer = setInterval(() => applyFit(e), 2500);
  applyFit(e);
  sendState();
}

function layoutPanes() {
  if (!win || win.isDestroyed()) return;
  for (const [id, e] of views) {
    if (!e.pip && !visiblePanes().some((p) => p.id === id)) e.view.setVisible(false); // off, or in another window
  }
  for (const e of views.values()) if (e.pip) e.layoutPip();
  // room around the page for the shell's header and resize frame. With boxes off there's none, so the pages
  // touch and read as one picture.
  const header = cfg.boxes ? HEADER_H : 0;
  const frame = cfg.boxes ? FRAME_H : 0;
  const side = cfg.boxes ? FRAME_W : 0;
  for (const l of computeLayout()) {
    const e = views.get(l.id);
    if (!e) continue;
    if (gliding.has(l.id)) { e.view.setVisible(false); continue; } // its photo is gliding in the shell
    const off = e.blocked ? BLOCK_H : 0;
    e.view.setVisible(true);
    e.view.setBounds(e.fs
      ? { x: l.left, y: l.top, width: Math.max(0, l.width), height: Math.max(0, l.height - frame) } // the site's own fullscreen: fill this screen's box
      : {
        x: l.left + side,
        y: l.top + header + off,
        width: Math.max(0, l.width - 2 * side),
        height: Math.max(0, l.height - header - off - frame),
      });
  }
  sendState();
}

const isFavorite = (url) => Boolean(url) && cfg.favorites.some((f) => f.url === url);

// Favorite icons can be tens of KB each; while dragging, state goes to the shell 60 times a second, so they only
// travel when the list changes (the shell keeps the last list it got).
function favoritesIfChanged() {
  const key = cfg.favorites.map((f) => `${f.url}|${f.title}|${f.icon.length}`).join('\n');
  if (!PERF.favoritesEveryState && key === sentFavKey) return {};
  sentFavKey = key;
  return { favorites: cfg.favorites };
}

let sentFavKey = '';
function sendState() {
  pushPanel();
  for (const [id, e] of views) {
    const p = paneById(id);
    if (e.pip && p && !e.pip.isDestroyed()) {
      e.pip.webContents.send('pip-state', { url: p.url, title: e.title, muted: e.muted, audible: e.audible, fit: e.fit, headerH: e.fs ? 0 : HEADER_H });
    }
  }
  if (!shellReady || !win || win.isDestroyed()) return;
  const layout = new Map(computeLayout().map((l) => [l.id, l]));
  const shown = visiblePanes();
  if (!shown.some((p) => p.id === focusedId)) focusedId = shown.length ? shown[shown.length - 1].id : '';
  win.webContents.send('state', {
    headerH: HEADER_H,
    toolbarH: TOOLBAR_H,
    tabH: TAB_H,
    tickerH: TICKER_H,
    hiddenH: HIDDEN_H,
    blockH: BLOCK_H,
    frameH: FRAME_H,
    frameW: FRAME_W,
    minFreeW: MIN_FREE_W,
    minFreeH: MIN_FREE_H,
    topBar: cfg.topBar,
    activeWindow: cfg.active,
    displays: displayList(),
    paneCount: cfg.panes.length,
    minPanes: MIN_PANES,
    maxPanes: MAX_PANES,
    freeLocked: cfg.freeLocked,
    anyLocked: anyLocked(),
    arrangeStyle: cfg.arrangeStyle,
    coverTaskbar: cfg.coverTaskbar,
    dockOn: cfg.dockOn,
    onTop: cfg.onTop,
    glass: cfg.glass,
    boxes: cfg.boxes,
    ticker: cfg.ticker,
    ...favoritesIfChanged(),
    focusedId,
    swapTarget: freeDrag?.target || '',
    gliding: [...gliding],
    draggingId: freeDrag?.id || '',
    panes: cfg.panes.map((p, i) => {
      const e = views.get(p.id);
      const l = layout.get(p.id) || { left: 0, top: 0, width: 0, height: 0 };
      return {
        id: p.id,
        hidden: Boolean(p.hidden),
        pip: Boolean(e && e.pip),
        locked: Boolean(p.locked),
        label: `Screen ${i + 1}`,
        url: p.url,
        favorite: isFavorite(p.url),
        title: e ? e.title : '',
        muted: e ? e.muted : true,
        audible: e ? e.audible : false,
        blocked: e ? e.blocked : '',
        fit: e ? e.fit : 'off',
        canBack: e ? e.view.webContents.navigationHistory.canGoBack() : false,
        canForward: e ? e.view.webContents.navigationHistory.canGoForward() : false,
        left: l.left,
        top: l.top,
        width: l.width,
        height: l.height,
      };
    }),
  });
}

function loadPane(p) {
  const wc = views.get(p.id).view.webContents;
  if (p.url) wc.loadURL(p.url).catch(() => {});
  else wc.loadFile(path.join(__dirname, 'start.html')).catch(() => {});
}

function createPane(p) {
  const view = new WebContentsView({
    webPreferences: {
      // each screen keeps its own logins, unless they're shared
      partition: cfg.sharedLogins ? 'persist:sv-shared' : `persist:sv-${p.id}`,
      preload: path.join(__dirname, 'pane-preload.js'), // fills login forms from saved logins
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#000000');
  const wc = view.webContents;
  const entry = { view, muted: true, audible: false, title: '', favicon: '', blocked: '', fit: 'off', fs: false, fitTimer: null, pip: null, layoutPip: null };
  views.set(p.id, entry);

  wc.setUserAgent(CHROME_UA);
  // Pages get no permissions (camera, location, notifications...) except fullscreen, which only fills this screen's box.
  wc.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  // Websites can't reach apps running on this PC. Discord's invite page, for one, scans ws://127.0.0.1:6463-6472
  // for the Discord app, which then jumps in front of Side View. A page that is itself on localhost still can.
  const isLocal = (u) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(u).hostname); } catch { return false; } };
  wc.session.webRequest.onBeforeRequest({ urls: ['*://127.0.0.1/*', '*://localhost/*', '*://[::1]/*', 'ws://127.0.0.1/*', 'ws://localhost/*', 'wss://127.0.0.1/*', 'wss://localhost/*'] }, (details, cb) => {
    // opening a localhost address in the screen itself (typed, a favorite) is you, not a page reaching out
    if (details.resourceType === 'mainFrame') { cb({}); return; }
    const from = details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : details.referrer;
    cb({ cancel: !isLocal(from || '') });
  });
  wc.setAudioMuted(true);

  const applyZoom = () => wc.setZoomFactor(zoomFor(paneById(p.id), wc.getURL()));
  wc.on('dom-ready', applyZoom);
  wc.on('did-navigate', applyZoom);

  // Keep muted panes muted through every navigation.
  wc.on('did-start-navigation', () => { if (entry.muted) wc.setAudioMuted(true); });

  // Popups and new-tab links never open. The screen shows a red bar; the check loads the link here, the X drops it.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      entry.blocked = url;
      layoutPanes();
    }
    return { action: 'deny' };
  });
  wc.on('did-navigate', () => {
    if (entry.blocked) { entry.blocked = ''; layoutPanes(); }
  });

  const onNav = (_e, url) => {
    const pane = paneById(p.id);
    if (pane && /^https?:\/\//i.test(url) && pane.url !== url) {
      pane.url = url;
      saveConfig();
    }
    sendState();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('page-title-updated', (_e, title) => { entry.title = title; sendState(); });
  wc.on('page-favicon-updated', (_e, icons) => { entry.favicon = icons.find((u) => /^https?:/i.test(u)) || ''; });
  wc.on('media-started-playing', () => { entry.audible = true; sendState(); });
  wc.on('media-paused', () => { entry.audible = false; sendState(); });
  wc.on('focus', () => { if (focusedId !== p.id) { focusedId = p.id; sendState(); } });

  // A site's own fullscreen button. The app window can't go fullscreen (fullscreenable: false), so the page fills
  // just this screen's box.
  wc.on('enter-html-full-screen', () => {
    entry.fs = true;
    if (win.isFullScreen()) { win.setFullScreen(false); coverScreen(); }
    layoutPanes();
  });
  wc.on('leave-html-full-screen', () => { entry.fs = false; layoutPanes(); });
  wc.on('did-frame-finish-load', () => { if (entry.fit !== 'off') applyFit(entry); });
  // A site that fails to load (bad link, certificate error, offline) would leave the screen with nothing to draw,
  // which shows up as a stale gray box for a few seconds. Show a short explanation instead.
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !/^https?:/i.test(url)) return; // -3: replaced by another navigation
    wc.loadFile(path.join(__dirname, 'error.html'), { query: { url, why: desc.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase() } }).catch(() => {});
  });

  // Ctrl + scroll changes this screen's zoom and remembers it for the site.
  wc.on('zoom-changed', (_e, direction) => {
    if (!paneById(p.id)) return;
    rememberZoom(p.id, wc.getZoomFactor() + (direction === 'in' ? 0.05 : -0.05));
  });

  view.setVisible(false); // shown by layoutPanes once it has a place, so it never flashes at the wrong size
  win.contentView.addChildView(view);
  loadPane(p);
}

function destroyPane(id) {
  const e = views.get(id);
  if (!e) return;
  views.delete(id);
  clearInterval(e.fitTimer);
  if (e.pip && !e.pip.isDestroyed()) {
    try { e.pip.contentView.removeChildView(e.view); } catch { /* already gone */ }
    e.pip.destroy();
  }
  try {
    win.contentView.removeChildView(e.view);
    e.view.webContents.close();
  } catch { /* already gone */ }
}

function setMuted(id, muted) {
  const e = views.get(id);
  if (!e) return;
  if (!muted) {
    // One screen can make sound at a time.
    for (const [otherId, other] of views) {
      if (otherId !== id) { other.muted = true; other.view.webContents.setAudioMuted(true); }
    }
  }
  e.muted = muted;
  e.view.webContents.setAudioMuted(muted);
  sendState();
}

// ---------- picture-in-picture ----------

// Pop a screen out into its own small window that floats above everything (the wall included, because it's
// owned by the main window). Its page keeps playing; nothing reloads.
function popOut(id) {
  const e = views.get(id);
  if (!e || e.pip || !paneById(id) || visiblePanes().length <= 1) return; // keep at least one screen in place
  const wa = targetDisplay().workArea;
  const pip = new BrowserWindow({
    parent: win,
    width: PIP_W,
    height: PIP_H + HEADER_H,
    x: wa.x + wa.width - PIP_W - 24,
    y: wa.y + wa.height - PIP_H - HEADER_H - 24,
    minWidth: 200,
    minHeight: 112 + HEADER_H,
    show: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    title: 'Side View picture-in-picture',
    webPreferences: {
      preload: path.join(__dirname, 'pip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pip.setMenuBarVisibility(false);
  e.pip = pip;
  e.layoutPip = () => {
    if (pip.isDestroyed()) return;
    const [w, h] = pip.getContentSize();
    const top = e.fs ? 0 : HEADER_H; // the site's own fullscreen covers the bar too; Esc brings it back
    e.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
  };
  win.contentView.removeChildView(e.view);
  pip.contentView.addChildView(e.view);
  e.view.setVisible(true);
  pip.on('resize', e.layoutPip);
  pip.on('close', (ev) => {
    if (quitting) return;
    ev.preventDefault();
    dockBack(id);
  });
  pip.webContents.once('did-finish-load', () => { e.layoutPip(); sendState(); if (!TEST) pip.showInactive(); });
  pip.loadFile(path.join(__dirname, 'pip.html'));
  afterPipChanged();
}

// Put a popped-out screen back where it was on the wall.
function dockBack(id) {
  const e = views.get(id);
  if (!e || !e.pip) return;
  const pip = e.pip;
  e.pip = null;
  e.layoutPip = null;
  if (!pip.isDestroyed()) {
    try { pip.contentView.removeChildView(e.view); } catch { /* already gone */ }
    pip.destroy();
  }
  win.contentView.addChildView(e.view);
  afterPipChanged();
}

function afterPipChanged() {
  ensurePlaced();
  layoutPanes();
  refreshTray();
}

const pipFor = (e) => [...views.entries()].find(([, v]) => v.pip && !v.pip.isDestroyed() && v.pip.webContents === e.sender)?.[0];
const eachPip = (fn) => { for (const e of views.values()) if (e.pip && !e.pip.isDestroyed()) fn(e.pip); };

function muteAll() {
  for (const id of views.keys()) setMuted(id, true);
}

// ---------- adding, removing, switching ----------

function newPane() {
  let k = 1;
  while (idTaken(`p${k}`)) k += 1;
  return { id: `p${k}`, url: '', zoom: cfg.zoom, hidden: false, locked: false };
}

// The last screen is the main one, so new screens go in front of it (and removal takes the one before it).
const canRespread = () => !cfg.freeLocked && !anyLocked();

// Glide every screen to the current preset; screens that just appeared grow out of their final spot.
function respreadEvenly() {
  const before = { ...cfg.free };
  const next = presetLayout(cfg.arrangeStyle);
  for (const id of Object.keys(next)) if (!before[id]) before[id] = { ...next[id], w: 0.02, h: 0.02 };
  cfg.free = before;
  tweenTo(next, 260, true);
}

function setPaneCount(n) {
  n = clamp(n, MIN_PANES, MAX_PANES);
  if (n === cfg.panes.length) return;
  // re-spread evenly in the current preset with the new count (2 halves -> 3 thirds) instead of squeezing a new screen
  // in or leaving a gap. Locking (one screen or all) is how you keep a hand-made arrangement.
  const respread = canRespread();
  while (cfg.panes.length > n) {
    const at = cfg.panes.length >= 2 ? cfg.panes.length - 2 : cfg.panes.length - 1;
    const gone = cfg.panes.splice(at, 1)[0];
    destroyPane(gone.id);
    delete cfg.free[gone.id];
  }
  while (cfg.panes.length < n) {
    const p = newPane();
    cfg.panes.splice(Math.max(0, cfg.panes.length - 1), 0, p);
    createPane(p);
  }
  if (respread) {
    respreadEvenly();
  } else {
    ensurePlaced();
  }
  saveConfig();
  layoutPanes();
  refreshTray();
}

// Page zoom follows the website: zoom one Pluto screen and every Pluto screen (now and later) uses it.
const siteOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : '';
  } catch { return ''; }
};
function zoomFor(pane, url) {
  const site = siteOf(url);
  return (site && cfg.siteZoom[site]) || (pane && pane.zoom) || cfg.zoom;
}
function rememberZoom(id, z) {
  const pane = paneById(id);
  const e = views.get(id);
  if (!pane || !e || !Number.isFinite(z)) return;
  z = Math.round(clamp(z, ZOOM_MIN, ZOOM_MAX) * 100) / 100;
  pane.zoom = z;
  const site = siteOf(e.view.webContents.getURL());
  if (site) {
    delete cfg.siteZoom[site]; // re-add so the newest sites are kept when trimming to 200
    cfg.siteZoom[site] = z;
    const keys = Object.keys(cfg.siteZoom);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete cfg.siteZoom[k];
  }
  for (const [otherId, v] of views) {
    const wc = v.view.webContents;
    if (otherId === id || (site && siteOf(wc.getURL()) === site)) wc.setZoomFactor(z);
  }
  saveConfig();
  pushPanel();
}

function setAllZoom(z) {
  cfg.zoom = z;
  cfg.siteZoom = {}; // "all screens" starts over: no site keeps its own zoom
  for (const p of cfg.panes) {
    p.zoom = z;
    views.get(p.id)?.view.webContents.setZoomFactor(z);
  }
  saveConfig();
  refreshTray();
}

function setWindow(k) {
  if (!Number.isFinite(Number(k))) return;
  k = clamp(Math.round(Number(k)), 0, WINDOW_COUNT - 1);
  if (!win || k === cfg.active) return;
  stopTween();
  for (const p of cfg.panes) dockBack(p.id); // popped-out screens belong to the window we're leaving
  stashWindow();
  // silence the window we're leaving; its pages keep loaded so coming back is instant
  for (const p of cfg.panes) setMuted(p.id, true);
  const next = cfg.windows[k];
  cfg.active = k;
  cfg.panes = next.panes;
  cfg.freeBy = next.freeBy || {};
  const mine = cfg.freeBy[String(cfg.displayId)];
  cfg.free = mine && Object.keys(mine).length ? mine : next.free;
  cfg.freeLocked = next.freeLocked;
  for (const p of cfg.panes) if (!views.has(p.id)) createPane(p); // pages load the first time you open a window
  ensurePlaced();
  saveConfig();
  layoutPanes();
  refreshTray();
}

function setPaneHidden(id, hidden) {
  const p = paneById(id);
  if (!p || p.hidden === hidden) return;
  if (hidden) dockBack(id);
  if (hidden && visiblePanes().length <= 1) return; // keep at least one screen on
  p.hidden = hidden;
  if (hidden) setMuted(id, true);
  if (canRespread()) respreadEvenly(); // the others share the space evenly again
  else if (!hidden) ensurePlaced();
  saveConfig();
  layoutPanes();
  refreshTray();
}

// ---------- settings bar toggles ----------

function setFlag(key, on) {
  cfg[key] = on;
  saveConfig();
  if (key === 'coverTaskbar') { coverScreen(); win.focus(); } // Windows drops the taskbar behind a window covering the monitor
  if (key === 'onTop') { win.setAlwaysOnTop(on); coverScreen(); }
  if (key === 'dockOn') coverScreen();
  if (key === 'ticker') fetchScores();
  layoutPanes();
  refreshTray();
}
const FLAGS = ['coverTaskbar', 'onTop', 'topBar', 'glass', 'boxes', 'ticker', 'freeLocked', 'dockOn'];

function setDock(edge, size) {
  if (DOCK_EDGES.includes(edge)) cfg.dockEdge = edge;
  if (Number.isFinite(Number(size))) cfg.dockSize = clamp(Number(size), DOCK_MIN, DOCK_MAX);
  saveConfig();
  if (cfg.dockOn) { releaseBand(); coverScreen(); } // re-register (queued in order): Windows keeps a reservation on the edge it started on
  refreshTray();
  sendState();
}

function setPaneLocked(id, locked) {
  const p = paneById(id);
  if (!p) return;
  p.locked = locked;
  saveConfig();
  sendState();
}

// ---------- favorites ----------

// A site's icon, fetched once and kept as a small data: URL so the settings bar can show it without loading anything.
async function fetchIcon(pageUrl, iconUrl) {
  const tries = [iconUrl, (() => { try { return `${new URL(pageUrl).origin}/favicon.ico`; } catch { return ''; } })()].filter(Boolean);
  for (const u of tries) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': CHROME_UA } });
      clearTimeout(timer);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length && buf.length < 150000) return `data:${type};base64,${buf.toString('base64')}`;
    } catch { /* try the next one */ }
  }
  return '';
}

function toggleFavorite(id) {
  const p = paneById(id);
  const e = views.get(id);
  if (!p || !p.url) return;
  const at = cfg.favorites.findIndex((f) => f.url === p.url);
  if (at >= 0) {
    cfg.favorites.splice(at, 1);
  } else {
    if (cfg.favorites.length >= MAX_FAVORITES) cfg.favorites.shift();
    const fav = { url: p.url, title: cleanTitle((e && e.title) || '', p.url), icon: '' };
    cfg.favorites.push(fav);
    fetchIcon(p.url, e && e.favicon).then((icon) => {
      if (!icon) return;
      fav.icon = icon;
      saveConfig();
      sendState();
    });
  }
  saveConfig();
  sendState();
}

function openFavorite(k, id = focusedId) {
  const fav = cfg.favorites[k];
  const pane = paneById(id) || visiblePanes()[visiblePanes().length - 1];
  if (!fav || !pane) return;
  pane.url = fav.url;
  saveConfig();
  loadPane(pane);
  sendState();
}

function favoriteMenu(k) {
  const fav = cfg.favorites[k];
  if (!fav) return;
  const move = (d) => {
    const j = k + d;
    if (j < 0 || j >= cfg.favorites.length) return;
    [cfg.favorites[k], cfg.favorites[j]] = [cfg.favorites[j], cfg.favorites[k]];
    saveConfig();
    sendState();
  };
  Menu.buildFromTemplate([
    { label: fav.title || hostOf(fav.url), enabled: false },
    ...visiblePanes().map((p) => ({ label: `Open in Screen ${cfg.panes.indexOf(p) + 1}`, click: () => openFavorite(k, p.id) })),
    { type: 'separator' },
    { label: 'Move left', enabled: k > 0, click: () => move(-1) },
    { label: 'Move right', enabled: k < cfg.favorites.length - 1, click: () => move(1) },
    { label: 'Remove from favorites', click: () => { cfg.favorites.splice(k, 1); saveConfig(); sendState(); } },
  ]).popup({ window: win });
}

// ---------- score ticker ----------

let scores = [];
let scoreTimer = null;

function describe(ev) {
  const comp = ev.competitions && ev.competitions[0];
  if (!comp) return null;
  const home = comp.competitors.find((c) => c.homeAway === 'home');
  const away = comp.competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  const state = ev.status.type.state; // pre | in | post
  const name = (c) => c.team.abbreviation || c.team.shortDisplayName;
  const text = state === 'pre'
    ? `${name(away)} @ ${name(home)}`
    : `${name(away)} ${away.score} - ${home.score} ${name(home)}`;
  // the clock while it's on ("Q3 4:12", "Halftime"), the tip-off time before, "Final" after
  let status = ev.status.type.shortDetail || '';
  if (state === 'pre') {
    const start = new Date(ev.date);
    if (!Number.isNaN(start.getTime())) status = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return { text, status, live: state === 'in' };
}

async function fetchScores() {
  clearTimeout(scoreTimer);
  if (cfg.ticker) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${cfg.league}/scoreboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      scores = (json.events || []).map(describe).filter(Boolean);
    } catch (err) {
      console.warn('[side-view] score fetch failed:', err.message);
    }
  }
  sendTicker();
  // poll faster while a game is on
  scoreTimer = setTimeout(fetchScores, scores.some((g) => g.live) ? 15000 : 120000);
}

function sendTicker() {
  if (shellReady && win && !win.isDestroyed()) win.webContents.send('ticker', scores);
}

function setLeague(id) {
  cfg.league = id;
  scores = [];
  saveConfig();
  fetchScores();
  refreshTray();
}

// ---------- IPC (from the settings bar and the screens' bars) ----------

ipcMain.on('shell:ready', (e) => {
  if (!fromShell(e)) return;
  shellReady = true;
  sentFavKey = ''; // a fresh shell has no favorites yet
  layoutPanes();
  sendTicker();
});

ipcMain.on('flag:set', (e, key, on) => {
  if (fromShell(e) && FLAGS.includes(key)) setFlag(key, Boolean(on));
});

ipcMain.on('wall:drag', (e, on) => {
  if (fromShell(e)) setWallDrag(Boolean(on));
});

ipcMain.on('wall:hide', (e) => {
  if (fromShell(e)) hideWall();
});

ipcMain.on('monitor:menu', (e) => {
  if (fromShell(e)) Menu.buildFromTemplate(monitorMenu()).popup({ window: win });
});

ipcMain.on('panes:count', (e, n) => {
  if (fromShell(e) && Number.isFinite(n)) setPaneCount(Math.round(n));
});

ipcMain.on('window:set', (e, k) => {
  if (fromShell(e)) setWindow(Number(k));
});

ipcMain.on('mute:all', (e) => {
  if (fromShell(e)) muteAll();
});

ipcMain.on('fav:toggle', (e, id) => {
  if (fromShell(e)) toggleFavorite(id);
});

ipcMain.on('fav:open', (e, k) => {
  if (fromShell(e)) openFavorite(Number(k));
});

ipcMain.on('fav:menu', (e, k) => {
  if (fromShell(e)) favoriteMenu(Number(k));
});

ipcMain.on('pane:focus', (e, id) => {
  if (fromShell(e) && paneById(id) && focusedId !== id) { focusedId = id; sendState(); }
});

ipcMain.on('pane:fit', (e, id, mode) => {
  if (fromShell(e)) setFit(id, String(mode));
});

ipcMain.on('pane:lock', (e, id, locked) => {
  if (fromShell(e)) setPaneLocked(id, Boolean(locked));
});

ipcMain.on('pane:pip', (e, id) => {
  if (fromShell(e)) popOut(id);
});

ipcMain.on('pane:pip-back', (e, id) => {
  if (fromShell(e)) dockBack(id);
});

ipcMain.on('pane:hide', (e, id, hidden) => {
  if (fromShell(e)) setPaneHidden(id, Boolean(hidden));
});

// from a picture-in-picture window's bar; it only ever acts on its own screen
ipcMain.on('pip:mute', (e, muted) => { const id = pipFor(e); if (id) setMuted(id, Boolean(muted)); });
ipcMain.on('pip:fit', (e, mode) => { const id = pipFor(e); if (id) setFit(id, String(mode)); });
ipcMain.on('pip:back', (e) => { const id = pipFor(e); if (id) dockBack(id); });
ipcMain.on('pip:ready', (e) => { if (pipFor(e)) sendState(); });
// Dragging the bar moves the window. CSS drag regions stop working once a page view sits in the window, so main
// follows the pointer itself until the bar says the button is up.
let pipDrag = null;
ipcMain.on('pip:drag', (e, on) => {
  const id = pipFor(e);
  clearInterval(pipDrag?.timer);
  pipDrag = null;
  if (!id || !on) return;
  const pip = views.get(id).pip;
  const start = screen.getCursorScreenPoint();
  const [x0, y0] = pip.getPosition();
  pipDrag = {
    timer: setInterval(() => {
      if (pip.isDestroyed()) { clearInterval(pipDrag?.timer); pipDrag = null; return; }
      const p = screen.getCursorScreenPoint();
      pip.setPosition(x0 + p.x - start.x, y0 + p.y - start.y);
    }, PERF.frameMs),
  };
});

// A preset was picked. Locked screens must stay put, so presets wait until every screen is unlocked.
ipcMain.on('free:arrange', (e, style) => {
  if (!fromShell(e) || cfg.freeLocked || anyLocked()) return;
  if (ARRANGE_STYLES.includes(style)) cfg.arrangeStyle = style;
  tweenTo(presetLayout(cfg.arrangeStyle), 260, true);
});

// Moving or resizing a screen. Once a drag starts, main follows the pointer itself (the shell stops getting pointer
// events as soon as the pointer is over a page) and asks Windows when the button comes up. While held, the page
// follows the pointer directly and rises above the others; on release it snaps into place:
//   let go with the pointer over another screen -> the two swap places
//   moved onto empty space that overlaps a screen -> it glides back where it started
//   resized -> it never grows into a neighbour
let freeDrag = null;

function applyLive(id, r, pointer) {
  const { W, H, top } = wall();
  const width = clamp(r.width, MIN_FREE_W, W);
  const height = clamp(r.height, MIN_FREE_H, H);
  let next = { x: clamp(r.left, 0, W - width) / W, y: clamp(r.top - top, 0, H - height) / H, w: width / W, h: height / H };
  if (freeDrag.kind === 'resize') {
    const cur = cfg.free[id];
    if (hitsOthers(next, id)) {
      const tries = [{ ...next, x: cur.x, w: cur.w }, { ...next, y: cur.y, h: cur.h }];
      next = tries.find((t) => !hitsOthers(t, id)) || cur;
    }
  } else {
    // the screen under the pointer (window pixels -> wall fractions)
    const cx = pointer.x / W;
    const cy = (pointer.y - top) / H;
    const under = visiblePanes().find((p) => {
      const o = cfg.free[p.id];
      return p.id !== id && !p.locked && o && cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h;
    });
    freeDrag.target = under ? under.id : '';
  }
  cfg.free[id] = next;
  layoutPanes();
}

function startFreeDrag(id, kind, edges) {
  if (freeDrag || cfg.freeLocked || !paneById(id) || paneById(id).locked) return;
  const r0 = computeLayout().find((l) => l.id === id);
  if (!r0 || !cfg.free[id]) return;
  stopTween();
  const c0 = screen.getCursorScreenPoint();
  freeDrag = { id, kind: kind === 'resize' ? 'resize' : 'move', start: { ...cfg.free[id] }, target: '' };
  const v = views.get(id);
  if (v && !v.pip) win.contentView.addChildView(v.view); // re-adding puts it on top
  const e = String(edges || '');
  freeDrag.timer = setInterval(() => {
    if (appbar.mouseDown() === false) { endFreeDrag(id); return; }
    const c = screen.getCursorScreenPoint();
    const dx = c.x - c0.x;
    const dy = c.y - c0.y;
    const r = { ...r0 };
    if (freeDrag.kind === 'move') {
      r.left += dx;
      r.top += dy;
    } else {
      if (e.includes('s')) r.height = Math.max(MIN_FREE_H, r0.height + dy);
      if (e.includes('e')) r.width = Math.max(MIN_FREE_W, r0.width + dx);
      if (e.includes('w')) {
        // the right side stays put while the left edge follows the pointer
        r.width = Math.max(MIN_FREE_W, r0.width - dx);
        r.left = r0.left + r0.width - r.width;
      }
    }
    const cb = win.getContentBounds();
    applyLive(id, r, { x: c.x - cb.x, y: c.y - cb.y });
  }, PERF.frameMs);
}

function endFreeDrag(id) {
  if (!freeDrag || freeDrag.id !== id) return;
  const d = freeDrag;
  clearInterval(d.timer);
  freeDrag = null;
  const { W, H } = wall();
  const cur = cfg.free[id];
  const sx = (f) => Math.round((f * W) / SNAP) * SNAP / W;
  const sy = (f) => Math.round((f * H) / SNAP) * SNAP / H;
  const snapped = { w: Math.min(1, sx(cur.w)), h: Math.min(1, sy(cur.h)) };
  snapped.x = clamp(sx(cur.x), 0, 1 - snapped.w);
  snapped.y = clamp(sy(cur.y), 0, 1 - snapped.h);
  const target = {};
  if (d.kind === 'move' && d.target && cfg.free[d.target]) {
    target[id] = { ...cfg.free[d.target] };
    target[d.target] = d.start;
  } else if (!hitsOthers(snapped, id)) {
    target[id] = snapped;
  } else {
    target[id] = d.kind === 'move' ? d.start : cur;
  }
  tweenTo(target, 180);
}

ipcMain.on('free:start', (e, id, kind, edges) => {
  if (fromShell(e)) startFreeDrag(id, kind, edges);
});

// the shell saw the button come up (also the way out where Windows can't be asked)
ipcMain.on('free:drop', (e, id) => {
  if (fromShell(e)) endFreeDrag(id);
});

ipcMain.on('pane:navigate', (e, id, input) => {
  if (!fromShell(e)) return;
  const pane = paneById(id);
  if (!pane) return;
  pane.url = normalizeInput(input);
  saveConfig();
  loadPane(pane);
  sendState();
});

ipcMain.on('pane:back', (e, id) => {
  if (fromShell(e)) views.get(id)?.view.webContents.navigationHistory.goBack();
});

ipcMain.on('pane:forward', (e, id) => {
  if (fromShell(e)) views.get(id)?.view.webContents.navigationHistory.goForward();
});

ipcMain.on('pane:allow', (e, id) => {
  if (!fromShell(e)) return;
  const entry = views.get(id);
  if (!entry || !entry.blocked) return;
  const url = entry.blocked;
  entry.blocked = '';
  layoutPanes();
  entry.view.webContents.loadURL(url).catch(() => {});
});

ipcMain.on('pane:dismiss', (e, id) => {
  const entry = fromShell(e) && views.get(id);
  if (!entry) return;
  entry.blocked = '';
  layoutPanes();
});

ipcMain.on('pane:reload', (e, id) => {
  if (!fromShell(e)) return;
  const entry = views.get(id);
  const pane = paneById(id);
  if (!entry || !pane?.url) return;
  // on the "couldn't load" page, try the site itself again
  if (entry.view.webContents.getURL().startsWith('file:')) loadPane(pane);
  else entry.view.webContents.reload();
});

ipcMain.on('pane:mute', (e, id, muted) => {
  if (fromShell(e)) setMuted(id, Boolean(muted));
});

ipcMain.on('app:quit', (e) => {
  if (fromShell(e)) app.quit();
});

// ---------- settings & saved logins ----------

// ---------- control panel ----------
// The Settings window is the control panel: every setting, every screen and every monitor on one page, kept live.

// Everything except the saved logins (those can be long, so they only travel when the logins section asks).
function panelState() {
  const shown = visiblePanes();
  return {
    visible,
    displays: displayList(),
    activeWindow: cfg.active,
    windowCount: WINDOW_COUNT,
    arrangeStyle: cfg.arrangeStyle,
    styles: ARRANGE_STYLES,
    paneCount: cfg.panes.length,
    minPanes: MIN_PANES,
    maxPanes: MAX_PANES,
    flags: Object.fromEntries(FLAGS.map((k) => [k, Boolean(cfg[k])])),
    dockEdge: cfg.dockEdge,
    dockSize: cfg.dockSize,
    dockEdges: DOCK_EDGES,
    anyLocked: anyLocked(),
    focusedId,
    zoom: cfg.zoom,
    zoomPresets: ZOOM_PRESETS,
    zoomMin: ZOOM_MIN,
    zoomMax: ZOOM_MAX,
    league: cfg.league,
    leagues: LEAGUES,
    siteZoomCount: Object.keys(cfg.siteZoom).length,
    resources: resourceStats(),
    startup: app.getLoginItemSettings().openAtLogin,
    sharedLogins: cfg.sharedLogins,
    vaultAvailable: vault.available(),
    loginCount: vault.available() ? vault.summary().length : 0,
    favorites: cfg.favorites,
    discordInvite: cfg.discordInvite,
    panes: cfg.panes.map((p, i) => {
      const e = views.get(p.id);
      return {
        id: p.id,
        n: i + 1,
        main: i === cfg.panes.length - 1,
        url: p.url,
        title: e ? e.title : '',
        hidden: Boolean(p.hidden),
        pip: Boolean(e && e.pip),
        locked: Boolean(p.locked),
        muted: e ? e.muted : true,
        audible: e ? e.audible : false,
        fit: e ? e.fit : 'off',
        zoom: e ? Math.round(e.view.webContents.getZoomFactor() * 100) / 100 : p.zoom, // what the page really uses (its site's zoom)
        inPlace: shown.includes(p),
        memoryMB: resourceStats().perScreen[p.id] || 0,
      };
    }),
  };
}

function settingsState() {
  return {
    ...panelState(),
    logins: vault.available() ? vault.summary() : [],
  };
}

// What Side View costs right now: total memory, CPU and processes, and each screen's share. A screen counts every
// process its page uses (its own plus the ones its ad, player and other frames run in). Measured at most every 2 s.
let resourceCache = { at: 0, data: { totalMB: 0, cpuPct: 0, processes: 0, perScreen: {} } };
function resourceStats() {
  if (Date.now() - resourceCache.at < 2000) return resourceCache.data;
  const metrics = app.getAppMetrics();
  const mb = (m) => (m ? m.memory.workingSetSize / 1024 : 0);
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const perScreen = {};
  for (const [id, e] of views) {
    const wc = e.view.webContents;
    if (wc.isDestroyed()) continue;
    const pids = new Set([wc.getOSProcessId()]);
    try { for (const f of wc.mainFrame.framesInSubtree) pids.add(f.osProcessId); } catch { /* page is between loads */ }
    perScreen[id] = Math.round([...pids].reduce((a, pid) => a + mb(byPid.get(pid)), 0));
  }
  resourceCache = {
    at: Date.now(),
    data: {
      totalMB: Math.round(metrics.reduce((a, m) => a + mb(m), 0)),
      cpuPct: Math.round((metrics.reduce((a, m) => a + (m.cpu.percentCPUUsage || 0), 0) / os.cpus().length) * 10) / 10,
      processes: metrics.length,
      perScreen,
    },
  };
  return resourceCache.data;
}

// Many changes in a row (a drag, a page loading) become one update every 100 ms at most.
let panelTimer = null;
function pushPanel() {
  if (!settingsWin || settingsWin.isDestroyed() || panelTimer) return;
  if (!PERF.panelThrottleMs) { settingsWin.webContents.send('panel-state', panelState()); return; }
  panelTimer = setTimeout(() => {
    panelTimer = null;
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('panel-state', panelState());
  }, PERF.panelThrottleMs);
}

function setPaneZoom(id, z) {
  if (paneById(id)) rememberZoom(id, z);
}

function addFavorite(raw) {
  const url = normalizeInput(raw);
  if (!/^https?:\/\//i.test(url) || isFavorite(url)) return;
  if (cfg.favorites.length >= MAX_FAVORITES) cfg.favorites.shift();
  const fav = { url, title: hostOf(url), icon: '' };
  cfg.favorites.push(fav);
  fetchIcon(url, '').then((icon) => { if (icon) { fav.icon = icon; saveConfig(); sendState(); } });
  saveConfig();
  sendState();
}

function moveFavorite(k, d) {
  const j = k + d;
  if (!cfg.favorites[k] || j < 0 || j >= cfg.favorites.length) return;
  [cfg.favorites[k], cfg.favorites[j]] = [cfg.favorites[j], cfg.favorites[k]];
  saveConfig();
  sendState();
}

// What the panel may do. Every argument is checked here; the page only names an action.
const isPane = (id) => typeof id === 'string' && Boolean(paneById(id));
const PANEL_ACTIONS = {
  show: () => showWall(),
  hide: () => hideWall(),
  quit: () => app.quit(),
  display: (id) => { if (screen.getAllDisplays().some((d) => d.id === Number(id))) setDisplay(Number(id)); },
  flag: (key, on) => { if (FLAGS.includes(key)) setFlag(key, Boolean(on)); },
  window: (k) => setWindow(Number(k)),
  arrange: (style) => {
    if (cfg.freeLocked || anyLocked() || !ARRANGE_STYLES.includes(style)) return;
    cfg.arrangeStyle = style;
    tweenTo(presetLayout(style), 260, true);
  },
  count: (n) => { if (Number.isFinite(Number(n))) setPaneCount(Math.round(Number(n))); },
  muteAll: () => muteAll(),
  navigate: (id, input) => {
    if (!isPane(id)) return;
    const pane = paneById(id);
    pane.url = normalizeInput(input);
    saveConfig();
    loadPane(pane);
    sendState();
  },
  reload: (id) => {
    const entry = views.get(id);
    const pane = paneById(id);
    if (!entry || !pane?.url) return;
    if (entry.view.webContents.getURL().startsWith('file:')) loadPane(pane);
    else entry.view.webContents.reload();
  },
  hidden: (id, on) => { if (isPane(id)) setPaneHidden(id, Boolean(on)); },
  mute: (id, on) => { if (isPane(id)) setMuted(id, Boolean(on)); },
  fit: (id, mode) => { if (isPane(id)) setFit(id, String(mode)); },
  lock: (id, on) => { if (isPane(id)) setPaneLocked(id, Boolean(on)); },
  pip: (id, on) => { if (isPane(id)) { if (on) popOut(id); else dockBack(id); } },
  paneZoom: (id, z) => { if (isPane(id)) setPaneZoom(id, Number(z)); },
  focus: (id) => { if (isPane(id)) { focusedId = id; sendState(); } },
  favOpen: (k, id) => { if (cfg.favorites[Number(k)]) openFavorite(Number(k), isPane(id) ? id : focusedId); },
  favMove: (k, d) => moveFavorite(Number(k), Math.sign(Number(d))),
  favRemove: (k) => { if (cfg.favorites[Number(k)]) { cfg.favorites.splice(Number(k), 1); saveConfig(); sendState(); } },
  favAdd: (url) => addFavorite(String(url || '')),
  league: (id) => { if (LEAGUES.some(([, l]) => l === id)) setLeague(id); },
  dock: (edge, size) => setDock(edge, size),
  setInvite: (url) => {
    const v = String(url || '').trim().replace(/^(discord\.gg|discord\.com\/invite)\//i, 'https://$1/');
    if (v && !DISCORD_INVITE.test(v)) return;
    cfg.discordInvite = v;
    saveConfig();
  },
  openDiscord: () => { if (DISCORD_INVITE.test(cfg.discordInvite)) shell.openExternal(cfg.discordInvite); },
};

// ---------- layout codes ----------
// A layout code carries only where the screens sit (positions and sizes), never what's on them, so sharing one
// in #setups never passes a stream link around. "SV1-" + base64url of {v:1, s:[[x,y,w,h] in thousandths, ...]}.

function layoutCode() {
  const k = (f) => Math.round(f * 1000);
  const s = visiblePanes().filter((p) => cfg.free[p.id]).map((p) => {
    const f = cfg.free[p.id];
    return [k(f.x), k(f.y), k(f.w), k(f.h)];
  });
  return `SV1-${Buffer.from(JSON.stringify({ v: 1, s })).toString('base64url')}`;
}

function applyLayoutCode(raw) {
  const m = /^SV1-([A-Za-z0-9_-]{4,2000})$/.exec(String(raw || '').trim());
  if (!m) return { ok: false, message: 'That isn\'t a Side View layout code. They start with SV1-.' };
  let data;
  try { data = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { data = null; }
  const valid = data && data.v === 1 && Array.isArray(data.s) && data.s.length >= 1 && data.s.length <= MAX_PANES
    && data.s.every((r) => Array.isArray(r) && r.length === 4 && r.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000) && r[2] >= 50 && r[3] >= 50);
  if (!valid) return { ok: false, message: 'That layout code is damaged. Copy it again.' };
  if (cfg.freeLocked || anyLocked()) return { ok: false, message: 'Unlock every screen first, then paste the layout.' };
  const list = visiblePanes();
  const target = {};
  data.s.slice(0, list.length).forEach((r, i) => {
    const [x, y, w, h] = r.map((n) => n / 1000);
    target[list[i].id] = { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
  });
  // screens beyond the code's count keep their spot unless the new layout covers it (ensurePlaced moves those)
  tweenTo(target, 260, false, () => { ensurePlaced(); layoutPanes(); });
  const n = data.s.length;
  const note = n > list.length ? ` This layout is for ${n} screens and you have ${list.length} on; add screens to use the rest.`
    : n < list.length ? ` It has ${n} screens; ${list.length - n === 1 ? 'your other screen kept its spot or moved to a free one' : `your other ${list.length - n} kept their spots or moved to free ones`}.` : '';
  return { ok: true, message: `Layout applied.${note}` };
}

// Panel requests that answer back.
ipcMain.handle('panel:ask', (e, action, arg) => {
  if (!fromSettings(e)) return null;
  if (action === 'shareLayout') {
    const code = layoutCode();
    clipboard.writeText(code);
    return { code };
  }
  if (action === 'importLayout') return applyLayoutCode(arg);
  return null;
});

ipcMain.on('panel:do', (e, action, ...args) => {
  if (!fromSettings(e) || !Object.prototype.hasOwnProperty.call(PANEL_ACTIONS, action)) return;
  PANEL_ACTIONS[action](...args);
  pushPanel();
});

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  const wa = targetDisplay().workArea;
  const width = Math.min(1180, wa.width - 40);
  const height = Math.min(820, wa.height - 40);
  settingsWin = new BrowserWindow({
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    minWidth: 720,
    minHeight: 480,
    title: 'Side View Control Panel',
    show: !TEST,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    alwaysOnTop: true, // the wall stays on top, so settings must be too or it opens behind it
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  // memory and CPU keep changing even when nothing else does
  const resourceTimer = setInterval(pushPanel, 2000);
  settingsWin.on('closed', () => { clearInterval(resourceTimer); settingsWin = null; });
}

const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;

// Switching between shared and per-screen logins means new sessions, so every screen is rebuilt and reloads.
function setSharedLogins(on) {
  if (cfg.sharedLogins === on) return;
  cfg.sharedLogins = on;
  saveConfig();
  for (const id of [...views.keys()]) destroyPane(id);
  for (const p of cfg.panes) createPane(p); // screens in the other windows are rebuilt when you open them
  layoutPanes();
}

ipcMain.handle('settings:get', (e) => (fromSettings(e) ? settingsState() : null));

ipcMain.handle('settings:set', (e, key, value) => {
  if (!fromSettings(e)) return null;
  if (key === 'startup') app.setLoginItemSettings({ openAtLogin: Boolean(value) });
  else if (key === 'zoom' && ZOOM_PRESETS.includes(value)) setAllZoom(value);
  else if (key === 'sharedLogins') setSharedLogins(Boolean(value));
  refreshTray();
  return settingsState();
});

ipcMain.handle('vault:import', async (e) => {
  if (!fromSettings(e) || !vault.available()) return null;
  const pick = await dialog.showOpenDialog(settingsWin, {
    title: 'Pick the password file Chrome saved',
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'Chrome passwords (CSV)', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return null;
  try {
    const res = vault.importCsv(pick.filePaths[0]);
    lastExport = pick.filePaths[0];
    return { ...res, state: settingsState() };
  } catch (err) {
    return { error: `Couldn't import that file: ${err.message}`, state: settingsState() };
  }
});

// Only ever the file that was just imported, never a path the page names.
ipcMain.handle('vault:trash-export', async (e) => {
  if (!fromSettings(e) || !lastExport) return false;
  try {
    await shell.trashItem(lastExport);
    lastExport = '';
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('vault:remove', (e, id) => {
  if (!fromSettings(e)) return null;
  vault.remove(String(id));
  return settingsState();
});

ipcMain.handle('vault:clear', (e) => {
  if (!fromSettings(e)) return null;
  vault.clear();
  return settingsState();
});

// Open Chrome on its password page, where the export button is.
ipcMain.handle('vault:open-chrome', (e) => {
  if (!fromSettings(e)) return false;
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const exe = roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((f) => fs.existsSync(f));
  if (!exe) return false;
  spawn(exe, ['chrome://password-manager/settings'], { detached: true, stdio: 'ignore' }).unref();
  return true;
});

// A screen's page asks which saved logins fit it. The address comes from the page's real frame, not from the page,
// and only the top-level page of a screen is answered.
const paneEntryFor = (e) => [...views.values()].find((v) => v.view.webContents === e.sender);
const askingFrameUrl = (e) => (paneEntryFor(e) && e.senderFrame && e.senderFrame === e.sender.mainFrame ? e.senderFrame.url : '');

ipcMain.handle('vault:lookup', (e) => {
  const url = askingFrameUrl(e);
  if (!url || !vault.available()) return { logins: [] };
  return {
    logins: vault.forUrl(url).map((l, i) => ({ i, username: l.username })),
    zoom: e.sender.getZoomFactor(),
  };
});

ipcMain.handle('vault:password', (e, i) => {
  const url = askingFrameUrl(e);
  if (!url || !vault.available()) return '';
  return vault.forUrl(url)[Number(i)]?.password || '';
});

ipcMain.on('settings:open', (e) => {
  if (fromShell(e)) openSettings();
});

// ---------- window ----------

function createWindow() {
  const wa = targetDisplay().workArea;
  win = new BrowserWindow({
    ...wa, // start where it will end up, so it doesn't jump on launch
    show: false,
    frame: false,
    resizable: true, // must be true or the window can't be resized in code
    thickFrame: false, // no invisible resize border
    movable: false, // moved by the settings bar and the monitor picker only
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: cfg.onTop,
    backgroundColor: '#0b0e13',
    title: 'Side View',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.on('resize', () => layoutPanes());
  if (IS_WIN) {
    win.hookWindowMessage(appbar.CALLBACK_MESSAGE, (wParam, lParam) => {
      const code = wParam.readUInt32LE(0);
      if (code === 1 && docked()) scheduleCover(); // ABN_POSCHANGED: the taskbar or another docked app moved
      if (code === 2) win.setAlwaysOnTop(cfg.onTop && !lParam.some((b) => b !== 0)); // ABN_FULLSCREENAPP: step aside for full-screen apps
    });
  }
  win.on('will-move', (e) => e.preventDefault()); // programmatic moves don't fire this, only user drags
  // Something (a window manager, Win+D) minimized it: put it back over its monitor.
  win.on('minimize', () => { win.restore(); coverScreen(); });
  win.loadFile(path.join(__dirname, 'shell.html'));

  // Alt+F4 or a system close hides the wall instead of quitting; use the tray or the X to quit.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    hideWall();
  });

  for (const p of cfg.panes) createPane(p);
  ensurePlaced();
}

// ---------- tray ----------

function refreshTray() {
  pushPanel();
  if (!tray) return;
  const zoomPct = Math.round(cfg.zoom * 100);
  const flag = (label, key, accelerator) => ({ label, type: 'checkbox', checked: cfg[key], accelerator, click: (item) => setFlag(key, item.checked) });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide Side View' : 'Show Side View', accelerator: 'Ctrl+Alt+S', click: toggleWall },
    { label: 'Mute all screens', accelerator: 'Ctrl+Alt+M', click: muteAll },
    { label: 'Monitor', submenu: monitorMenu() },
    {
      label: 'Window',
      submenu: Array.from({ length: WINDOW_COUNT }, (_, k) => ({
        label: `Window ${k + 1}`, type: 'radio', checked: cfg.active === k, accelerator: `Ctrl+Alt+${k + 1}`, click: () => setWindow(k),
      })),
    },
    {
      label: 'Screens',
      submenu: Array.from({ length: MAX_PANES - MIN_PANES + 1 }, (_, k) => k + MIN_PANES).map((n) => ({
        label: `${n} screens`, type: 'radio', checked: cfg.panes.length === n, click: () => setPaneCount(n),
      })),
    },
    {
      label: 'Turn screens on/off',
      submenu: cfg.panes.map((p, i) => ({
        label: `Screen ${i + 1}`, type: 'checkbox', checked: !p.hidden, click: (item) => setPaneHidden(p.id, !item.checked),
      })),
    },
    {
      label: 'Picture-in-picture',
      submenu: cfg.panes.map((p, i) => ({
        label: `Screen ${i + 1}`,
        type: 'checkbox',
        checked: Boolean(views.get(p.id)?.pip),
        enabled: !p.hidden,
        click: (item) => (item.checked ? popOut(p.id) : dockBack(p.id)),
      })),
    },
    { type: 'separator' },
    flag('Settings bar', 'topBar', 'Ctrl+Alt+F'),
    flag('Cover the taskbar', 'coverTaskbar', 'Ctrl+Alt+T'),
    flag('Lock to part of the screen (other apps use the rest)', 'dockOn', 'Ctrl+Alt+K'),
    {
      label: 'Locked part',
      submenu: [
        ...DOCK_EDGES.map((edge) => ({ label: `${edge[0].toUpperCase()}${edge.slice(1)} edge`, type: 'radio', checked: cfg.dockEdge === edge, click: () => setDock(edge) })),
        { type: 'separator' },
        ...[0.25, 0.33, 0.5, 0.67, 0.75].map((z) => ({ label: `${Math.round(z * 100)}% of the screen`, type: 'radio', checked: Math.abs(cfg.dockSize - z) < 0.01, click: () => setDock(null, z) })),
      ],
    },
    flag('Keep on top', 'onTop'),
    flag('Lock all screens', 'freeLocked'),
    flag('Bars around screens', 'boxes', 'Ctrl+Alt+B'),
    flag('Glass look', 'glass'),
    flag('Score ticker', 'ticker'),
    {
      label: 'Ticker league',
      submenu: LEAGUES.map(([name, id]) => ({
        label: name, type: 'radio', checked: cfg.league === id, click: () => setLeague(id),
      })),
    },
    {
      label: `Page zoom (${zoomPct}%)`,
      submenu: ZOOM_PRESETS.map((z) => ({
        label: `${Math.round(z * 100)}%`, type: 'radio', checked: cfg.zoom === z, click: () => setAllZoom(z),
      })),
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: 'Control panel…', accelerator: 'Ctrl+Alt+P', click: openSettings },
    { label: 'Show settings file', click: () => shell.showItemInFolder(configPath()) },
    { type: 'separator' },
    { label: 'Quit Side View', click: () => app.quit() },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Side View');
  tray.on('click', toggleWall);
  tray.on('double-click', openSettings);
  refreshTray();
}

// ---------- lifecycle ----------

// Everything the self-test drives. Only used when SV_TEST=1.
function testHooks() {
  return {
    get cfg() { return cfg; },
    get win() { return win; },
    get settingsWin() { return settingsWin; },
    get focusedId() { return focusedId; },
    get shellReady() { return shellReady; },
    get freeDrag() { return freeDrag; },
    set freeDrag(d) { freeDrag = d; },
    views, PERF, PANEL_ACTIONS, MIN_PANES, MAX_PANES, MAX_FAVORITES, HEADER_H, TOOLBAR_H, TAB_H,
    loadConfig, saveConfig, configPath, presetLayout, ensurePlaced, placeNew, hitsOthers, overlap, visiblePanes,
    setPaneCount, setPaneHidden, setPaneLocked, popOut, dockBack, setWindow, setDisplay, toggleFavorite, addFavorite,
    moveFavorite, isFavorite, openFavorite, layoutCode, applyLayoutCode, setFit, setMuted, muteAll, normalizeInput,
    computeLayout, layoutPanes, sendState, panelState, applyLive, endFreeDrag, tweenTo, coverScreen, physical,
    targetDisplay, wall, setFlag, loadPane, openSettings, displayList, setPaneZoom, anyLocked,
    cleanTitle, resourceStats, rememberZoom, zoomFor, siteOf, setAllZoom, stopTween, physical,
    get gliding() { return gliding; },
    get visible() { return visible; },
    set visible(v) { visible = v; },
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWall());

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    cfg = loadConfig();
    createWindow();
    if (TEST) {
      // hidden: no tray, no shortcuts, no window on screen
      coverScreen();
      layoutPanes();
      require('./selftest')(testHooks());
      return;
    }
    createTray();
    fetchScores();
    showWall();

    globalShortcut.register('Control+Alt+S', toggleWall);
    globalShortcut.register('Control+Alt+M', muteAll);
    globalShortcut.register('Control+Alt+F', () => setFlag('topBar', !cfg.topBar));
    globalShortcut.register('Control+Alt+D', nextDisplay);
    globalShortcut.register('Control+Alt+N', () => setPaneCount(cfg.panes.length + 1));
    globalShortcut.register('Control+Alt+B', () => setFlag('boxes', !cfg.boxes));
    globalShortcut.register('Control+Alt+T', () => setFlag('coverTaskbar', !cfg.coverTaskbar));
    globalShortcut.register('Control+Alt+P', openSettings);
    globalShortcut.register('Control+Alt+K', () => setFlag('dockOn', !cfg.dockOn));
    for (let k = 0; k < WINDOW_COUNT; k++) globalShortcut.register(`Control+Alt+${k + 1}`, () => setWindow(k));

    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) {
      screen.on(ev, () => { forgetMonitors(); logLine(`monitors changed (${ev})`); scheduleCover(); refreshTray(); sendState(); });
    }
  });

  // Tray app: hiding the wall must not end the process.
  app.on('window-all-closed', () => {});

  // Older versions reserved screen space for a docked strip; make sure nothing is left reserved.
  app.on('before-quit', () => { quitting = true; releaseSpace(); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); releaseSpace(); });
  process.on('exit', releaseSpace);
  process.on('uncaughtException', (err) => { console.error(err); logLine(`uncaught error: ${err && err.stack ? err.stack : err}`); releaseSpace(); });
  // A crashed page reloads itself; a crashed bar/frame layer reloads too. Either way it's logged.
  app.on('render-process-gone', (_e, wc, details) => {
    const id = [...views.entries()].find(([, v]) => v.view.webContents === wc)?.[0];
    logLine(`page process gone (${details.reason}, exit ${details.exitCode}) in ${id ? `screen ${id}` : wc === win?.webContents ? 'the bars' : 'a window'}`);
    if (details.reason === 'clean-exit') return;
    setTimeout(() => {
      if (wc.isDestroyed()) return;
      if (wc === win?.webContents) { shellReady = false; wc.reload(); } else if (id) { const p = paneById(id); if (p) loadPane(p); }
    }, 1000);
  });
  app.on('child-process-gone', (_e, details) => logLine(`helper process gone: ${details.type} (${details.reason}, exit ${details.exitCode})`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseSpace(); process.exit(0); });
}
