'use strict';

// The shell draws everything around the pages: the settings bar across the top, each screen's own bar and
// resize frame, the chips for screens that are off or floating, and the score ticker. The pages themselves are
// separate views that main lays out underneath these positions.

const wall = document.getElementById('wall');
const sv = window.sideview;
let S = null; // latest state from main
let suppressClick = false;

const svg = (d) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  grip: '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2.5" r="1.1"/><circle cx="6" cy="2.5" r="1.1"/><circle cx="2" cy="7" r="1.1"/><circle cx="6" cy="7" r="1.1"/><circle cx="2" cy="11.5" r="1.1"/><circle cx="6" cy="11.5" r="1.1"/></svg>',
  muted: svg('<path d="M2 6h2.5L8 3v10l-3.5-3H2z"/><path d="M11 6l3 4M14 6l-3 4"/>'),
  sound: svg('<path d="M2 6h2.5L8 3v10l-3.5-3H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.8a6 6 0 0 1 0 8.4"/>'),
  lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  unlock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>'),
  back: svg('<path d="M10 3.5L5.5 8 10 12.5"/>'),
  forward: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  check: svg('<path d="M3 8.5l3.2 3.2L13 4.8"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: svg('<path d="M2 2l12 12M6.3 4c.5-.3 1.1-.5 1.7-.5 4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M4.1 5.6C2.6 6.8 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7"/>'),
  monitor: svg('<rect x="1.5" y="3" width="13" height="8.5" rx="1"/><path d="M6 14h4M8 11.5V14"/>'),
  fit: svg('<path d="M2 5.5V2.5h3M11 2.5h3v3M14 10.5v3h-3M5 13.5H2v-3"/><rect x="5" y="5" width="6" height="6" rx="0.5"/>'),
  fill: svg('<rect x="2" y="2.5" width="12" height="11" rx="1" fill="currentColor" fill-opacity="0.35"/><path d="M5 6l-2-2M11 6l2-2M5 10l-2 2M11 10l2 2"/>'),
  fillBottom: svg('<rect x="2" y="2.5" width="12" height="11" rx="1" fill="currentColor" fill-opacity="0.35"/><path d="M3 11h10" stroke-width="2.2"/><path d="M8 4.5v4M6 6.5l2 2 2-2"/>'),
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
  reload: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.5v3h-3"/>'),
  pip: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><rect x="8" y="8" width="5" height="4" rx="0.6" fill="currentColor" stroke="none"/>'),
  // favorites: two crossed bones
  bones: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="4.5" cy="2.6" r="1.55"/><circle cx="2.6" cy="4.5" r="1.55"/><circle cx="13.4" cy="11.5" r="1.55"/><circle cx="11.5" cy="13.4" r="1.55"/><circle cx="11.5" cy="2.6" r="1.55"/><circle cx="13.4" cy="4.5" r="1.55"/><circle cx="2.6" cy="11.5" r="1.55"/><circle cx="4.5" cy="13.4" r="1.55"/></svg>',
  taskbar: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 11h13M4 12.3h2"/>'),
  dock: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><rect x="8.5" y="2.5" width="6" height="11" rx="0.5" fill="currentColor" fill-opacity="0.45" stroke="none"/><path d="M8.5 2.5v11"/>'),
  pin: svg('<path d="M9.5 2l4.5 4.5-2 1-2.5 2.5-.5 3L6 10l-3.5 3.5M6 10L3 7l3-.5L8.5 4l1-2"/>'),
  boxes: svg('<rect x="2" y="2.5" width="5" height="4.5" rx="0.8"/><rect x="9" y="2.5" width="5" height="4.5" rx="0.8"/><rect x="2" y="9" width="12" height="4.5" rx="0.8"/>'),
  glass: svg('<path d="M8 1.8l1.4 3.6 3.8.3-2.9 2.4.9 3.7L8 9.8l-3.2 2 .9-3.7-2.9-2.4 3.8-.3z"/>'),
  scores: svg('<rect x="1.5" y="4" width="13" height="8" rx="1"/><path d="M8 4v8M4 7v2M12 7v2"/>'),
  up: svg('<path d="M4 10l4-4 4 4"/>'),
  down: svg('<path d="M4 6l4 4 4-4"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  caret: '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><path d="M1 2.5h6L4 6z"/></svg>',
};

// the video button steps through: whole site -> video fit -> video fill -> video fill keeping the bottom -> whole site
const NEXT_FIT = { off: 'fit', fit: 'fill', fill: 'bottom', bottom: 'off' };

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function firstUrl(dt) {
  const list = dt.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  return (list || dt.getData('text/plain') || '').trim();
}

function el(tag, className, props = {}) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  Object.assign(n, props);
  return n;
}

