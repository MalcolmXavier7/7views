'use strict';

// The control panel: every 7 Views setting on one page. Main pushes fresh state whenever anything changes
// (from here, the settings bar, the tray or a shortcut), so the page always shows what's really happening.

const $ = (id) => document.getElementById(id);
const api = window.settings;
let S = null;          // latest state
let logins = [];       // saved logins (only fetched when needed)

const STYLE_LABEL = { row: 'Row', side: 'Side', middle: 'Middle', center: 'Center', grid: 'Grid' };
const FIT_LABEL = { off: 'Whole site', fit: 'Video only', fill: 'Video, fill', bottom: 'Video, fill, keep bottom' };
const SWITCHES = [
  ['topBar', 'Settings bar', 'The bar across the top of 7 Views'],
  ['boxes', 'Bars around screens', 'Off: the screens butt up into one picture'],
  ['glass', 'Glass look', 'Frosted bars and rounded corners'],
  ['onTop', 'Keep on top', 'Stay above other windows'],
  ['coverTaskbar', 'Cover the taskbar', 'Use the whole monitor'],
  ['freeLocked', 'Lock every screen', 'Nothing can be moved or resized'],
];

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const pct = (z) => `${Math.round(z * 100)}%`;
const editing = (el) => document.activeElement === el; // never overwrite a field you're typing in

function el(tag, className, props = {}) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  Object.assign(n, props);
  return n;
}

function btn(label, className, onClick, title) {
  const b = el('button', className, { type: 'button', textContent: label });
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.textContent = '';
    for (const [v, label] of options) select.add(new Option(label, String(v)));
  }
  if (!editing(select)) select.value = String(value);
}

function segmented(container, items, current, onPick, disabled = false) {
  const key = JSON.stringify(items);
  if (container.dataset.key !== key) {
    container.dataset.key = key;
    container.textContent = '';
    for (const [v, label] of items) {
      const b = btn(label, 'seg-btn', () => onPick(v));
      b.dataset.v = String(v);
      container.append(b);
    }
  }
  for (const b of container.children) {
    const on = b.dataset.v === String(current);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = disabled;
  }
}

// ---------------- header ----------------

const fmtMB = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

function renderTop() {
  const r = S.resources || {};
  $('meter').textContent = r.totalMB ? `${fmtMB(r.totalMB)} · ${r.cpuPct}% CPU · ${r.processes} processes` : '';
  $('meter').classList.toggle('heavy', (r.totalMB || 0) > 6144);
  const cur = S.displays.find((d) => d.current);
  $('status').textContent = S.visible
    ? `Showing on ${cur ? `${cur.index}: ${cur.name}` : 'a monitor'} · Window ${S.activeWindow + 1} · ${S.paneCount} screens`
    : 'Hidden. Ctrl+Alt+S or Show brings it back.';
  $('showhide').textContent = S.visible ? 'Hide 7 Views' : 'Show 7 Views';
  $('showhide').classList.toggle('primary', !S.visible);
}
$('showhide').addEventListener('click', () => api.act(S.visible ? 'hide' : 'show'));
$('quit').addEventListener('click', () => { if (confirm('Quit 7 Views?')) api.act('quit'); });

// ---------------- monitors ----------------

function renderMonitors() {
  const list = $('monitor-list');
  const key = JSON.stringify(S.displays);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.textContent = '';
  for (const d of S.displays) {
    const card = el('button', `monitor${d.current ? ' on' : ''}`, { type: 'button' });
    card.setAttribute('aria-pressed', String(d.current));
    card.title = d.current ? '7 Views is here' : `Move 7 Views to ${d.name}`;
    card.innerHTML = '<svg width="34" height="26" viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="1.5" y="1.5" width="31" height="18" rx="2.5"/><path d="M12 24.5h10M17 19.5v5"/></svg>';
    const text = el('span', 'mon-text');
    text.append(el('b', '', { textContent: `${d.index}: ${d.name}` }), el('small', '', { textContent: `${d.size}${d.primary ? ' · main display' : ''}` }));
    card.append(text);
    if (d.current) card.append(el('span', 'badge', { textContent: 'Here' }));
    card.addEventListener('click', () => { if (!d.current) api.act('display', d.id); });
    list.append(card);
  }
}

// ---------------- layout ----------------

