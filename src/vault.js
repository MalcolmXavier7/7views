'use strict';
// Saved logins, imported from Chrome's password export (a CSV file). Stored encrypted with Windows' own
// user-account encryption (Electron safeStorage / DPAPI), so the file on disk is unreadable to other accounts.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const vaultPath = () => path.join(app.getPath('userData'), 'logins.bin');
let entries = null; // [{ id, host, url, username, password }]

function load() {
  if (entries) return entries;
  entries = [];
  try {
    const raw = fs.readFileSync(vaultPath());
    const list = JSON.parse(safeStorage.decryptString(raw));
    if (Array.isArray(list)) entries = list.filter((e) => e && typeof e.host === 'string' && typeof e.password === 'string');
  } catch { /* no vault yet, or it can't be read on this account */ }
  return entries;
}

function save() {
  fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
  fs.writeFileSync(vaultPath(), safeStorage.encryptString(JSON.stringify(entries || [])));
}

const available = () => safeStorage.isEncryptionAvailable();

// RFC 4180 CSV: quoted fields may hold commas, newlines and "" for a quote.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ''));
}

// Chrome's export has the columns name,url,username,password,note (older versions: name,url,username,password).
function importCsv(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const [iu, iuser, ipass] = [col('url'), col('username'), col('password')];
  if (iu < 0 || ipass < 0) throw new Error('This doesn\'t look like a Chrome password export (no url/password columns).');
  load();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const url = (r[iu] || '').trim();
    const username = iuser >= 0 ? r[iuser] || '' : '';
    const password = r[ipass] || '';
    let host;
    try { host = new URL(url).hostname.toLowerCase(); } catch { host = ''; }
    if (!host || !password || !/^https?:/i.test(url)) { skipped += 1; continue; } // android:// apps and blanks
    const same = entries.find((e) => e.host === host && e.username === username);
    if (same) {
      if (same.password !== password) { same.password = password; updated += 1; }
      continue;
    }
    entries.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, host, url, username, password });
    added += 1;
  }
  save();
  return { added, updated, skipped, total: entries.length };
}

// "accounts.google.com" and "google.com" count as one site; so do "login.bbc.co.uk" and "bbc.co.uk".
function site(host) {
  const parts = host.split('.');
  const shortSecond = parts.length > 2 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3;
  return parts.slice(shortSecond ? -3 : -2).join('.');
}

// Logins for a page, best match first: exact host, then the same site.
function forUrl(url) {
  let u;
  try { u = new URL(url); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const host = u.hostname.toLowerCase();
  return load()
    .filter((e) => site(e.host) === site(host) && (u.protocol === 'https:' || e.url.startsWith('http:')))
    .sort((a, b) => (b.host === host) - (a.host === host));
}

// For the settings list: never includes passwords.
const summary = () => load().map(({ id, host, username }) => ({ id, host, username })).sort((a, b) => a.host.localeCompare(b.host));

function remove(id) {
  load();
  entries = entries.filter((e) => e.id !== id);
  save();
}

function clear() {
  entries = [];
  try { fs.unlinkSync(vaultPath()); } catch { /* already gone */ }
}

module.exports = { available, importCsv, forUrl, summary, remove, clear };