function button(className, icon, title, onClick) {
  const b = el('button', className, { type: 'button', innerHTML: icon || '' });
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  b.addEventListener('click', (e) => { if (!suppressClick) onClick(e); });
  return b;
}

// Drag with the pointer: onMove gets the distance moved. Nothing starts until the pointer has moved a few px,
// so a plain click stays a click.
function trackDrag(target, e, { onStart, onMove, onEnd }) {
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;
  const move = (ev) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      active = true;
      target.setPointerCapture(e.pointerId);
      if (onStart) onStart();
    }
    if (onMove) onMove(ev.clientX - sx, ev.clientY - sy);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    if (active) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (onEnd) onEnd();
    }
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

// ================= settings bar =================

const bar = el('div', 'topbar');
const tab = button('toptab', ICON.down, 'Show the settings bar (Ctrl+Alt+F)', () => sv.setFlag('topBar', true));
wall.append(bar, tab);

const brand = el('div', 'brand');
brand.innerHTML = `${ICON.grip}<span>Side View</span>`;
brand.title = 'Drag the bar to move Side View to another monitor';

const winsw = el('div', 'seg winsw');
winsw.setAttribute('role', 'group');
winsw.setAttribute('aria-label', 'Window');
const winBtns = [0, 1, 2].map((k) => {
  const b = button('seg-btn', '', `Window ${k + 1} (Ctrl+Alt+${k + 1})`, () => sv.setWindow(k));
  b.textContent = String(k + 1);
  winsw.append(b);
  return b;
});

const monBtn = button('pill mon', '', 'Pick a monitor, or drag the bar onto one (Ctrl+Alt+D)', () => sv.monitorMenu());

const presets = el('div', 'seg presets');
presets.setAttribute('role', 'group');
presets.setAttribute('aria-label', 'Arrange screens');
const presetBtns = [
  ['side', 'Side', 'Main screen big on the left, the rest beside it'],
  ['center', 'Center', 'Small screens across the top, main big in the middle, a wide one along the bottom'],
  ['grid', 'Grid', 'Every screen the same size'],
  ['row', 'Row', 'Every screen side by side, equal widths: 2 halves, 3 thirds'],
].map(([style, label, tip]) => {
  const b = button('seg-btn', '', tip, () => sv.arrange(style));
  b.textContent = label;
  b.dataset.tip = tip;
  presets.append(b);
  return [style, b];
});

const counter = el('div', 'seg counter');
const minusBtn = button('seg-btn', '', 'One screen fewer', () => sv.setCount(S.paneCount - 1));
minusBtn.textContent = '−';
const countLabel = el('span', 'count');
const plusBtn = button('seg-btn', '', 'One more screen (Ctrl+Alt+N)', () => sv.setCount(S.paneCount + 1));
plusBtn.textContent = '+';
counter.append(minusBtn, countLabel, plusBtn);

const favs = el('div', 'favs');
let favKey = '';

const toggles = [
  ['freeLocked', ICON.lock, 'Lock every screen in place', 'Unlock: screens can move again'],
  ['dockOn', ICON.dock, 'Lock Side View to part of the screen; other apps use the rest (Ctrl+Alt+K)', 'Use the whole screen again (Ctrl+Alt+K)'],
  ['coverTaskbar', ICON.taskbar, 'Cover the taskbar too (Ctrl+Alt+T)', 'Leave room for the taskbar (Ctrl+Alt+T)'],
  ['onTop', ICON.pin, 'Keep Side View above other windows', 'Let other windows go on top of Side View'],
  ['boxes', ICON.boxes, 'Show the bars around each screen (Ctrl+Alt+B)', 'Hide the bars so the screens read as one picture (Ctrl+Alt+B)'],
  ['glass', ICON.glass, 'Glass look', 'Plain look'],
  ['ticker', ICON.scores, 'Show scores along the bottom', 'Hide the scores'],
].map(([key, icon, offTip, onTip]) => {
  const b = button('ibtn', icon, offTip, () => sv.setFlag(key, !S[key]));
  b.dataset.key = key;
  b.dataset.offTip = offTip;
  b.dataset.onTip = onTip;
  return b;
});
const tools = el('div', 'tools');
tools.append(
  ...toggles,
  el('span', 'sep'),
  button('ibtn', ICON.muted, 'Mute every screen (Ctrl+Alt+M)', () => sv.muteAll()),
  button('ibtn', ICON.gear, 'Control panel: every setting in one place (Ctrl+Alt+P)', () => sv.openSettings()),
  el('span', 'sep'),
  button('ibtn', ICON.up, 'Hide this bar (Ctrl+Alt+F)', () => sv.setFlag('topBar', false)),
  button('ibtn', ICON.minus, 'Hide Side View (Ctrl+Alt+S brings it back)', () => sv.hide()),
  button('ibtn quit', ICON.x, 'Quit Side View', () => sv.quit()),
);

