const { app, BrowserWindow, dialog } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const http = require('http');

const SERVER_PORT = 3001;
let serverProcess = null;
let mainWindow = null;

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'server.js');
  }
  return path.join(__dirname, '..', 'backend', 'server.js');
}

function getWwwPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, '..', 'frontend');
  }
  return path.join(__dirname, '..', 'frontend');
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = getServerPath();
    serverProcess = fork(serverPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, PORT: String(SERVER_PORT) },
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Server]', msg);
      if (msg.includes('corriendo')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString());
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      console.log('[Server] exited with code', code);
    });

    // Fallback: resolve after timeout
    setTimeout(() => resolve(), 3000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DaniMarvis Store — Panel de Gestión',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Remove default menu
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting server...');
    await startServer();
    console.log('[Electron] Creating window...');
    createWindow();
  } catch (err) {
    console.error('[Electron] Failed to start:', err);
    dialog.showErrorBox('Error', 'No se pudo iniciar el servidor:\n' + err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
