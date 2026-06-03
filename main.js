const { app, BrowserWindow, shell, Menu, Notification } = require('electron');
const http = require('http');

const PORT = 4891;
let win = null;
let reminderInterval = null;

function startServer() {
  process.env.PORT = String(PORT);
  process.env.USER_DATA = app.getPath('userData');
  require('./server');
}

function waitForServer(timeout = 10000) {
  return new Promise(resolve => {
    const start = Date.now();
    function check() {
      const req = http.get(`http://localhost:${PORT}/api/key-status`, res => {
        if (res.statusCode === 200) resolve(); else retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => { req.destroy(); retry(); });
    }
    function retry() {
      if (Date.now() - start < timeout) setTimeout(check, 300); else resolve();
    }
    setTimeout(check, 400);
  });
}

// ── Daily reminder notification ──
function checkReminder() {
  if (!win) return;
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  // Fire at 8:00 PM by default
  if (hour !== 20 || minute !== 0) return;

  http.get(`http://localhost:${PORT}/api/data`, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => {
      try {
        const data = JSON.parse(raw);
        const today = new Date().toISOString().split('T')[0];
        const logged = (data.days || []).some(d => d.date === today);
        if (!logged && Notification.isSupported()) {
          const n = new Notification({
            title: '⚡ Business Escalate',
            body: "You haven't logged today yet — 2 minutes keeps your streak alive!"
          });
          n.on('click', () => { if (win) { win.show(); win.focus(); } });
          n.show();
        }
      } catch {}
    });
  }).on('error', () => {});
}

async function createWindow() {
  startServer();
  await waitForServer();

  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: 'Business Escalate',
    backgroundColor: '#0F1117',
    show: false,
    autoHideMenuBar: true
  });

  Menu.setApplicationMenu(null);
  win.loadURL(`http://localhost:${PORT}`);

  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Check for reminder every minute
  reminderInterval = setInterval(checkReminder, 60000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (reminderInterval) clearInterval(reminderInterval); app.quit(); });
app.on('activate', () => { if (win === null) createWindow(); });