bar.append(brand, winsw, monBtn, presets, counter, favs, tools);

// Drag the bar (anywhere that isn't a button) to carry the whole wall to another monitor.
bar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  trackDrag(bar, e, {
    onStart: () => { bar.classList.add('carrying'); sv.dragWall(true); },
    onEnd: () => { bar.classList.remove('carrying'); sv.dragWall(false); },
  });
});

function renderFavorites() {
  const key = JSON.stringify(S.favorites.map((f) => [f.url, f.title, f.icon.length]));
  if (key === favKey) return;
  favKey = key;
  favs.textContent = '';
  if (!S.favorites.length) {
    const hint = el('span', 'fav-hint');
    hint.innerHTML = `${ICON.bones}<span>Click the bones on a screen to save its site here</span>`;
    favs.append(hint);
    return;
  }
  S.favorites.forEach((f, k) => {
    const b = el('button', 'fav', { type: 'button', draggable: true });
    b.title = `${f.title || hostOf(f.url)}\n${f.url}\nClick: open in the selected screen. Drag onto any screen. Right-click for more.`;
    if (f.icon) {
      const img = el('img', '', { src: f.icon, alt: '' });
      img.addEventListener('error', () => { img.replaceWith(el('span', 'fav-ico', { innerHTML: ICON.bones })); });
      b.append(img);
    } else {
      b.append(el('span', 'fav-ico', { innerHTML: ICON.bones }));
    }
    b.append(el('span', 'fav-name', { textContent: f.title || hostOf(f.url) }));
    b.addEventListener('click', () => sv.openFavorite(k));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); sv.favoriteMenu(k); });
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/uri-list', f.url);
      e.dataTransfer.setData('text/plain', f.url);
    });
    favs.append(b);
  });
}

function renderBar() {
  bar.hidden = !S.topBar;
  tab.hidden = S.topBar;
  bar.style.height = `${S.toolbarH}px`;
  tab.style.height = `${S.tabH}px`;
  winBtns.forEach((b, k) => { b.classList.toggle('on', k === S.activeWindow); b.setAttribute('aria-pressed', String(k === S.activeWindow)); });
  const cur = S.displays.find((d) => d.current) || S.displays[0];
  monBtn.innerHTML = `${ICON.monitor}<span>${cur ? `${cur.index}: ${cur.name}` : 'Monitor'}</span>${ICON.caret}`;
  const presetsOff = S.freeLocked || S.anyLocked;
  for (const [style, b] of presetBtns) {
    b.classList.toggle('on', style === S.arrangeStyle);
    b.disabled = presetsOff;
    b.title = presetsOff ? 'Unlock every screen to use a preset' : b.dataset.tip;
  }
  countLabel.innerHTML = `<b>${S.paneCount}</b><span class="word">&nbsp;screens</span>`;
  minusBtn.disabled = S.paneCount <= S.minPanes;
  plusBtn.disabled = S.paneCount >= S.maxPanes;
  for (const b of toggles) {
    const on = Boolean(S[b.dataset.key]);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? b.dataset.onTip : b.dataset.offTip;
    b.setAttribute('aria-label', b.title);
  }
  renderFavorites();
}

// ================= chips and ticker along the bottom =================

