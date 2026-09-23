const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 7777;
const ROOT = path.join(__dirname, '..');
let serverProcess = null;

function waitForServer(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = https.get(url, { rejectUnauthorized: false }, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        setTimeout(tick, 150);
      });
      req.on('error', () => {
        if (Date.now() - started > timeout) return reject(new Error('x.local server timeout'));
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050505',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadURL('https://127.0.0.1:' + PORT, { rejectUnauthorized: false });
  return win;
}

app.whenReady().then(async () => {
  session.defaultSession.setCertificateVerifyProc((_request, callback) => callback(0));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'camera', 'microphone'].includes(permission) || permission === 'notifications');
  });

  const script = path.join(ROOT, 'server', 'index.js');
  serverProcess = spawn(process.execPath, [script], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PORT: String(PORT) }
  });

  try {
    await waitForServer('https://127.0.0.1:' + PORT);
    createWindow();
  } catch (err) {
    console.error(err);
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
