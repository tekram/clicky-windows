import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("clicky", {
  // Hotkey events
  onRecordingChanged: (callback: (isRecording: boolean) => void) => {
    ipcRenderer.on("hotkey:recording-changed", (_event, isRecording) => {
      callback(isRecording);
    });
  },

  // Overlay pointing
  onPoint: (
    callback: (
      tags: Array<{ x: number; y: number; label: string; screen: number }>
    ) => void
  ) => {
    ipcRenderer.on("overlay:point", (_event, tags) => {
      callback(tags);
    });
  },

  // TTS audio playback
  onTTSPlay: (callback: (audioData: ArrayBuffer) => void) => {
    ipcRenderer.on("tts:play", (_event, data) => {
      callback(data);
    });
  },

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:getAll"),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke("settings:set", key, value),

  // Chat — send a text query (captures screen + sends to Claude)
  sendQuery: (text: string): Promise<string> =>
    ipcRenderer.invoke("chat:query", text),

  // Audio
  sendTranscript: (transcript: string) => {
    ipcRenderer.send("audio:transcript-ready", transcript);
  },
});