const chips = el('div', 'chips');
wall.append(chips);
let chipsKey = '';
function renderChips() {
  const off = S.panes.filter((p) => p.hidden || p.pip);
  chips.hidden = off.length === 0;
  chips.style.height = `${S.hiddenH}px`;
  chips.style.bottom = S.ticker ? `${S.tickerH}px` : '0';
  const key = JSON.stringify(off.map((p) => [p.id, p.label, p.pip]));
  if (key === chipsKey) return;
  chipsKey = key;
  chips.textContent = '';
  for (const p of off) {
    const chip = button(`chip${p.pip ? ' pip' : ''}`, p.pip ? ICON.pip : ICON.eyeOff,
      p.pip ? `Bring ${p.label} back from picture-in-picture` : `Turn ${p.label} back on`,
      () => (p.pip ? sv.pipBack(p.id) : sv.hidePane(p.id, false)));
    chip.append(p.pip ? ` ${p.label} (floating)` : ` ${p.label}`);
    chips.append(chip);
  }
}

const ticker = el('div', 'ticker');
const tickerTrack = el('div', 'ticker-track');
ticker.append(tickerTrack);
wall.append(ticker);
let tickerKey = '';
sv.onTicker((games) => {
  const key = JSON.stringify(games);
  if (key === tickerKey) return;
  tickerKey = key;
  tickerTrack.textContent = '';
  tickerTrack.classList.remove('scroll');
  if (!games.length) {
    tickerTrack.append(el('span', 'game', { textContent: 'No games today' }));
    return;
  }
  // two copies back to back so the loop has no gap
  for (let copy = 0; copy < 2; copy++) {
    for (const g of games) {
      const item = el('span', `game${g.live ? ' live' : ''}`);
      item.append(el('b', '', { textContent: g.text }));
      if (g.status) item.append(el('i', '', { textContent: g.status }));
      tickerTrack.append(item);
    }
  }
  tickerTrack.style.animationDuration = `${Math.max(20, games.length * 6)}s`;
  tickerTrack.classList.add('scroll');
});

// ================= each screen's bar and frame =================

const screens = new Map(); // pane id -> parts
const rects = new Map(); // pane id -> { left, top, width, height } as last laid out

// Which edges of a screen's frame the pointer is on: a mix of 's', 'w', 'e' ('' for none).
function edgesAt(r, x, y) {
  const reach = 14; // corners are easier to grab than the thin strips suggest
  const bottom = y > r.top + r.height - S.frameH;
  const left = x < r.left + S.frameW;
  const right = x > r.left + r.width - S.frameW;
  const nearBottom = y > r.top + r.height - reach;
  return (bottom || (nearBottom && (left || right)) ? 's' : '')
    + (left || (bottom && x < r.left + reach) ? 'w' : '')
    + (right || (bottom && x > r.left + r.width - reach) ? 'e' : '');
}
const EDGE_CURSOR = { s: 'ns-resize', w: 'ew-resize', e: 'ew-resize', sw: 'nesw-resize', se: 'nwse-resize' };

// Place a screen's bar and frame (transforms, so moving them is cheap).
function placeParts(h, r) {
  h.el.style.transform = `translate(${r.left}px, ${r.top}px)`;
  h.el.style.width = `${r.width}px`;
  h.frame.style.transform = `translate(${r.left}px, ${r.top}px)`;
  h.frame.style.width = `${r.width}px`;
  h.frame.style.height = `${r.height}px`;
  // the gliding photo sits exactly where the live page does
  const header = S.boxes ? S.headerH : 0;
  const side = S.boxes ? S.frameW : 0;
  const bottom = S.boxes ? S.frameH : 0;
  h.still.style.transform = `translate(${r.left + side}px, ${r.top + header}px)`;
  h.still.style.width = `${Math.max(0, r.width - 2 * side)}px`;
  h.still.style.height = `${Math.max(0, r.height - header - bottom)}px`;
}

// Photos of screens that are about to glide (see tweenTo in main). Main hides those live pages once we've painted
// the photos, glides them, then clears them shortly after the live pages are back.
let stills = {};
sv.onStills((shots) => {
  stills = shots || {};
  for (const [id, h] of screens) {
    const src = stills[id];
    h.still.hidden = !src;
    if (src) h.still.src = src;
    else h.still.removeAttribute('src');
  }
  if (Object.keys(stills).length) requestAnimationFrame(() => requestAnimationFrame(() => sv.stillsShown()));
});

const canMove = (id) => S && !S.freeLocked && !screens.get(id)?.locked;