function renderLayout() {
  segmented($('windows'), Array.from({ length: S.windowCount }, (_, k) => [k, `${k + 1}`]), S.activeWindow, (k) => api.act('window', k));
  const locked = S.flags.freeLocked || S.anyLocked;
  segmented($('presets'), S.styles.map((s) => [s, STYLE_LABEL[s] || s]), S.arrangeStyle, (s) => api.act('arrange', s));
  $('presets-note').hidden = !locked;
  $('count').textContent = `${S.paneCount}`;
  $('fewer').disabled = S.paneCount <= S.minPanes;
  $('more').disabled = S.paneCount >= S.maxPanes;
  $('dock-on').checked = S.flags.dockOn;
  segmented($('dock-edge'), S.dockEdges.map((e) => [e, e[0].toUpperCase() + e.slice(1)]), S.dockEdge, (e) => api.act('dock', e));
  const sizes = [0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75];
  if (!sizes.some((z) => Math.abs(z - S.dockSize) < 0.005)) sizes.push(S.dockSize);
  fillSelect($('dock-size'), sizes.sort((a, b) => a - b).map((z) => [z, `${Math.round(z * 100)}% of the screen`]), sizes.find((z) => Math.abs(z - S.dockSize) < 0.005));
}
$('dock-on').addEventListener('change', (e) => api.act('flag', 'dockOn', e.target.checked));
$('dock-size').addEventListener('change', (e) => api.act('dock', null, Number(e.target.value)));
$('fewer').addEventListener('click', () => api.act('count', S.paneCount - 1));
$('more').addEventListener('click', () => api.act('count', S.paneCount + 1));

// ---------------- screens ----------------

const rows = new Map(); // pane id -> row parts

function buildRow(id) {
  const r = { id };
  r.tr = el('tr');
  r.name = el('button', 'screen-name', { type: 'button' });
  r.name.title = 'Select this screen (favorites open here)';
  r.name.addEventListener('click', () => api.act('focus', id));

  r.form = el('form', 'site');
  r.url = el('input', '', { type: 'text', spellcheck: false });
  r.url.setAttribute('aria-label', 'Site');
  r.url.placeholder = 'Type or paste a link';
  r.go = el('button', 'btn small', { type: 'submit', textContent: 'Go' });
  r.form.append(r.url, r.go);
  r.form.addEventListener('submit', (e) => { e.preventDefault(); api.act('navigate', id, r.url.value); r.url.blur(); });
  r.url.addEventListener('keydown', (e) => { if (e.key === 'Escape') { r.url.value = r.p.url; r.url.blur(); } });

  r.on = el('input', '', { type: 'checkbox' });
  r.on.setAttribute('role', 'switch');
  r.on.addEventListener('change', () => api.act('hidden', id, !r.on.checked));

  r.sound = btn('', 'chip-btn', () => api.act('mute', id, !r.p.muted));

  r.fit = el('select');
  r.fit.setAttribute('aria-label', 'Video');
  r.fit.addEventListener('change', () => api.act('fit', id, r.fit.value));

  r.zoom = el('select');
  r.zoom.setAttribute('aria-label', 'Page zoom');
  r.zoom.addEventListener('change', () => api.act('paneZoom', id, Number(r.zoom.value)));

  r.lock = el('input', '', { type: 'checkbox' });
  r.lock.setAttribute('role', 'switch');
  r.lock.addEventListener('change', () => api.act('lock', id, r.lock.checked));

  r.pip = el('input', '', { type: 'checkbox' });
  r.pip.setAttribute('role', 'switch');
  r.pip.addEventListener('change', () => api.act('pip', id, r.pip.checked));

  r.reload = btn('Reload', 'btn small', () => api.act('reload', id));
  r.mem = el('span', 'mem');
  r.memBar = el('span', 'mem-bar');
  r.memText = el('span', 'mem-text');
  r.mem.append(r.memBar, r.memText);

  const cell = (...kids) => { const td = el('td'); td.append(...kids); return td; };
  r.tr.append(cell(r.name), cell(r.form), cell(r.on), cell(r.sound), cell(r.fit), cell(r.zoom), cell(r.mem), cell(r.lock), cell(r.pip), cell(r.reload));
  $('screen-rows').append(r.tr);
  rows.set(id, r);
  return r;
}

