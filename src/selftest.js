'use strict';
// 7 Views' built-in self-test. Run it with:  SV_TEST=1 SV_TEST_OUT=results.json electron .
// It starts a hidden 7 Views with a throwaway profile (main.js switches userData when SV_TEST=1), drives every
// feature through the real code, times the hot paths, runs the A/B speed comparisons, writes everything to
// SV_TEST_OUT as JSON and quits. Nothing appears on screen and the real settings are never touched.

const { app, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, step = 40) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    await sleep(step);
  }
  return false;
}
const near = (a, b, eps = 0.002) => Math.abs(a - b) <= eps;
const sameRect = (a, b) => a && b && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] || 0; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

module.exports = async function selftest(h) {
  const t0 = Date.now();
  const startedAt = process.uptime() * 1000; // ms since the process started, when the window exists
  const results = [];
  const perf = {};
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  async function test(group, name, fn) {
    const s = performance.now();
    try {
      const detail = await fn();
      results.push({ group, name, ok: true, ms: round(performance.now() - s, 1), detail: detail || '' });
    } catch (err) {
      results.push({ group, name, ok: false, ms: round(performance.now() - s, 1), detail: err.message });
    }
  }

  const free = () => h.cfg.free;
  const ids = () => h.visiblePanes().map((p) => p.id);
  const noOverlap = () => {
    const list = h.visiblePanes().map((p) => free()[p.id]).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.x < -1e-6 || r.y < -1e-6 || r.x + r.w > 1.0001 || r.y + r.h > 1.0001) return false;
      for (let j = i + 1; j < list.length; j++) if (h.overlap(r, list[j])) return false;
    }
    return true;
  };
  const wc = (id) => h.views.get(id).view.webContents;
  const loaded = (id) => !wc(id).isLoading();
  const unlockAll = () => { h.cfg.freeLocked = false; for (const p of h.cfg.panes) p.locked = false; };

  // a small local web server for pages, a favicon and a "ping" the screens try to reach
  const icon = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray.png'));
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(icon); return; }
    if (req.url === '/ping') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }); res.end('pong'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Test page ${req.url}</title><body style="margin:0;background:#123">
      <div style="transform:translateX(10px)"><video width="320" height="180" style="background:#345"></video></div></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ================= startup =================
  await waitFor(() => h.shellReady, 20000);
  perf.startup = { windowCreatedMs: round(startedAt, 0), shellReadyMs: round(process.uptime() * 1000, 0) };
  await waitFor(() => h.cfg.panes.every((p) => loaded(p.id)), 20000);
  perf.startup.pagesLoadedMs = round(process.uptime() * 1000, 0);

  await test('Startup', 'Opens with the default setup', () => {
    assert(h.cfg.panes.length === 4, `expected 4 screens, got ${h.cfg.panes.length}`);
    assert(h.cfg.arrangeStyle === 'center', 'default preset should be Center');
    assert(h.cfg.topBar === true, 'settings bar should start on');
    assert(noOverlap(), 'screens overlap on first start');
    return `${h.cfg.panes.length} screens, Center, no overlaps`;
  });
  await test('Startup', 'Every page view is laid out and visible', () => {
    const layout = h.computeLayout();
    for (const l of layout) {
      const v = h.views.get(l.id).view;
      assert(v.getVisible(), `${l.id} hidden`);
      const b = v.getBounds();
      assert(b.width > 50 && b.height > 50, `${l.id} has no size (${JSON.stringify(b)})`);
    }
    return `${layout.length} views placed`;
  });

  // ================= settings file =================
  await test('Settings file', 'Saves and loads back', async () => {
    h.cfg.ticker = true;
    h.cfg.coverTaskbar = true;
    h.saveConfig();
    await sleep(500);
    const back = h.loadConfig();
    assert(back.ticker === true && back.coverTaskbar === true, 'flags did not survive a save');
    assert(back.panes.length === h.cfg.panes.length, 'screen count did not survive');
    h.cfg.ticker = false;
    h.cfg.coverTaskbar = false;
    h.saveConfig();
    await sleep(400);
    return 'flags and screens round-trip';
  });
  await test('Settings file', 'Cleans up old and damaged settings', async () => {
    const file = h.configPath();
    const keep = fs.readFileSync(file, 'utf8');
    try {
      fs.writeFileSync(file, JSON.stringify({
        width: 340, side: 'left', mode: 'bar', layout: 'main', arrangeStyle: 'spiral', zoom: 99,
        panes: Array.from({ length: 12 }, (_, k) => ({ id: `x${k}`, url: k === 0 ? 'javascript:alert(1)' : `https://site${k}.example/` })),
        favorites: [{ url: 'file:///C:/secret' }, { url: 'https://ok.example/', icon: 'data:text/html,<script>' }],
        discordInvite: 'https://evil.example/',
      }));
      const c = h.loadConfig();
      assert(!('width' in c) && !('side' in c) && !('mode' in c), 'old strip settings were kept');
      assert(c.panes.length === h.MAX_PANES, `expected ${h.MAX_PANES} screens, got ${c.panes.length}`);
      assert(c.panes[0].url === '', 'a javascript: link got through');
      assert(c.arrangeStyle === 'center', 'unknown preset was kept');
      assert(c.zoom <= 1.5, 'zoom was not clamped');
      assert(c.favorites.length === 1 && c.favorites[0].icon === '', 'bad favorites were kept');
      assert(c.discordInvite === '', 'a non-Discord invite link was kept');
      return 'drops strip settings, caps at 6 screens, rejects bad links, icons and invites';
    } finally {
      fs.writeFileSync(file, keep);
    }
  });
  await test('Settings file', 'A file saved with a BOM still loads', async () => {
    const file = h.configPath();
    const keep = fs.readFileSync(file, 'utf8');
    try {
      fs.writeFileSync(file, `\ufeff${JSON.stringify({ ticker: true, panes: [{ id: 'q1' }, { id: 'q2' }] })}`);
      const c = h.loadConfig();
      assert(c.ticker === true && c.panes.length === 2, 'the BOM made it fall back to defaults');
      return 'byte-order mark ignored, settings kept';
    } finally {
      fs.writeFileSync(file, keep);
    }
  });

  // ================= screens and presets =================
  await test('Screens', 'Screen count stays between 2 and 9', async () => {
    h.setPaneCount(1);
    assert(h.cfg.panes.length === h.MIN_PANES, `went below ${h.MIN_PANES}`);
    h.setPaneCount(12);
    await sleep(320); // still on a preset, so the screens glide to an even spread
    assert(h.cfg.panes.length === h.MAX_PANES, `went above ${h.MAX_PANES}`);
    assert(noOverlap(), 'new screens overlap');
    h.setPaneCount(4);
    await sleep(320);
    return '2..9 enforced, new screens placed without overlap';
  });
  await test('Screens', 'Row: 2 screens are equal halves, 3 are equal thirds', async () => {
    unlockAll();
    h.setPaneCount(2);
    await sleep(320);
    h.PANEL_ACTIONS.arrange('row');
    await sleep(320);
    const widths = () => ids().map((id) => free()[id].w);
    const two = widths();
    h.setPaneCount(3); // still on Row, so the three re-spread evenly
    await sleep(320);
    const three = widths();
    const even = (ws, n) => ws.length === n && ws.every((w) => Math.abs(w - (1 / n - 0.008)) < 0.003);
    assert(even(two, 2), `two screens: ${two.map((w) => w.toFixed(3)).join(', ')}`);
    assert(even(three, 3), `three screens: ${three.map((w) => w.toFixed(3)).join(', ')}`);
    assert(noOverlap(), 'overlap in the row');
    assert(ids().every((id) => free()[id].h > 0.98), 'not full height');
    h.setPaneCount(4);
    await sleep(320);
    h.cfg.arrangeStyle = 'center';
    return `halves ${two.map((w) => w.toFixed(3)).join(' / ')} · thirds ${three.map((w) => w.toFixed(3)).join(' / ')}`;
  });
  await test('Screens', 'Every preset fits 2 to 9 screens with no overlaps', () => {
    const bad = [];
    for (let n = 2; n <= 9; n++) {
      h.setPaneCount(n);
      for (const style of h.ARRANGE_STYLES) {
        h.cfg.free = h.presetLayout(style);
        if (!noOverlap()) bad.push(`${style}/${n}`);
        if (ids().some((id) => !free()[id])) bad.push(`${style}/${n} missing`);
      }
    }
    h.setPaneCount(4);
    h.cfg.free = h.presetLayout('center');
    h.layoutPanes();
    assert(!bad.length, `problems: ${bad.join(', ')}`);
    return `${8 * h.ARRANGE_STYLES.length} combinations clean`;
  });
  await test('Screens', 'Middle: 7 screens are 3 left, main in the middle, 3 right', async () => {
    unlockAll();
    h.setPaneCount(7);
    await sleep(320);
    h.PANEL_ACTIONS.arrange('middle');
    await sleep(320);
    const rs = ids().map((id) => free()[id]);
    const main = rs[rs.length - 1];
    const left = rs.filter((r) => r.x < 0.01);
    const right = rs.filter((r) => r.x + r.w > 0.99);
    assert(left.length === 3 && right.length === 3, `left ${left.length}, right ${right.length}`);
    assert(main.x > 0.2 && main.x + main.w < 0.8 && main.h > 0.98, 'main is not the middle column');
    assert(noOverlap(), 'overlap');
    h.setPaneCount(4);
    await sleep(320);
    h.stopTween();
    h.cfg.arrangeStyle = 'center';
    h.cfg.free = h.presetLayout('center');
    h.layoutPanes();
    return `side columns ${left[0].w.toFixed(3)}, middle ${main.w.toFixed(3)}`;
  });
  await test('Screens', 'Turning screens off and on (at least one stays on)', () => {
    const all = h.cfg.panes.map((p) => p.id);
    for (const id of all) h.setPaneHidden(id, true);
    assert(h.visiblePanes().length === 1, `expected 1 left on, got ${h.visiblePanes().length}`);
    for (const id of all) h.setPaneHidden(id, false);
    assert(h.visiblePanes().length === all.length, 'screens did not come back');
    assert(noOverlap(), 'returning screens overlap');
    return 'last screen protected, returning screens find free spots';
  });
  await test('Screens', 'Per-screen page zoom', async () => {
    const id = ids()[0];
    h.setPaneZoom(id, 0.6);
    await sleep(100);
    assert(near(wc(id).getZoomFactor(), 0.6, 0.01), `zoom is ${wc(id).getZoomFactor()}`);
    h.setPaneZoom(id, 9);
    assert(h.cfg.panes.find((p) => p.id === id).zoom <= 1.5, 'zoom not clamped');
    h.setPaneZoom(id, 0.4);
    return 'sets and clamps';
  });
  await test('Screens', 'Settings bar on/off resizes the wall', () => {
    const on = h.wall().H;
    h.setFlag('topBar', false);
    const off = h.wall().H;
    h.setFlag('topBar', true);
    assert(off - on === h.TOOLBAR_H - h.TAB_H, `wall grew by ${off - on}px, expected ${h.TOOLBAR_H - h.TAB_H}`);
    return `screens gain ${off - on}px with the bar off`;
  });

  // ================= dragging =================
  const grid = () => { unlockAll(); h.setPaneCount(4); h.cfg.free = h.presetLayout('grid'); h.layoutPanes(); };
  const px = (r) => { const w = h.wall(); return { left: r.x * w.W, top: w.top + r.y * w.H, width: r.w * w.W, height: r.h * w.H }; };
  const centre = (r) => { const p = px(r); return { x: p.left + p.width / 2, y: p.top + p.height / 2 }; };

  await test('Dragging', 'Drop on another screen swaps them', async () => {
    grid();
    const [a, b] = ids();
    const ra = { ...free()[a] };
    const rb = { ...free()[b] };
    h.freeDrag = { id: a, kind: 'move', start: { ...ra }, target: '' };
    h.applyLive(a, px(rb), centre(rb));
    assert(h.freeDrag.target === b, `drop target was "${h.freeDrag.target}"`);
    h.endFreeDrag(a);
    await sleep(260);
    assert(sameRect(free()[a], rb) && sameRect(free()[b], ra), 'they did not swap');
    return 'swapped with a 180 ms glide';
  });
  await test('Dragging', 'Drop half over a screen with the pointer on empty space glides back', async () => {
    grid();
    const [a, b] = ids();
    const ra = { ...free()[a] };
    h.freeDrag = { id: a, kind: 'move', start: { ...ra }, target: '' };
    const r = px(free()[a]);
    r.left += r.width * 0.6; // overlaps the screen to the right
    h.applyLive(a, r, { x: -50, y: -50 });
    h.endFreeDrag(a);
    await sleep(260);
    assert(sameRect(free()[a], ra), 'did not return to where it started');
    assert(noOverlap(), 'left an overlap');
    return `back in place (${b} untouched)`;
  });
  await test('Dragging', 'Resizing never grows into a neighbour', async () => {
    grid();
    const [a] = ids();
    h.freeDrag = { id: a, kind: 'resize', start: { ...free()[a] }, target: '' };
    const r = px(free()[a]);
    r.width *= 3;
    r.height *= 3;
    h.applyLive(a, r, { x: 0, y: 0 });
    assert(noOverlap(), 'resize overlapped a neighbour during the drag');
    h.endFreeDrag(a);
    await sleep(260);
    assert(noOverlap(), 'resize overlapped after letting go');
    return 'stopped at the neighbour';
  });
  await test('Dragging', 'A drop snaps to the 8 px grid', async () => {
    grid();
    const [a] = ids();
    h.cfg.free = { [a]: { x: 0.0101, y: 0.0101, w: 0.2, h: 0.2 } };
    h.ensurePlaced();
    h.freeDrag = { id: a, kind: 'move', start: { ...free()[a] }, target: '' };
    h.applyLive(a, { ...px(free()[a]), left: 13, top: h.wall().top + 13 }, { x: -50, y: -50 });
    h.endFreeDrag(a);
    await sleep(260);
    const p = px(free()[a]);
    assert(Math.abs(p.left % 8) < 0.6 || Math.abs((p.left % 8) - 8) < 0.6, `left ${p.left} not on the grid`);
    h.cfg.free = h.presetLayout('center');
    h.layoutPanes();
    return `landed at ${round(p.left, 1)} px`;
  });

  // ================= locks =================
  await test('Locks', 'A locked screen blocks layout codes; a preset unlocks it', () => {
    grid();
    h.setPaneLocked(ids()[0], true);
    assert(h.anyLocked(), 'lock not registered');
    const res = h.applyLayoutCode(h.layoutCode());
    assert(!res.ok, 'a layout code applied while locked');
    h.PANEL_ACTIONS.arrange('side');
    assert(!h.anyLocked() && h.cfg.arrangeStyle === 'side', 'the preset did not unlock and run');
    h.stopTween();
    return 'codes wait; presets unlock and arrange';
  });
  await test('Locks', 'Lock all stops drags; a preset turns it off', () => {
    grid();
    h.setFlag('freeLocked', true);
    h.PANEL_ACTIONS.arrange('row');
    assert(!h.cfg.freeLocked && h.cfg.arrangeStyle === 'row', 'the preset did not run under lock all');
    h.stopTween();
    h.cfg.arrangeStyle = 'center';
    return 'preset wins over lock all';
  });

  // ================= picture-in-picture =================
  await test('Picture-in-picture', 'Pop out and back', async () => {
    grid();
    const id = ids()[1];
    h.popOut(id);
    await waitFor(() => h.views.get(id).pip && !h.views.get(id).pip.webContents.isLoading(), 5000);
    assert(h.views.get(id).pip, 'no floating window');
    assert(!ids().includes(id), 'still in the wall layout');
    assert(h.panelState().panes.find((p) => p.id === id).pip, 'panel does not show it floating');
    h.dockBack(id);
    assert(!h.views.get(id).pip && ids().includes(id), 'did not come back');
    assert(noOverlap(), 'came back on top of another screen');
    return 'floats, shows as a chip, returns to a free spot';
  });
  await test('Picture-in-picture', 'The last screen in place cannot float away', () => {
    h.setPaneCount(2);
    const [a, b] = ids();
    h.popOut(a);
    h.popOut(b);
    const floating = [a, b].filter((id) => h.views.get(id).pip).length;
    h.dockBack(a);
    h.dockBack(b);
    h.setPaneCount(4);
    assert(floating === 1, `${floating} floated`);
    return 'one stays on the wall';
  });

  // ================= windows and monitors =================
  await test('Windows', 'Switching windows keeps each one\'s screens', () => {
    const w0 = h.cfg.panes.map((p) => p.id).join();
    h.setWindow(1);
    const w1 = h.cfg.panes.map((p) => p.id).join();
    h.setWindow(0);
    assert(w0 !== w1, 'window 2 has the same screens as window 1');
    assert(h.cfg.panes.map((p) => p.id).join() === w0, 'window 1 changed after switching back');
    assert(noOverlap(), 'overlap after switching');
    return `window 1: ${w0} / window 2: ${w1}`;
  });

  const displays = screen.getAllDisplays();
  const home = h.targetDisplay().id;
  perf.monitorMoves = [];
  await test('Monitors', `Moves to each of the ${displays.length} monitors and fills it`, async () => {
    const report = [];
    for (const d of [...displays.filter((x) => x.id !== home), displays.find((x) => x.id === home)]) {
      const s = performance.now();
      h.setDisplay(d.id);
      const ok = await waitFor(() => {
        const b = h.win.getBounds();
        const wa = d.workArea;
        return Math.abs(b.x - wa.x) <= 2 && Math.abs(b.y - wa.y) <= 2 && Math.abs(b.width - wa.width) <= 3 && Math.abs(b.height - wa.height) <= 3;
      }, 5000, 20);
      const ms = round(performance.now() - s, 0);
      perf.monitorMoves.push({ monitor: d.label || String(d.id), scale: d.scaleFactor, ms, ok });
      report.push(`${d.label || d.id} ${ok ? `${ms} ms` : 'did not fit'}`);
      await sleep(400);
    }
    assert(perf.monitorMoves.every((m) => m.ok), `did not fit: ${report.join(', ')}`);
    return report.join(' · ');
  });
  await test('Monitors', 'Each monitor remembers its own layout', async () => {
    if (displays.length < 2) return 'only one monitor (skipped)';
    unlockAll();
    // forget what the previous test left on the other monitors, so "a new monitor starts from the same layout" is real
    for (const k of Object.keys(h.cfg.freeBy)) if (k !== String(home)) delete h.cfg.freeBy[k];
    const other = displays.find((x) => x.id !== home).id;
    const a = ids()[0];
    const homeRect = { ...free()[a] };
    h.setDisplay(other);
    await sleep(300);
    assert(sameRect(free()[a], homeRect), 'a new monitor did not start from the same layout');
    h.cfg.free[a] = { ...free()[a], w: Math.max(0.12, free()[a].w - 0.05) };
    const changed = { ...free()[a] };
    h.setDisplay(home);
    await sleep(300);
    assert(sameRect(free()[a], homeRect), 'home monitor lost its layout');
    h.setDisplay(other);
    await sleep(300);
    assert(sameRect(free()[a], changed), 'the other monitor forgot its change');
    h.setDisplay(home);
    await sleep(600);
    return 'same start everywhere, changes stay per monitor';
  });

  // ================= favorites =================
  await test('Favorites', 'Save a site with its icon', async () => {
    const id = ids()[0];
    h.PANEL_ACTIONS.navigate(id, `${base}/fav`);
    await waitFor(() => wc(id).getURL().startsWith(base) && loaded(id), 5000);
    h.toggleFavorite(id);
    assert(h.isFavorite(`${base}/fav`), 'not saved');
    const got = await waitFor(() => h.cfg.favorites[0] && h.cfg.favorites[0].icon.startsWith('data:image/png'), 6000);
    assert(got, 'icon never arrived');
    h.toggleFavorite(id);
    assert(!h.isFavorite(`${base}/fav`), 'second click did not remove it');
    return `icon ${h.cfg.favorites.length === 0 ? 'fetched, then removed' : ''}`;
  });
  await test('Favorites', 'Add by typing, reorder, cap at 16, open in a screen', async () => {
    h.cfg.favorites = [];
    h.addFavorite('example.com');
    assert(h.cfg.favorites[0] && h.cfg.favorites[0].url === 'https://example.com', `typed link became ${h.cfg.favorites[0] && h.cfg.favorites[0].url}`);
    h.addFavorite('example.com');
    assert(h.cfg.favorites.length === 1, 'duplicate added');
    h.addFavorite('javascript:alert(1)');
    assert(h.cfg.favorites.every((f) => /^https?:/.test(f.url)), 'a javascript: link got in');
    for (let k = 0; k < 20; k++) h.addFavorite(`site${k}.example.org`);
    assert(h.cfg.favorites.length === h.MAX_FAVORITES, `${h.cfg.favorites.length} favorites`);
    const first = h.cfg.favorites[0].url;
    h.moveFavorite(0, 1);
    assert(h.cfg.favorites[1].url === first, 'reorder failed');
    const target = ids()[1];
    h.cfg.favorites.unshift({ url: `${base}/opened`, title: 'local', icon: '' });
    h.openFavorite(0, target);
    await waitFor(() => wc(target).getURL() === `${base}/opened`, 5000);
    assert(wc(target).getURL() === `${base}/opened`, 'favorite did not open in the chosen screen');
    h.cfg.favorites = [];
    h.sendState();
    return 'normalizes, dedupes, rejects javascript:, caps, reorders, opens';
  });

  // ================= layout codes =================
  await test('Layout codes', 'Share and paste round-trip', async () => {
    grid();
    const code = h.layoutCode();
    const before = JSON.stringify(free());
    h.cfg.free = h.presetLayout('side');
    const res = h.applyLayoutCode(code);
    await sleep(320);
    assert(res.ok, res.message);
    const same = ids().every((id) => sameRect(free()[id], JSON.parse(before)[id]));
    assert(same, 'layout did not come back exactly');
    return `${code.length}-character code`;
  });
  await test('Layout codes', 'Junk, damaged and link-carrying codes are refused', () => {
    const bad = ['hello', 'SV1-!!!!', 'SV1-abcdefgh', `SV1-${Buffer.from(JSON.stringify({ v: 1, s: [[0, 0, 500, 500, 'https://x']] })).toString('base64url')}`];
    const accepted = bad.filter((c) => h.applyLayoutCode(c).ok);
    assert(!accepted.length, `accepted: ${accepted.join(', ')}`);
    return `${bad.length} refused`;
  });

  // ================= sound =================
  await test('Sound', 'Only one screen plays at a time; mute all', () => {
    const [a, b] = ids();
    h.setMuted(a, false);
    h.setMuted(b, false);
    assert(h.views.get(a).muted && !h.views.get(b).muted, 'two screens unmuted at once');
    assert(wc(a).isAudioMuted() && !wc(b).isAudioMuted(), 'page audio state does not match');
    h.muteAll();
    assert(ids().every((id) => h.views.get(id).muted && wc(id).isAudioMuted()), 'mute all missed a screen');
    return 'exclusive, and mute all works';
  });

  // ================= show only video =================
  await test('Show only video', 'Fit, fill and off', async () => {
    const id = ids()[2];
    h.PANEL_ACTIONS.navigate(id, `${base}/video`);
    await waitFor(() => wc(id).getURL() === `${base}/video` && loaded(id), 5000);
    const fit = async () => wc(id).executeJavaScript(`(() => { const v = document.querySelector('[data-sv-fit]'); return v ? getComputedStyle(v).objectFit + ' ' + (v.getBoundingClientRect().width === innerWidth) : 'none'; })()`);
    h.setFit(id, 'fit');
    await waitFor(async () => (await fit()).startsWith('contain'), 3000);
    const a = await fit();
    h.setFit(id, 'fill');
    await waitFor(async () => (await fit()).startsWith('cover'), 3000);
    const b = await fit();
    h.setFit(id, 'off');
    await waitFor(async () => (await fit()) === 'none', 3000);
    const c = await fit();
    assert(a === 'contain true', `fit gave "${a}"`);
    assert(b === 'cover true', `fill gave "${b}"`);
    assert(c === 'none', `off left "${c}"`);
    return 'video fills the screen even inside a transformed parent';
  });

  await test('Show only video', 'Fill, keep bottom anchors the picture to the bottom', async () => {
    const id = ids()[2];
    const pos = async () => wc(id).executeJavaScript(`(() => { const v = document.querySelector('[data-sv-fit]'); return v ? getComputedStyle(v).objectFit + ' / ' + getComputedStyle(v).objectPosition : 'none'; })()`);
    h.setFit(id, 'bottom');
    await waitFor(async () => (await pos()).startsWith('cover / 50% 100%'), 3000);
    const got = await pos();
    h.setFit(id, 'off');
    assert(got === 'cover / 50% 100%', `got "${got}"`);
    return 'object-fit cover, object-position center bottom';
  });

  // ================= the six fixes from the Pluto field test =================
  await test('Glide', 'Live pages come back after a glide, even an interrupted one', async () => {
    grid();
    h.visible = true; // let the photo path run as it would on screen
    h.tweenTo(h.presetLayout('side'), 260, true);
    await sleep(60);
    h.tweenTo(h.presetLayout('center'), 260, true); // interrupt it
    await sleep(700);
    h.visible = false;
    const hidden = ids().filter((id) => !h.views.get(id).view.getVisible());
    assert(h.gliding.size === 0, `${h.gliding.size} screens still marked gliding`);
    assert(!hidden.length, `live pages left hidden: ${hidden.join(', ')}`);
    const target = h.presetLayout('center');
    assert(ids().every((id) => sameRect(free()[id], target[id])), 'did not end at the second preset');
    return 'no page left hidden, ended on the last preset';
  });
  await test('Zoom', 'Zoom follows the website across screens', async () => {
    const [a, b, c] = ids();
    h.PANEL_ACTIONS.navigate(a, `${base}/zoom-a`);
    h.PANEL_ACTIONS.navigate(b, `${base}/zoom-b`);
    await waitFor(() => wc(a).getURL().startsWith(base) && wc(b).getURL().startsWith(base) && loaded(a) && loaded(b), 6000);
    h.setPaneZoom(a, 0.65);
    await sleep(120);
    assert(near(wc(b).getZoomFactor(), 0.65, 0.01), `other screen on the same site is at ${wc(b).getZoomFactor()}`);
    h.PANEL_ACTIONS.navigate(c, `${base}/zoom-c`);
    await waitFor(() => wc(c).getURL().startsWith(base) && loaded(c), 6000);
    await sleep(200);
    assert(near(wc(c).getZoomFactor(), 0.65, 0.01), `a screen opening the site later is at ${wc(c).getZoomFactor()}`);
    assert(near(h.cfg.siteZoom['127.0.0.1'], 0.65, 0.001), 'not remembered in settings');
    h.setAllZoom(0.4);
    assert(Object.keys(h.cfg.siteZoom).length === 0, '"all screens" did not reset site zooms');
    return 'shared by every screen on the site, remembered, reset by "all screens"';
  });
  await test('Control panel', 'Memory and CPU readout', () => {
    const r = h.panelState().resources;
    assert(r.totalMB > 50 && r.processes > 2, `total ${r.totalMB} MB, ${r.processes} processes`);
    const per = h.panelState().panes.filter((p) => !p.hidden).map((p) => p.memoryMB);
    assert(per.every((m) => m > 5), `per-screen: ${per.join(', ')}`);
    return `${r.totalMB} MB in ${r.processes} processes; screens ${per.join(' / ')} MB`;
  });
  await test('Favorites', 'Favorite names are trimmed', () => {
    const cases = [
      ['Watch NFL Channel: Live TV Channel for Free | Pluto TV', 'https://pluto.tv/us/live-tv/nfl-channel', 'NFL Channel'],
      ['Big game highlights - YouTube', 'https://www.youtube.com/watch?v=1', 'Big game highlights'],
      ['ESPN - Serving Sports Fans. Anytime. Anywhere.', 'https://www.espn.com/', 'ESPN'],
      ['Discord', 'https://discord.com/invite/x', 'Discord'],
      ['', 'https://example.com/', 'example.com'],
    ];
    const bad = cases.filter(([t, u, want]) => h.cleanTitle(t, u) !== want).map(([t, u]) => `"${t}" -> "${h.cleanTitle(t, u)}"`);
    assert(!bad.length, bad.join('; '));
    return `${cases.length} titles trimmed as expected`;
  });
  await test('Monitors', 'Monitor size is the real pixel size', () => {
    const list = h.displayList();
    const bad = list.filter((d) => {
      const b = h.physical(screen.getAllDisplays().find((x) => x.id === d.id)).bounds;
      return d.size !== `${b.width}x${b.height}`;
    });
    assert(!bad.length, bad.map((d) => d.size).join(', '));
    return list.map((d) => `${d.name} ${d.size}`).join(' · ');
  });

  // ================= safety =================
  await test('Safety', 'Websites cannot reach apps on this PC', async () => {
    const id = ids()[3];
    await wc(id).loadURL('data:text/html,<title>outside</title>');
    const r = await wc(id).executeJavaScript(`fetch('${base}/ping').then(() => 'reached', () => 'blocked')`);
    const ws = await wc(id).executeJavaScript(`new Promise((ok) => { const s = new WebSocket('ws://127.0.0.1:6463/?v=1'); s.onopen = () => ok('reached'); s.onerror = () => ok('blocked'); setTimeout(() => ok('blocked'), 3000); })`);
    assert(r === 'blocked', `http to this PC was ${r}`);
    assert(ws === 'blocked', `websocket to this PC was ${ws}`);
    return 'http and websocket to 127.0.0.1 blocked';
  });
  await test('Safety', 'A page on this PC can still talk to itself', async () => {
    const id = ids()[3];
    await wc(id).loadURL(`${base}/self`);
    const r = await wc(id).executeJavaScript(`fetch('/ping').then((x) => x.text(), () => 'blocked')`);
    assert(r === 'pong', `got ${r}`);
    return 'localhost pages still work';
  });
  await test('Safety', 'Popups are held back with a bar', async () => {
    const id = ids()[3];
    await wc(id).executeJavaScript(`window.open('https://example.com/popup')`, true);
    await waitFor(() => h.views.get(id).blocked, 2000);
    assert(h.views.get(id).blocked === 'https://example.com/popup', `blocked: "${h.views.get(id).blocked}"`);
    h.PANEL_ACTIONS.reload(id);
    h.views.get(id).blocked = '';
    h.layoutPanes();
    return 'popup blocked, no new window';
  });
  await test('Safety', 'A site that fails shows "Couldn\'t load"', async () => {
    const id = ids()[3];
    h.PANEL_ACTIONS.navigate(id, 'https://sv-selftest.invalid/');
    const ok = await waitFor(() => wc(id).getURL().includes('error.html'), 10000);
    assert(ok, `stayed on ${wc(id).getURL()}`);
    const title = await wc(id).executeJavaScript(`document.getElementById('title').textContent`);
    assert(/sv-selftest\.invalid/.test(title), `title: ${title}`);
    return title;
  });
  await test('Safety', 'Control panel ignores bad requests', () => {
    const skip = new Set(['quit', 'show', 'hide', 'openDiscord']);
    const junk = [undefined, null, 'nope', {}, -5, 9999, '<script>'];
    let calls = 0;
    for (const [name, fn] of Object.entries(h.PANEL_ACTIONS)) {
      if (skip.has(name)) continue;
      for (const a of junk) for (const b of junk) { fn(a, b); calls++; }
    }
    assert(h.cfg.panes.length >= h.MIN_PANES && h.cfg.panes.length <= h.MAX_PANES, 'screen count broke');
    assert(h.cfg.discordInvite === '', 'junk invite was saved');
    return `${calls} junk calls, nothing broke`;
  });
  unlockAll();
  h.setPaneCount(4);
  h.cfg.free = h.presetLayout('center');
  h.layoutPanes();

  // ================= speed =================
  const S = (n) => h.setPaneCount(n);
  const timeIt = (fn, n) => { const xs = []; for (let i = 0; i < n; i++) { const s = performance.now(); fn(i); xs.push(performance.now() - s); } return xs; };

  // count and size what goes to the shell and the control panel
  const shellSend = h.win.webContents.send.bind(h.win.webContents);
  const tap = { count: 0, bytes: 0, times: [] };
  h.win.webContents.send = (channel, ...args) => {
    if (channel === 'state') { tap.count++; tap.bytes += JSON.stringify(args).length; tap.times.push(performance.now()); }
    return shellSend(channel, ...args);
  };
  const resetTap = () => { tap.count = 0; tap.bytes = 0; tap.times = []; };

  await test('Speed', 'Layout with 6 screens', () => {
    S(6);
    h.cfg.free = h.presetLayout('grid');
    const xs = timeIt(() => h.layoutPanes(), 300);
    perf.layout6 = { avgMs: round(avg(xs), 3), p95Ms: round(pct(xs, 95), 3), maxMs: round(Math.max(...xs), 3) };
    return `avg ${perf.layout6.avgMs} ms, 95% under ${perf.layout6.p95Ms} ms (a frame is 16.7 ms)`;
  });
  await test('Speed', 'One drag frame with 6 screens', () => {
    const id = ids()[0];
    const r0 = px(free()[id]);
    h.freeDrag = { id, kind: 'move', start: { ...free()[id] }, target: '' };
    const xs = timeIt((i) => h.applyLive(id, { ...r0, left: r0.left + (i % 200), top: r0.top + (i % 80) }, { x: 5, y: 5 }), 240);
    h.freeDrag = null;
    h.cfg.free = h.presetLayout('grid');
    h.layoutPanes();
    perf.dragFrame = { avgMs: round(avg(xs), 3), p95Ms: round(pct(xs, 95), 3), maxMs: round(Math.max(...xs), 3) };
    return `avg ${perf.dragFrame.avgMs} ms, 95% under ${perf.dragFrame.p95Ms} ms`;
  });

  // A/B 1: favorites (with icons) in every state update, or only when they change
  const fakeIcon = `data:image/png;base64,${'A'.repeat(12000)}`;
  const abFav = {};
  for (const [label, every] of [['A: icons every frame', true], ['B: icons only when changed', false]]) {
    h.cfg.favorites = Array.from({ length: 16 }, (_, k) => ({ url: `https://fav${k}.example/`, title: `Favorite ${k}`, icon: fakeIcon }));
    h.PERF.favoritesEveryState = every;
    h.sendState(); // first send always carries them
    resetTap();
    const id = ids()[0];
    const r0 = px(free()[id]);
    h.freeDrag = { id, kind: 'move', start: { ...free()[id] }, target: '' };
    const xs = [];
    for (let i = 0; i < 120; i++) {
      const s = performance.now();
      h.applyLive(id, { ...r0, left: r0.left + i, top: r0.top + i / 2 }, { x: 5, y: 5 });
      xs.push(performance.now() - s);
    }
    h.freeDrag = null;
    abFav[label] = { frames: 120, messages: tap.count, kbPerFrame: round(tap.bytes / tap.count / 1024, 1), mbPerSecondAt60fps: round((tap.bytes / tap.count) * 60 / 1048576, 2), avgFrameMs: round(avg(xs), 3) };
  }
  h.PERF.favoritesEveryState = false;
  h.cfg.favorites = [];
  h.sendState();
  perf.abFavorites = abFav;
  await test('Speed', 'A/B 1: favorite icons in every update vs only on change', () => {
    const a = abFav['A: icons every frame'];
    const b = abFav['B: icons only when changed'];
    assert(b.kbPerFrame < a.kbPerFrame, 'B was not smaller');
    return `A ${a.kbPerFrame} KB/frame (${a.mbPerSecondAt60fps} MB/s) vs B ${b.kbPerFrame} KB/frame (${b.mbPerSecondAt60fps} MB/s); frame ${a.avgFrameMs} ms vs ${b.avgFrameMs} ms`;
  });

  // A/B 2: control panel updates during a 2-second drag, unthrottled vs 100 ms
  h.openSettings();
  await waitFor(() => h.settingsWin && !h.settingsWin.webContents.isLoading(), 8000);
  const panelSend = h.settingsWin.webContents.send.bind(h.settingsWin.webContents);
  const ptap = { count: 0, bytes: 0 };
  h.settingsWin.webContents.send = (channel, ...args) => {
    if (channel === 'panel-state') { ptap.count++; ptap.bytes += JSON.stringify(args).length; }
    return panelSend(channel, ...args);
  };
  const abPanel = {};
  for (const [label, ms] of [['A: every change', 0], ['B: at most every 100 ms', 100]]) {
    h.PERF.panelThrottleMs = ms;
    await sleep(150);
    ptap.count = 0;
    ptap.bytes = 0;
    const id = ids()[0];
    const r0 = px(free()[id]);
    h.freeDrag = { id, kind: 'move', start: { ...free()[id] }, target: '' };
    const s = performance.now();
    for (let i = 0; i < 120; i++) {
      h.applyLive(id, { ...r0, left: r0.left + i, top: r0.top }, { x: 5, y: 5 });
      await sleep(16);
    }
    const spent = performance.now() - s;
    h.freeDrag = null;
    await sleep(150);
    abPanel[label] = { dragSeconds: round(spent / 1000, 2), panelUpdates: ptap.count, kb: round(ptap.bytes / 1024, 0) };
  }
  h.PERF.panelThrottleMs = 100;
  perf.abPanel = abPanel;
  await test('Speed', 'A/B 2: control panel updates while dragging', () => {
    const a = abPanel['A: every change'];
    const b = abPanel['B: at most every 100 ms'];
    assert(b.panelUpdates < a.panelUpdates, 'throttle did not reduce updates');
    return `A ${a.panelUpdates} updates (${a.kb} KB) vs B ${b.panelUpdates} updates (${b.kb} KB) over ~${b.dragSeconds}s`;
  });
  h.settingsWin.destroy();

  // A/B 3: the frame timer behind drags, glides and fades. Windows timers tick about every 15.6 ms, so asking for
  // 16 ms can wait for the next tick (about 31 ms). Measure real spacing for each choice.
  const glide = async () => {
    S(6);
    h.cfg.free = h.presetLayout('grid');
    h.layoutPanes();
    await sleep(100);
    resetTap();
    h.tweenTo(h.presetLayout('side'), 260, true);
    await sleep(420);
    const gaps = tap.times.slice(1).map((t, i) => t - tap.times[i]);
    return { frames: tap.count, fps: round(1000 / avg(gaps), 0), avgGapMs: round(avg(gaps), 1), worstGapMs: round(Math.max(...gaps), 1) };
  };
  const abTimer = {};
  const chosen = h.PERF.frameMs;
  for (const ms of [16, 8, 4]) {
    h.PERF.frameMs = ms;
    const runs = [await glide(), await glide(), await glide()];
    const cpu0 = process.cpuUsage();
    const t = performance.now();
    await new Promise((r) => { let n = 0; const iv = setInterval(() => { if (++n >= 60) { clearInterval(iv); r(); } }, ms); });
    const cpu = process.cpuUsage(cpu0);
    abTimer[`${ms} ms`] = {
      fps: round(avg(runs.map((r) => r.fps)), 0),
      avgGapMs: round(avg(runs.map((r) => r.avgGapMs)), 1),
      worstGapMs: round(Math.max(...runs.map((r) => r.worstGapMs)), 1),
      idleTickCpuMsPer60: round((cpu.user + cpu.system) / 1000, 1),
      sixtyTicksTookMs: round(performance.now() - t, 0),
    };
  }
  h.PERF.frameMs = chosen;
  perf.abTimer = abTimer;
  await test('Speed', 'A/B 3: frame timer 16 vs 8 vs 4 ms', () => Object.entries(abTimer)
    .map(([k, v]) => `${k}: ${v.fps} fps (worst gap ${v.worstGapMs} ms)`).join(' · '));

  // glide smoothness with the default timer
  await test('Speed', 'Preset glide frame pacing', async () => {
    S(6);
    h.cfg.free = h.presetLayout('grid');
    h.layoutPanes();
    resetTap();
    h.tweenTo(h.presetLayout('side'), 260, true);
    await sleep(400);
    const gaps = tap.times.slice(1).map((t, i) => t - tap.times[i]);
    perf.glide = { frames: tap.count, avgGapMs: round(avg(gaps), 1), maxGapMs: round(Math.max(...gaps), 1) };
    assert(perf.glide.frames >= 12, `only ${perf.glide.frames} frames`);
    return `${perf.glide.frames} frames in 260 ms, avg ${perf.glide.avgGapMs} ms apart, worst ${perf.glide.maxGapMs} ms`;
  });

  // memory with 2 and 6 screens loaded
  const mem = async (n) => {
    S(n);
    await waitFor(() => h.cfg.panes.every((p) => loaded(p.id)), 10000);
    await sleep(800);
    return round(app.getAppMetrics().reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024, 0);
  };
  await test('Speed', 'Memory with 2 vs 6 screens', async () => {
    const two = await mem(2);
    const six = await mem(6);
    perf.memoryMB = { twoScreens: two, sixScreens: six, perExtraScreen: round((six - two) / 4, 0) };
    return `${two} MB with 2, ${six} MB with 6 (about ${perf.memoryMB.perExtraScreen} MB per screen, test pages)`;
  });

  // ================= done =================
  server.close();
  const passed = results.filter((r) => r.ok).length;
  const out = {
    when: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    monitors: displays.map((d) => ({ label: d.label, size: `${d.size.width}x${d.size.height}`, scale: d.scaleFactor })),
    totalSeconds: round((Date.now() - t0) / 1000, 1),
    passed,
    failed: results.length - passed,
    results,
    perf,
  };
  const file = process.env.SV_TEST_OUT || path.join(app.getPath('userData'), 'selftest.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name}  (${r.ms} ms)  ${r.detail}`);
  console.log(`\n${passed}/${results.length} passed in ${out.totalSeconds}s. Results: ${file}`);
  app.exit(results.length === passed ? 0 : 1);
};
