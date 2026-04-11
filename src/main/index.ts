import { app, BrowserWindow, globalShortcut, ipcMain, shell, screen } from "electron";
import { createTray } from "./tray";
import { HotkeyManager } from "./hotkey";
import { AudioCapture } from "./audio";
import { SettingsStore } from "./settings";
import { CompanionManager } from "./companion";
import path from "path";

let chatWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

const settings = new SettingsStore();
let companion: CompanionManager;

function createOverlayWindow(): BrowserWindow {
  // Use the primary display bounds explicitly — fullscreen: true is unreliable
  // when combined with transparent on Windows.
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "overlay", "index.html"));

  // Forward overlay renderer console messages to main process so we can see
  // them in PowerShell during dev.
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[overlay-console:${level}] ${message} (line ${line})`);
  });

  // Open DevTools for the overlay so we can inspect it in dev mode.
  // The DevTools window is separate so it works even though overlay is transparent.
  if (!app.isPackaged) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.openDevTools({ mode: "detach" });
    });
  }

  // Show after load is ready (transparent + show:false avoids a black flash on Windows)
  win.once("ready-to-show", () => {
    win.showInactive();
    win.setAlwaysOnTop(true, "screen-saver");
    console.log("[Clicky] Overlay window shown:", win.getBounds(), "isVisible:", win.isVisible());
  });

  // Fallback: if ready-to-show never fires (transparent windows can be tricky),
  // force-show after the load completes.
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, "screen-saver");
      console.log("[Clicky] Overlay forced-shown after did-finish-load:", win.getBounds());
    }
  });

  return win;
}

function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 550,
    resizable: true,
    show: false,
    frame: false,
    transparent: false,
    alwaysOnTop: settings.get("alwaysOnTop"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "chat", "index.html"));
  win.once("ready-to-show", () => {
    win.show();
    // setAlwaysOnTop after show — more reliable on Windows than constructor option
    if (settings.get("alwaysOnTop")) {
      win.setAlwaysOnTop(true, "screen-saver");
      // Re-apply after a short delay — Windows can reset it
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.setAlwaysOnTop(true, "screen-saver");
          // alwaysOnTop applied
        }
      }, 500);
    }
  });
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

function setupIPC(): void {
  // Chat query — captures screen + sends to Claude
  ipcMain.handle("chat:query", async (_event, text: string) => {
    try {
      const response = await companion.processQuery(text);
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
  });

  // Settings
  ipcMain.handle("settings:getAll", () => settings.getAll());
  ipcMain.handle("settings:set", (_event, key: string, value: unknown) => {
    settings.set(key as keyof ReturnType<typeof settings.getAll>, value as never);

    // Apply alwaysOnTop immediately
    if (key === "alwaysOnTop" && chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.setAlwaysOnTop(!!value, "screen-saver");
    }
  });

  // Open URL in default browser
  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (url.startsWith("https://")) {
      shell.openExternal(url);
    }
  });

  // Window controls
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

app.whenReady().then(() => {
  // Hide from taskbar — tray only
  app.dock?.hide?.();

  overlayWindow = createOverlayWindow();
  companion = new CompanionManager(settings, overlayWindow);

  const audioCapture = new AudioCapture(settings);
  audioCapture.setCompanion(companion);

  setupIPC();

  const tray = createTray({
    onChat: () => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
      } else {
        chatWindow = createChatWindow();
        chatWindow.on("closed", () => {
          chatWindow = null;
        });
      }
    },
    onSettings: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
      } else {
        settingsWindow = createSettingsWindow();
        settingsWindow.on("closed", () => {
          settingsWindow = null;
        });
      }
    },
    onQuit: () => app.quit(),
  });

  const hotkeyManager = new HotkeyManager(settings);
  hotkeyManager.register();

  // Open chat on launch so there's something visible
  chatWindow = createChatWindow();
  chatWindow.on("closed", () => {
    chatWindow = null;
  });

  console.log("Clicky Windows started — running in system tray");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Prevent app from closing when all windows are closed (tray app)
app.on("window-all-closed", () => {
  // Do nothing — keep app running in tray
});
