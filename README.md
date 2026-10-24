# Side View: a RedZone-style 6-screen viewer for Windows

Watch up to six games, streams or sites at once on one monitor, like your own RedZone wall. Side View fills the monitor you pick with 2 to 6 live web screens, arranges them in one click, and keeps a live score ticker running along the bottom.

> Side View is a viewer, not a stream source. It shows the websites you open in it, from services you already have access to. It isn't affiliated with the NFL, NFL RedZone or any league or broadcaster. Use legal, licensed sources.

## Why

Game day means more than one game. A TV only gives you one picture, and browser windows overlap and fight over sound. Side View gives each game its own screen on one wall, keeps every screen muted except the one you choose, and lets you move, resize and swap screens while they play.

## Features

- **2 to 6 screens** on one full-screen wall, on any monitor.
- **Layouts in one click:**
  - **Row:** side by side at equal widths (2 halves, 3 thirds).
  - **Side:** one big screen with the rest stacked beside it.
  - **Center:** small screens on top, the main game big in the middle, a wide strip along the bottom.
  - **Grid:** even tiles.
- **Move anything:** drag a screen's bar to move it, drop it on another screen to swap them, and drag an edge to resize. Screens glide into place.
- **Locks:** lock one screen or all of them so nothing moves by accident.
- **One sound at a time:** every screen starts muted. Unmute one and the rest go quiet. An amber dot shows a muted screen that's playing.
- **Show only video:**
  - **Fit:** the whole video, as big as it fits.
  - **Fill:** edge to edge.
  - **Keep bottom:** edge to edge without cropping off the score bug.
- **Score ticker** along the bottom with live scores, the game clock, tip-off times and finals. Choose NBA, WNBA, college basketball, NFL, college football, Premier League, Champions League, La Liga or MLS.
- **Picture-in-picture:** float any screen in its own small window above everything.
- **Lock to part of the screen (optional):** Side View takes the left, right, top or bottom 25 to 75% of the monitor, and your other apps fill the rest.
- **Favorites:** save sites with the crossed-bones button, click one to load it into the selected screen, or drag it onto any screen.
- **3 saved setups**, each with its own screens and layout. Every monitor remembers its own layout.
- **Zoom per site:** zoom one screen and every screen on that site follows.
- **Control panel** with every setting on one page, plus memory and CPU use per screen.
- **Layout codes:** share your arrangement as a short code (positions only, never links).
- **Blocks popups**, and keeps pages from talking to apps on your PC.

## Run it

1. Install Node.js (LTS) from https://nodejs.org.
2. Double-click `run.bat`. The first launch installs what it needs, then Side View opens.

Or from a terminal:

```bash
npm install
npm start
```

To build a Windows installer, run `npm run dist`; the output goes to `dist/`.

## Using it

**Settings bar (top).** From left to right:
- **Move or pick:** drag the bar to carry Side View to another monitor, or use the monitor picker.
- **1 2 3:** your three saved setups.
- **Row / Side / Center / Grid:** the layout presets.
- **− N screens +:** add or remove screens (2 to 6).
- **Favorites.**
- **Switches:** lock all, lock to part of the screen, cover the taskbar, keep on top, bars around screens, glass look, score ticker.
- Mute all, control panel, hide the bar, hide Side View, quit.

**Each screen's bar:** back, forward, the address (click to type a link, or drop one on it), mute, reload, show only video, save to favorites, picture-in-picture, lock, turn off.

**Shortcuts:**

| Shortcut | Does |
| --- | --- |
| `Ctrl+Alt+P` | Control panel |
| `Ctrl+Alt+S` | Show or hide Side View |
| `Ctrl+Alt+F` | Settings bar on or off |
| `Ctrl+Alt+D` | Move to the next monitor |
| `Ctrl+Alt+K` | Lock to part of the screen |
| `Ctrl+Alt+T` | Cover the taskbar |
| `Ctrl+Alt+B` | Bars around screens |
| `Ctrl+Alt+N` | Add a screen |
| `Ctrl+Alt+M` | Mute all |
| `Ctrl+Alt+1/2/3` | Switch setup |

## Good to know

- Screens are built-in browser panes, not your Chrome, so extensions aren't available. A few sites, such as Google sign-in and some copy-protected streaming services, may refuse to play in them.
- A site's own fullscreen button fills just that screen. Press Esc to leave it.
- Settings are saved in `config.json` in your app data folder; the tray menu has "Show settings file".
- Windows only (tested on Windows 11, mixed-DPI multi-monitor setups).

## Self-test

```bash
SV_TEST=1 SV_TEST_OUT=out.json npx electron .
```

It runs 46 checks in a hidden window with a throwaway profile, so it never touches your settings.

## Files

| File | What it is |
| --- | --- |
| `src/main.js` | The window, screens, layouts, ticker, tray, shortcuts |
| `src/appbar.js` | Windows calls for monitor info, window placement and screen reservation |
| `src/shell.*`, `preload.js` | Settings bar, screen bars, ticker |
| `src/settings.*` | Control panel |
| `src/pip.*` | Picture-in-picture window |
| `src/start.html`, `error.html` | Empty-screen and load-error pages |
| `src/vault.js`, `pane-preload.js` | Optional saved logins (encrypted with Windows) |
| `src/selftest.js` | The self-test |
| `discord/` | The community server's channel and rules blueprint |
| `CLAUDE.md` | Design notes for developers |
