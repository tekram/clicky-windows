import { Tray, Menu, nativeImage } from "electron";

interface TrayCallbacks {
  onChat: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;

function createTrayIcon(): Electron.NativeImage {
  // Create a 16x16 icon programmatically (blue circle on transparent bg)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4); // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x - size / 2 + 0.5;
      const cy = y - size / 2 + 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const idx = (y * size + x) * 4;

      if (dist < 6) {
        // Blue circle
        buf[idx] = 59;     // R
        buf[idx + 1] = 130; // G
        buf[idx + 2] = 246; // B
        buf[idx + 3] = 255; // A
      } else if (dist < 7) {
        // Anti-aliased edge
        const alpha = Math.max(0, Math.min(255, (7 - dist) * 255));
        buf[idx] = 59;
        buf[idx + 1] = 130;
        buf[idx + 2] = 246;
        buf[idx + 3] = alpha;
      } else {
        // Transparent
        buf[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Clicky",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Chat",
      click: callbacks.onChat,
    },
    {
      label: "Settings",
      click: callbacks.onSettings,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: callbacks.onQuit,
    },
  ]);

  tray.setToolTip("Clicky — AI Screen Companion");
  tray.setContextMenu(contextMenu);

  return tray;
}