function renderScreens() {
  const zoomOpts = [...new Set([...S.zoomPresets, 0.25, 0.9, 1, 1.25, 1.5])].filter((z) => z >= S.zoomMin && z <= S.zoomMax).sort((a, b) => a - b);
  const live = new Set();
  for (const p of S.panes) {
    live.add(p.id);
    const r = rows.get(p.id) || buildRow(p.id);
    r.p = p;
    $('screen-rows').append(r.tr); // keeps rows in screen order
    r.tr.classList.toggle('selected', p.id === S.focusedId);
    r.tr.classList.toggle('off', p.hidden);
    r.name.innerHTML = '';
    r.name.append(el('b', '', { textContent: `Screen ${p.n}` }));
    if (p.main) r.name.append(el('small', '', { textContent: 'Main' }));
    if (p.pip) r.name.append(el('small', 'float', { textContent: 'Floating' }));
    if (!editing(r.url)) r.url.value = p.url;
    r.url.title = p.title ? `${p.title}\n${p.url}` : p.url;
    r.on.checked = !p.hidden;
    r.on.disabled = !p.hidden && S.panes.filter((q) => q.inPlace).length <= 1 && p.inPlace;
    r.on.title = p.hidden ? 'Turn this screen on' : 'Turn this screen off';
    r.sound.textContent = p.muted ? (p.audible ? 'Muted ●' : 'Muted') : 'Sound on';
    r.sound.classList.toggle('on', !p.muted);
    r.sound.title = p.muted ? 'Play this screen\'s sound (mutes the others)' : 'Mute this screen';
    fillSelect(r.fit, Object.entries(FIT_LABEL), p.fit);
    fillSelect(r.zoom, [...new Set([...zoomOpts, p.zoom])].sort((a, b) => a - b).map((z) => [z, pct(z)]), p.zoom);
    r.lock.checked = p.locked;
    r.lock.title = p.locked ? 'Locked in place' : 'Lock this screen in place';
    r.pip.checked = p.pip;
    r.pip.disabled = p.hidden || (!p.pip && S.panes.filter((q) => q.inPlace).length <= 1);
    r.pip.title = 'Picture-in-picture: float this screen in its own small window';
    r.reload.disabled = !p.url;
    const top = Math.max(1, ...S.panes.map((q) => q.memoryMB || 0));
    r.memText.textContent = p.memoryMB ? fmtMB(p.memoryMB) : '–';
    r.memBar.style.width = `${Math.round(((p.memoryMB || 0) / top) * 100)}%`;
    r.mem.title = p.memoryMB ? `This screen's page and the ad, player and other frames it loads: ${fmtMB(p.memoryMB)}` : 'Not loaded';
  }
  for (const [id, r] of rows) if (!live.has(id)) { r.tr.remove(); rows.delete(id); }
}

// ---------------- sound ----------------

function renderSound() {
  const playing = S.panes.find((p) => !p.muted);
  const opts = [['', 'No screen (all muted)'], ...S.panes.filter((p) => !p.hidden).map((p) => [p.id, `Screen ${p.n}${p.url ? `: ${hostOf(p.url)}` : ''}`])];
  fillSelect($('sound-from'), opts, playing ? playing.id : '');
  const list = $('playing');
  list.textContent = '';
  const audible = S.panes.filter((p) => p.audible);
  if (!audible.length) list.append(el('li', 'empty', { textContent: 'Nothing is playing right now.' }));
  for (const p of audible) {
    const li = el('li', p.muted ? '' : 'live');
    li.append(el('span', 'dot'), el('span', '', { textContent: `Screen ${p.n} is playing${p.muted ? ' (muted)' : ''}` }));
    list.append(li);
  }
}
$('sound-from').addEventListener('change', (e) => {
  const id = e.target.value;
  if (id) api.act('mute', id, false);
  else api.act('muteAll');
});
$('mute-all').addEventListener('click', () => api.act('muteAll'));

// ---------------- look & behavior ----------------

function renderSwitches() {
  const box = $('switches');
  if (!box.children.length) {
    for (const [key, label, note] of SWITCHES) {
      const row = el('label', 'switch-row');
      const text = el('span');
      text.append(el('span', '', { textContent: label }), el('small', '', { textContent: note }));
      const input = el('input', '', { type: 'checkbox' });
      input.setAttribute('role', 'switch');
      input.dataset.key = key;
      input.addEventListener('change', () => api.act('flag', key, input.checked));
      row.append(text, input);
      box.append(row);
    }
  }
  for (const input of box.querySelectorAll('input')) input.checked = Boolean(S.flags[input.dataset.key]);
}

