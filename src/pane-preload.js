'use strict';
// Runs in every screen's page (isolated from the page's own scripts). Fills login forms from the saved logins.
// The main process decides which logins match, from the page's real address; this side only asks and fills.

const { ipcRenderer } = require('electron');

let lookedUp = '';   // the address we last asked about
let logins = [];     // [{ i, username }] for this page
let zoom = 1;
let chooser = null;
let filled = new WeakSet();

const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

// Set a field the way typing would, so sites built on React/Vue notice the change.
function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function passwordField() {
  return [...document.querySelectorAll('input[type="password"]')]
    .find((el) => visible(el) && !/new-password/i.test(el.autocomplete || ''));
}

// The username box: the last visible text/email field before the password box (same form when there is one).
function userField(pw) {
  const scope = (pw && pw.form) || document;
  const fields = [...scope.querySelectorAll('input')]
    .filter((el) => /^(text|email|tel|)$/i.test(el.type) && visible(el) && !el.readOnly && !el.disabled);
  if (!pw) return fields.find((el) => /username|email/i.test(el.autocomplete || '') || el.type === 'email') || null;
  const before = fields.filter((el) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  return before[before.length - 1] || null;
}

async function fill(login, pw, user) {
  closeChooser();
  if (user && login.username) setValue(user, login.username);
  if (pw) {
    const password = await ipcRenderer.invoke('vault:password', login.i);
    if (password) setValue(pw, password);
  }
}

function closeChooser() {
  chooser?.remove();
  chooser = null;
}

// More than one saved login for this site: a small list under the box to pick from.
function showChooser(anchor, pw, user) {
  closeChooser();
  const r = anchor.getBoundingClientRect();
  const box = document.createElement('div');
  // screens show pages zoomed out; CSS zoom undoes that so the list reads at normal size (its offsets scale too)
  box.setAttribute('style', [
    'position:fixed', `left:${r.left * zoom}px`, `top:${(r.bottom + 2) * zoom}px`, `zoom:${1 / zoom}`,
    'z-index:2147483647', 'min-width:180px', 'background:#171c21', 'border:1px solid #2a323a', 'border-radius:4px',
    'box-shadow:0 4px 14px rgba(0,0,0,.45)', 'font:500 12px "Segoe UI",system-ui,sans-serif', 'color:#d6dbe0', 'padding:3px',
  ].join(';'));
  const head = document.createElement('div');
  head.textContent = 'Side View: saved logins';
  head.setAttribute('style', 'padding:5px 8px;color:#7d8791;font-size:11px');
  box.append(head);
  for (const login of logins) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = login.username || '(no username)';
    b.setAttribute('style', 'display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:3px;background:none;color:inherit;font:inherit;cursor:pointer');
    b.addEventListener('mouseenter', () => { b.style.background = '#212932'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
    b.addEventListener('mousedown', (e) => { e.preventDefault(); fill(login, pw, user); });
    box.append(b);
  }
  document.documentElement.append(box);
  chooser = box;
}

async function scan() {
  const pw = passwordField();
  const user = userField(pw);
  if (!pw && !user) return;
  if (lookedUp !== location.href) {
    lookedUp = location.href;
    const res = await ipcRenderer.invoke('vault:lookup');
    logins = (res && res.logins) || [];
    zoom = (res && res.zoom) || 1;
  }
  if (!logins.length) return;

  if (logins.length === 1) {
    // one login for this site: fill it in, once per box, without overwriting what's typed
    const [login] = logins;
    if (pw && !filled.has(pw) && !pw.value) { filled.add(pw); if (user) filled.add(user); fill(login, pw, user && !user.value ? user : null); }
    else if (!pw && user && !filled.has(user) && !user.value && login.username) { filled.add(user); setValue(user, login.username); }
    return;
  }
  // several: offer the list when a login box is clicked
  for (const el of [pw, user].filter(Boolean)) {
    if (filled.has(el)) continue;
    filled.add(el);
    el.addEventListener('focus', () => showChooser(el, pw || passwordField(), user || userField(pw)));
    el.addEventListener('blur', () => setTimeout(closeChooser, 150));
    if (document.activeElement === el) showChooser(el, pw, user);
  }
}

let scanTimer = null;
const soon = () => { clearTimeout(scanTimer); scanTimer = setTimeout(() => scan().catch(() => {}), 400); };

window.addEventListener('DOMContentLoaded', () => {
  soon();
  // login forms often appear after the page loads (single-page apps, two-step sign-ins)
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
});
window.addEventListener('popstate', () => { filled = new WeakSet(); soon(); });
