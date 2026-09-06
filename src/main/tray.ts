import { Tray, Menu, nativeImage } from "electron";
import path from "path";

interface TrayCallbacks {
  onChat: () => void;
  onSettings: () => void;
  onStopAgent: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "..", "..", "assets", "icon.ico")
  );
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
      label: "Stop agent",
      click: callbacks.onStopAgent,
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
