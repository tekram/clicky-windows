import { Tray, Menu, nativeImage } from "electron";

interface TrayCallbacks {
  onChat: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;

function createTrayIcon(): Electron.NativeImage {
  // 16x16 gem/diamond icon with blue-to-purple gradient (matches clicky.so branding)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4); // RGBA
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Diamond shape: |x - cx| + |y - cy| <= radius
      const dx = Math.abs(x - cx + 0.5);
      const dy = Math.abs(y - cy + 0.5);
      const diamondDist = dx + dy;
      const radius = 6.5;

      if (diamondDist <= radius) {
        // Blue-to-purple gradient based on position
        const t = (x + y) / (size * 2); // 0..1 diagonal
        const r = Math.round(80 + t * 90);   // 80 -> 170 (blue to purple)
        const g = Math.round(120 - t * 70);  // 120 -> 50
        const b = Math.round(240 + t * 15);  // 240 -> 255

        // Add facet highlights
        let brightness = 1.0;
        if (dy < 2 && y < cy) brightness = 1.3;       // top highlight
        if (dx < 1.5 && dy < 1.5) brightness = 1.15;  // center gleam

        buf[idx] = Math.min(255, Math.round(r * brightness));
        buf[idx + 1] = Math.min(255, Math.round(g * brightness));
        buf[idx + 2] = Math.min(255, Math.round(b * brightness));
        buf[idx + 3] = 255;
      } else if (diamondDist <= radius + 1) {
        // Anti-aliased edge
        const alpha = Math.max(0, Math.min(255, (radius + 1 - diamondDist) * 255));
        const t = (x + y) / (size * 2);
        buf[idx] = Math.round(80 + t * 90);
        buf[idx + 1] = Math.round(120 - t * 70);
        buf[idx + 2] = Math.round(240 + t * 15);
        buf[idx + 3] = Math.round(alpha);
      } else {
        buf[idx + 3] = 0; // transparent
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

  // Left-click opens chat directly
  tray.on("click", () => {
    callbacks.onChat();
  });

  return tray;
}