// ---------------- scores ----------------

function renderScores() {
  $('ticker').checked = S.flags.ticker;
  fillSelect($('league'), S.leagues.map(([name, id]) => [id, name]), S.league);
}
$('ticker').addEventListener('change', (e) => api.act('flag', 'ticker', e.target.checked));
$('league').addEventListener('change', (e) => api.act('league', e.target.value));

// ---------------- favorites ----------------

const BONES = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="4.5" cy="2.6" r="1.55"/><circle cx="2.6" cy="4.5" r="1.55"/><circle cx="13.4" cy="11.5" r="1.55"/><circle cx="11.5" cy="13.4" r="1.55"/><circle cx="11.5" cy="2.6" r="1.55"/><circle cx="13.4" cy="4.5" r="1.55"/><circle cx="2.6" cy="11.5" r="1.55"/><circle cx="4.5" cy="13.4" r="1.55"/></svg>';

function renderFavorites() {
  const list = $('fav-list');
  const screens = S.panes.filter((p) => p.inPlace || p.pip);
  const key = JSON.stringify([S.favorites.map((f) => [f.url, f.title, f.icon.length]), screens.map((p) => p.id), S.focusedId]);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.textContent = '';
  if (!S.favorites.length) {
    const li = el('li', 'empty');
    li.innerHTML = `${BONES}<span>No favorites yet. Add one above, or click the crossed bones on a screen's bar.</span>`;
    list.append(li);
    return;
  }
  S.favorites.forEach((f, k) => {
    const li = el('li', 'fav');
    const ico = f.icon ? el('img', 'fav-ico', { src: f.icon, alt: '' }) : el('span', 'fav-ico bones', { innerHTML: BONES });
    const text = el('span', 'fav-text');
    text.append(el('b', '', { textContent: f.title || hostOf(f.url) }), el('small', '', { textContent: f.url }));
    const where = el('select');
    where.setAttribute('aria-label', 'Open in');
    for (const p of screens) where.add(new Option(`Screen ${p.n}`, p.id));
    where.value = S.focusedId;
    const open = btn('Open', 'btn small primary', () => api.act('favOpen', k, where.value), 'Open in the chosen screen');
    const up = btn('↑', 'btn small icon', () => api.act('favMove', k, -1), 'Move up');
    const down = btn('↓', 'btn small icon', () => api.act('favMove', k, 1), 'Move down');
    up.disabled = k === 0;
    down.disabled = k === S.favorites.length - 1;
    const del = btn('Remove', 'btn small', () => api.act('favRemove', k));
    li.append(ico, text, where, open, up, down, del);
    list.append(li);
  });
}
$('add-fav').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('fav-url').value.trim();
  if (!v) return;
  api.act('favAdd', v);
  $('fav-url').value = '';
});

// ---------------- community ----------------

function renderCommunity() {
  if (!editing($('invite'))) $('invite').value = S.discordInvite || '';
  $('open-discord').disabled = !S.discordInvite;
  $('invite-note').textContent = S.discordInvite ? '' : 'Run the server setup (discord/README.md) and it prints the invite link to paste here.';
}
$('invite-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('invite').value.trim();
  if (v && !/^(https:\/\/)?(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,40}$/.test(v)) {
    $('invite-note').textContent = 'That doesn\'t look like a Discord invite (discord.gg/...).';
    return;
  }
  api.act('setInvite', v);
  $('invite').blur();
  $('invite-note').textContent = v ? 'Saved.' : 'Removed.';
});
$('open-discord').addEventListener('click', () => api.act('openDiscord'));
$('share-layout').addEventListener('click', async () => {
  const res = await api.ask('shareLayout');
  if (!res) return;
  $('layout-code').hidden = false;
  $('layout-code').value = res.code;
  $('layout-code').select();
  $('share-note').textContent = 'Copied. Paste it in #setups with a screenshot of your wall.';
});
$('import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api.ask('importLayout', $('import-code').value);
  if (!res) return;
  $('import-note').textContent = res.message;
  $('import-note').classList.toggle('bad', !res.ok);
  if (res.ok) $('import-code').value = '';
});

