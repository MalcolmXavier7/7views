'use strict';

const svg = (d) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  muted: svg('<path d="M2 6h2.5L8 3v10l-3.5-3H2z"/><path d="M11 6l3 4M14 6l-3 4"/>'),
  sound: svg('<path d="M2 6h2.5L8 3v10l-3.5-3H2z"/><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.8a6 6 0 0 1 0 8.4"/>'),
  fit: svg('<path d="M2 5.5V2.5h3M11 2.5h3v3M14 10.5v3h-3M5 13.5H2v-3"/><rect x="5" y="5" width="6" height="6" rx="0.5"/>'),
  back: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M12 6.5L7.5 11M7.5 7.5V11H11"/>'),
};

const bar = document.querySelector('.bar');
const title = document.getElementById('title');
const mute = document.getElementById('mute');
const fit = document.getElementById('fit');
const back = document.getElementById('back');
let state = { muted: true, fit: 'off' };

back.innerHTML = ICON.back;
fit.innerHTML = ICON.fit;
mute.addEventListener('click', () => window.pip.setMuted(!state.muted));
fit.addEventListener('click', () => window.pip.setFit({ off: 'fit', fit: 'fill', fill: 'bottom', bottom: 'off' }[state.fit] || 'off'));
back.addEventListener('click', () => window.pip.back());

// drag the bar (not its buttons) to move the window
bar.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.btn')) return;
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('dragging');
  window.pip.drag(true);
});
const endDrag = () => {
  if (!bar.classList.contains('dragging')) return;
  bar.classList.remove('dragging');
  window.pip.drag(false);
};
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', endDrag);
bar.addEventListener('lostpointercapture', endDrag);

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || ''; } };

window.pip.onState((s) => {
  state = s;
  bar.hidden = s.headerH === 0; // the site's own fullscreen covers the bar
  title.textContent = s.title || hostOf(s.url) || 'Empty screen';
  title.title = s.url || '';
  bar.classList.toggle('live', !s.muted);
  mute.innerHTML = s.muted ? ICON.muted : ICON.sound;
  mute.title = s.muted ? 'Unmute' : 'Mute';
  mute.setAttribute('aria-label', mute.title);
  fit.classList.toggle('on', s.fit !== 'off');
  fit.title = { off: 'Show only the video', fit: 'Fill edge to edge', fill: 'Fill, keeping the bottom', bottom: 'Show the whole site' }[s.fit];
  fit.setAttribute('aria-label', fit.title);
});
window.pip.ready();