function build(id) {
  const h = { id, locked: false, fit: 'off', muted: true, url: '' };

  // the frame sits behind the page; only its left, right and bottom edges show, and those resize the screen
  h.frame = el('div', 'frame');
  h.frame.addEventListener('pointermove', (e) => {
    const r0 = rects.get(id);
    if (r0 && !e.buttons) h.frame.style.cursor = canMove(id) ? EDGE_CURSOR[edgesAt(r0, e.clientX, e.clientY)] || 'default' : 'default';
  });
  h.frame.addEventListener('pointerdown', (e) => {
    const r0 = rects.get(id);
    if (!canMove(id) || e.button !== 0 || !r0) return;
    const edges = edgesAt(r0, e.clientX, e.clientY);
    if (!edges) return;
    sv.focus(id);
    // main follows the pointer from here (the pointer may cross other pages, which hide it from this page)
    trackDrag(h.frame, e, { onStart: () => sv.dragStart(id, 'resize', edges), onEnd: () => sv.drop(id) });
  });

  h.el = el('div', 'hdr');
  const grip = el('span', 'grip', { innerHTML: ICON.grip });
  h.back = button('btn back', ICON.back, 'Back', () => sv.back(id));
  h.forward = button('btn forward', ICON.forward, 'Forward', () => sv.forward(id));
  h.addr = button('addr', '', '', () => startEdit());
  h.input = el('input', 'addr-input', { type: 'text', spellcheck: false, hidden: true });
  h.input.setAttribute('aria-label', 'Address');
  h.dot = el('span', 'dot', { hidden: true, title: 'Playing sound (muted)' });
  h.mute = button('btn mute', '', '', () => sv.setMuted(id, !h.muted));
  h.reload = button('btn reload', ICON.reload, 'Reload', () => sv.reload(id));
  // off -> whole video fills the box -> video fills edge to edge (crops) -> off
  h.fitBtn = button('btn fit', ICON.fit, '', () => sv.setFit(id, NEXT_FIT[h.fit] || 'off'));
  h.fav = button('btn fav', ICON.bones, '', () => sv.toggleFavorite(id));
  h.pip = button('btn pipb', ICON.pip, 'Picture-in-picture: float this screen in its own small window', () => sv.popOut(id));
  h.lock = button('btn plock', '', '', () => sv.lockPane(id, !h.locked));
  h.eye = button('btn eye', ICON.eye, 'Turn this screen off', () => sv.hidePane(id, true));
  h.el.append(grip, h.back, h.forward, h.addr, h.input, h.dot, h.mute, h.reload, h.fitBtn, h.fav, h.pip, h.lock, h.eye);

  // red bar under the header when a popup was blocked
  h.block = el('div', 'blockbar', { hidden: true });
  h.blockText = el('span', 'block-text');
  h.block.append(
    h.blockText,
    button('block-btn allow', ICON.check, 'Open the blocked link in this screen', () => sv.allowPopup(id)),
    button('block-btn dismiss', ICON.x, 'Dismiss', () => sv.dismissPopup(id)),
  );

  h.still = el('img', 'still', { alt: '', hidden: true, draggable: false });
  wall.append(h.frame, h.still, h.el, h.block);

  const startEdit = () => {
    h.input.value = h.url || '';
    h.addr.hidden = true;
    h.input.hidden = false;
    h.input.focus();
    h.input.select();
  };
  const endEdit = () => { h.input.hidden = true; h.addr.hidden = false; };
  h.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = h.input.value; endEdit(); sv.navigate(id, v); }
    else if (e.key === 'Escape') endEdit();
  });
  h.input.addEventListener('blur', endEdit);

  // click a bar to pick that screen (favorites open there); drag it to move the screen. Let go with its middle
  // over another screen and the two swap places.
  h.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.btn, .addr-input')) return;
    sv.focus(id);
    const r0 = rects.get(id);
    if (!canMove(id) || !r0) return;
    trackDrag(h.el, e, { onStart: () => sv.dragStart(id, 'move'), onEnd: () => sv.drop(id) });
  });

  // drop a link or a favorite on a bar to load it there
  h.el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; h.el.classList.add('drop-target'); });
  h.el.addEventListener('dragleave', () => h.el.classList.remove('drop-target'));
  h.el.addEventListener('drop', (e) => {
    e.preventDefault();
    h.el.classList.remove('drop-target');
    const link = firstUrl(e.dataTransfer);
    if (link) sv.navigate(id, link);
  });

  screens.set(id, h);
  return h;
}

