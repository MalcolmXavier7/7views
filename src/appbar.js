'use strict';
// Thin wrapper around the Windows AppBar API (shell32!SHAppBarMessage).
// Registering as an AppBar makes Windows shrink the desktop work area, so maximized
// and snapped windows resize into the space that is left. Same mechanism the taskbar uses.

const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABE_LEFT = 0;
const ABE_TOP = 1;
const ABE_RIGHT = 2;
const ABE_BOTTOM = 3;
const CALLBACK_MESSAGE = 0x0401; // WM_USER + 1, delivered to the docked window

let koffi = null;
let sendMessage = null;
let setWindowPos = null;
let enumMonitors = null;
let getWindowRect = null;
let getAsyncKeyState = null;
let APPBARDATA = null;
let hwnd = 0;
let edge = ABE_LEFT;
let registered = false;

function available() {
  if (process.platform !== 'win32') return false;
  if (sendMessage) return true;
  try {
    koffi = require('koffi');
    const shell32 = koffi.load('shell32.dll');
    koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    APPBARDATA = koffi.struct('APPBARDATA', {
      cbSize: 'uint32',
      hWnd: 'intptr_t',
      uCallbackMessage: 'uint32',
      uEdge: 'uint32',
      rc: 'RECT',
      lParam: 'intptr_t',
    });
    const user32 = koffi.load('user32.dll');
    getWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *rc)');
    getAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)');
    const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: 'RECT', rcWork: 'RECT', dwFlags: 'uint32' });
    const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ MONITORINFO *mi)');
    // No callbacks: EnumDisplayMonitors needs Windows to call back into JavaScript, and creating those native
    // callbacks over and over crashed the app (koffi access violations, and 0xc0150010 "activation context not
    // active"). Instead walk the display devices, read each one's current mode (position and size in real pixels),
    // and ask for the monitor at its centre to get the work area.
    koffi.struct('POINT', { x: 'int32', y: 'int32' });
    const EnumDisplayDevicesW = user32.func('bool __stdcall EnumDisplayDevicesW(str16 device, uint32 iDevNum, _Inout_ void *dd, uint32 flags)');
    const EnumDisplaySettingsW = user32.func('bool __stdcall EnumDisplaySettingsW(str16 device, uint32 iModeNum, _Inout_ void *dm)');
    const MonitorFromPoint = user32.func('intptr_t __stdcall MonitorFromPoint(POINT pt, uint32 flags)');
    const DD_SIZE = 840; // DISPLAY_DEVICEW: cb, DeviceName[32], DeviceString[128], StateFlags, DeviceID[128], DeviceKey[128]
    const DM_SIZE = 220; // DEVMODEW
    const ENUM_CURRENT_SETTINGS = 0xffffffff;
    enumMonitors = () => {
      const found = [];
      for (let i = 0; i < 32; i++) {
        const dd = Buffer.alloc(DD_SIZE);
        dd.writeUInt32LE(DD_SIZE, 0);
        if (!EnumDisplayDevicesW(null, i, dd, 0)) break;
        const flags = dd.readUInt32LE(324);
        if (!(flags & 1)) continue; // DISPLAY_DEVICE_ATTACHED_TO_DESKTOP
        const name = dd.toString('utf16le', 4, 68).replace(/\0[\s\S]*$/, '');
        const dm = Buffer.alloc(DM_SIZE);
        dm.writeUInt16LE(DM_SIZE, 68); // dmSize
        if (!EnumDisplaySettingsW(name, ENUM_CURRENT_SETTINGS, dm)) continue;
        const bounds = { x: dm.readInt32LE(76), y: dm.readInt32LE(80), width: dm.readUInt32LE(172), height: dm.readUInt32LE(176) };
        if (!bounds.width || !bounds.height) continue;
        let work = { ...bounds };
        const hmon = MonitorFromPoint({ x: bounds.x + Math.floor(bounds.width / 2), y: bounds.y + Math.floor(bounds.height / 2) }, 0);
        const info = { cbSize: koffi.sizeof(MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 };
        if (hmon && GetMonitorInfoW(hmon, info)) {
          work = { x: info.rcWork.left, y: info.rcWork.top, width: info.rcWork.right - info.rcWork.left, height: info.rcWork.bottom - info.rcWork.top };
        }
        found.push({ name, bounds, work, primary: (flags & 4) === 4 }); // DISPLAY_DEVICE_PRIMARY_DEVICE
      }
      return found;
    };
    setWindowPos = user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, uint32 uFlags)');
    sendMessage = shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32 dwMessage, _Inout_ APPBARDATA *pData)');
    return true;
  } catch (err) {
    console.error('[side-view] AppBar API unavailable:', err.message);
    return false;
  }
}