// ---------------- general ----------------

function renderGeneral() {
  $('site-zoom-note').textContent = S.siteZoomCount
    ? `${S.siteZoomCount} site${S.siteZoomCount === 1 ? ' remembers its' : 's remember their'} own zoom (set with Ctrl + scroll or a screen's Zoom). Choosing a zoom here resets them.`
    : 'Zoom a screen with Ctrl + scroll or its Zoom setting and that website keeps it, in every screen.';
  $('startup').checked = S.startup;
  $('shared').checked = S.sharedLogins;
  fillSelect($('zoom'), S.zoomPresets.map((z) => [z, pct(z)]), S.zoomPresets.includes(S.zoom) ? S.zoom : S.zoomPresets[1]);
}

async function update(key, value) {
  const st = await api.set(key, value);
  if (st) { logins = st.logins; apply(st); }
}
$('startup').addEventListener('change', (e) => update('startup', e.target.checked));
$('shared').addEventListener('change', (e) => update('sharedLogins', e.target.checked));
$('zoom').addEventListener('change', (e) => update('zoom', Number(e.target.value)));

// ---------------- logins ----------------

function renderVault() {
  $('vault-status').textContent = !S.vaultAvailable
    ? 'Encryption isn\'t available on this Windows account, so passwords can\'t be saved.'
    : logins.length ? `${logins.length} saved login${logins.length === 1 ? '' : 's'}.` : 'No saved logins yet.';
  $('import').disabled = !S.vaultAvailable;
  $('clear').disabled = !logins.length;
  renderLogins();
}

function renderLogins() {
  const q = $('filter').value.trim().toLowerCase();
  const list = $('login-list');
  list.textContent = '';
  const shown = logins.filter((l) => !q || l.host.includes(q) || l.username.toLowerCase().includes(q));
  if (!shown.length) {
    list.append(el('li', 'empty', { textContent: logins.length ? 'No matches.' : 'Imported logins show up here.' }));
    return;
  }
  for (const l of shown.slice(0, 500)) {
    const li = el('li');
    const del = btn('Remove', 'btn small', async () => { const st = await api.removeLogin(l.id); if (st) { logins = st.logins; apply(st); } });
    del.setAttribute('aria-label', `Remove login for ${l.host}`);
    li.append(el('span', 'host', { textContent: l.host }), el('span', 'user', { textContent: l.username || '(no username)' }), del);
    list.append(li);
  }
}
$('filter').addEventListener('input', renderLogins);

$('open-chrome').addEventListener('click', async () => {
  const ok = await api.openChromePasswords();
  if (!ok) $('open-chrome').textContent = 'Chrome wasn\'t found. Open it yourself';
});

$('import').addEventListener('click', async () => {
  const res = await api.importChrome();
  if (!res) return; // cancelled
  $('result').hidden = false;
  if (res.error) {
    $('result-text').textContent = res.error;
    $('trash-row').hidden = true;
  } else {
    const bits = [`${res.added} new`];
    if (res.updated) bits.push(`${res.updated} updated`);
    if (res.skipped) bits.push(`${res.skipped} skipped (apps or blank entries)`);
    $('result-text').textContent = `Imported: ${bits.join(', ')}. ${res.total} saved in total.`;
    $('trash-row').hidden = false;
    $('trash').disabled = false;
    $('trash').textContent = 'Move it to the Recycle Bin';
  }
  if (res.state) { logins = res.state.logins; apply(res.state); }
});

$('trash').addEventListener('click', async () => {
  const ok = await api.trashExport();
  $('trash').disabled = true;
  $('trash').textContent = ok ? 'Moved to the Recycle Bin' : 'Couldn\'t move it. Delete it yourself';
});

$('clear').addEventListener('click', async () => {
  if (!confirm('Remove every saved login from 7 Views? Your passwords in Chrome are not affected.')) return;
  const st = await api.clearLogins();
  if (st) { logins = st.logins; apply(st); }
});

// ---------------- everything ----------------

function apply(state) {
  S = state;
  renderTop();
  renderMonitors();
  renderLayout();
  renderScreens();
  renderSound();
  renderSwitches();
  renderScores();
  renderFavorites();
  renderCommunity();
  renderGeneral();
  renderVault();
}

api.onState(apply);
api.get().then((st) => { if (st) { logins = st.logins || []; apply(st); } });
