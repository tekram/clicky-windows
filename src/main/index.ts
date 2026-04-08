import { app, BrowserWindow, globalShortcut } from "electron";
import { createTray } from "./tray";
import { ScreenCapture } from "./screenshot";
import { HotkeyManager } from "./hotkey";
import { AudioCapture } from "./audio";
import { SettingsStore } from "./settings";
import path from "path";

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

const settings = new SettingsStore();

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "overlay", "index.html"));
  return win;
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "settings", "index.html"));
  win.once("ready-to-show", () => win.show());
  return win;
}

app.whenReady().then(() => {
  // Hide from taskbar — tray only
  app.dock?.hide?.();

  overlayWindow = createOverlayWindow();

  const tray = createTray({
    onSettings: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
      } else {
        mainWindow = createSettingsWindow();
        mainWindow.on("closed", () => {
          mainWindow = null;
        });
      }
    },
    onQuit: () => app.quit(),
  });

  const hotkeyManager = new HotkeyManager(settings);
  hotkeyManager.register();

  console.log("Clicky Windows started — running in system tray");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Prevent app from closing when all windows are closed (tray app)
app.on("window-all-closed", () => {
  // Do nothing — keep app running in tray
});