function handleFromBuffer(buf) {
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function data(rc) {
  return {
    cbSize: koffi.sizeof(APPBARDATA),
    hWnd: hwnd,
    uCallbackMessage: CALLBACK_MESSAGE,
    uEdge: edge,
    rc: { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom },
    lParam: 0,
  };
}

// Every monitor's true pixel rectangle and work area (this process is per-monitor DPI aware, so these are real
// pixels). Electron's own display numbers are unreliable for a second monitor with different scaling.
function monitors() {
  if (!available() || !enumMonitors) return [];
  try { return enumMonitors(); } catch (err) { console.error('[side-view] could not list monitors:', err.message); return []; }
}

// Where the window really is, in physical pixels (or null).
function windowRect(nativeHandle) {
  if (!available() || !getWindowRect) return null;
  const rc = {};
  return getWindowRect(handleFromBuffer(nativeHandle), rc) ? { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom } : null;
}

// Window placement in physical pixels, without Electron's DIP rounding. onTop false leaves it a normal window.
const HWND_TOPMOST = -1;
const HWND_NOTOPMOST = -2;
const SWP_NOACTIVATE = 0x0010;

// ---- calls made from a background thread ----
// Moving or resizing the window, and registering, moving or removing the reserved band, make Windows send our window
// messages straight away (WM_SIZE, the AppBar notifications). Done synchronously, Electron answers those by running
// JavaScript in the middle of koffi's native call, which crashed Side View (access violations, jumps to address 0,
// 0xc0150010). Made on a worker thread instead, the messages arrive on the main thread through its normal message
// loop after the call has started, and nothing runs re-entrantly.
const later = (fn, ...args) => new Promise((resolve, reject) => fn.async(...args, (err, res) => (err ? reject(err) : resolve(res))));

async function registerAsync(nativeHandle) {
  if (!available()) return false;
  if (registered) return true;
  hwnd = handleFromBuffer(nativeHandle);
  registered = Boolean(await later(sendMessage, ABM_NEW, data({ left: 0, top: 0, right: 0, bottom: 0 })));
  return registered;
}

async function setPosAsync(rect, thickness, side = 'left') {
  if (!registered) return null;
  edge = { right: ABE_RIGHT, bottom: ABE_BOTTOM, top: ABE_TOP }[side] ?? ABE_LEFT;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const d = data({
    left: edge === ABE_RIGHT ? right - thickness : rect.x,
    top: edge === ABE_BOTTOM ? bottom - thickness : rect.y,
    right: edge === ABE_LEFT ? rect.x + thickness : right,
    bottom: edge === ABE_TOP ? rect.y + thickness : bottom,
  });
  await later(sendMessage, ABM_QUERYPOS, d); // Windows trims the rect so it clears the taskbar and other bars
  if (edge === ABE_RIGHT) d.rc.left = d.rc.right - thickness;
  else if (edge === ABE_BOTTOM) d.rc.top = d.rc.bottom - thickness;
  else if (edge === ABE_TOP) d.rc.bottom = d.rc.top + thickness;
  else d.rc.right = d.rc.left + thickness;
  await later(sendMessage, ABM_SETPOS, d);
  return { left: d.rc.left, top: d.rc.top, right: d.rc.right, bottom: d.rc.bottom };
}

async function unregisterAsync() {
  if (!registered) return;
  registered = false;
  try {
    await later(sendMessage, ABM_REMOVE, data({ left: 0, top: 0, right: 0, bottom: 0 }));
  } catch (err) {
    console.error('[side-view] could not release the docked space:', err.message);
  }
}

async function moveWindowAsync(nativeHandle, rc, onTop = true) {
  if (!available() || !setWindowPos) return false;
  return Boolean(await later(setWindowPos, handleFromBuffer(nativeHandle), onTop ? HWND_TOPMOST : HWND_NOTOPMOST, rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, SWP_NOACTIVATE));
}

// Synchronous: only for quitting, when nothing else will run afterwards.
function unregister() {
  if (!registered) return;
  registered = false;
  try {
    sendMessage(ABM_REMOVE, data({ left: 0, top: 0, right: 0, bottom: 0 }));
  } catch (err) {
    console.error('[side-view] could not release the docked space:', err.message);
  }
}

// Whether the left mouse button is held right now, wherever the pointer is (null if we can't tell). Drags that
// cross over a page lose the page's pointer events, so main asks Windows instead.
const VK_LBUTTON = 0x01;
function mouseDown() {
  if (!available() || !getAsyncKeyState) return null;
  return (getAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;
}

module.exports = {
  available, monitors, windowRect, mouseDown, unregister, CALLBACK_MESSAGE, isRegistered: () => registered,
  registerAsync, setPosAsync, unregisterAsync, moveWindowAsync,
};