function renderScreen(p, inPlace) {
  const h = screens.get(p.id) || build(p.id);
  const away = p.hidden || p.pip; // turned off, or floating in its own window
  Object.assign(h, { url: p.url, muted: p.muted, locked: p.locked, fit: p.fit });
  const r = { left: p.left, top: p.top, width: p.width, height: p.height };
  rects.set(p.id, r);
  placeParts(h, r);
  h.el.classList.toggle('moving', p.id === S.draggingId);
  h.el.style.height = `${S.headerH}px`;

  h.el.hidden = away || !S.boxes;
  h.frame.hidden = away || !S.boxes;
  h.el.classList.toggle('narrow', p.width < 300);
  h.el.classList.toggle('live', !p.muted);
  h.el.classList.toggle('pinned', p.locked);
  h.el.classList.toggle('focused', p.id === S.focusedId);
  h.el.classList.toggle('swap-target', p.id === S.swapTarget);
  h.el.classList.toggle('fixed', !canMove(p.id));
  h.frame.classList.toggle('fixed', !canMove(p.id));

  h.back.disabled = !p.canBack;
  h.forward.disabled = !p.canForward;
  h.addr.textContent = p.url ? hostOf(p.url) : 'Add a link';
  h.addr.classList.toggle('empty', !p.url);
  h.addr.title = p.url ? `${p.title || hostOf(p.url)}\n${p.url}\nClick to change the link` : 'Type or paste a link';

  h.dot.hidden = !(p.audible && p.muted);
  h.mute.innerHTML = p.muted ? ICON.muted : ICON.sound;
  h.mute.title = p.muted ? 'Unmute' : 'Mute';
  h.mute.setAttribute('aria-label', h.mute.title);
  h.mute.setAttribute('aria-pressed', String(!p.muted));

  h.fitBtn.innerHTML = p.fit === 'bottom' ? ICON.fillBottom : p.fit === 'fill' ? ICON.fill : ICON.fit;
  h.fitBtn.classList.toggle('on', p.fit !== 'off');
  h.fitBtn.title = {
    off: 'Show only the video, as big as it fits',
    fit: 'Video only. Click to fill edge to edge (crops the edges)',
    fill: 'Video fills the screen. Click to fill but keep the bottom (scores stay in view)',
    bottom: 'Video fills the screen, bottom kept. Click to show the whole site again',
  }[p.fit];
  h.fitBtn.setAttribute('aria-label', h.fitBtn.title);

  h.fav.classList.toggle('on', p.favorite);
  h.fav.disabled = !p.url;
  h.fav.title = !p.url ? 'Load a site to save it as a favorite' : p.favorite ? 'Saved. Click to remove from favorites' : 'Save this site to your favorites';
  h.fav.setAttribute('aria-label', h.fav.title);
  h.fav.setAttribute('aria-pressed', String(p.favorite));

  h.pip.hidden = inPlace <= 1;
  h.eye.hidden = inPlace <= 1;

  h.lock.innerHTML = p.locked ? ICON.lock : ICON.unlock;
  h.lock.classList.toggle('on', p.locked);
  h.lock.title = p.locked ? 'Locked in place. Click to unlock' : 'Lock this screen in place';
  h.lock.setAttribute('aria-label', h.lock.title);
  h.lock.setAttribute('aria-pressed', String(p.locked));

  h.block.hidden = !p.blocked || away;
  h.block.style.transform = `translate(${p.left}px, ${p.top + (S.boxes ? S.headerH : 0)}px)`;
  h.block.style.width = `${p.width}px`;
  h.block.style.height = `${S.blockH}px`;
  h.blockText.textContent = p.blocked ? `Blocked popup: ${hostOf(p.blocked)}` : '';
  h.blockText.title = p.blocked;
}

function render(state) {
  // favorites only come along when they change; keep the list we already have
  if (!state.favorites) state.favorites = S ? S.favorites : [];
  S = state;
  document.body.classList.toggle('glass', S.glass);
  wall.classList.toggle('no-boxes', !S.boxes);
  wall.classList.toggle('busy', Boolean(S.draggingId));
  renderBar();
  renderChips();
  ticker.hidden = !S.ticker;
  ticker.style.height = `${S.tickerH}px`;
  const inPlace = S.panes.filter((q) => !q.hidden && !q.pip).length;
  const live = new Set();
  for (const p of S.panes) { live.add(p.id); renderScreen(p, inPlace); }
  for (const [id, h] of screens) {
    if (!live.has(id)) { h.el.remove(); h.frame.remove(); h.still.remove(); h.block.remove(); rects.delete(id); screens.delete(id); }
  }
}

sv.onState(render);
sv.ready();
