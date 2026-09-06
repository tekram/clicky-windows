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

  // Voice transcript from push-to-talk
  onVoiceTranscript: (callback: (transcript: string) => void) => {
    ipcRenderer.on("voice:transcript", (_event, transcript) => {
      callback(transcript);
    });
  },

  // Cursor buddy
  onCursorBuddy: (callback: (x: number, y: number) => void) => {
    ipcRenderer.on("overlay:cursor-buddy", (_event, x, y) => {
      callback(x, y);
    });
  },

  onCursorBuddyVisible: (callback: (visible: boolean) => void) => {
    ipcRenderer.on("overlay:cursor-buddy-visible", (_event, visible) => {
      callback(visible);
    });
  },

  // Processing stage updates from companion pipeline
  onStage: (callback: (data: { stage: string; label: string }) => void) => {
    ipcRenderer.on("companion:stage", (_event, data) => {
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

  // Agent mode — Claude controls the mouse and keyboard until the task is done
  runAgentTask: (task: string): Promise<string> =>
    ipcRenderer.invoke("agent:run", task),
  stopAgent: () => ipcRenderer.invoke("agent:stop"),
  isAgentRunning: (): Promise<boolean> => ipcRenderer.invoke("agent:isRunning"),

  // Audio — send complete recording for transcription + AI query
  sendAudioRecording: (audioData: ArrayBuffer): Promise<{ transcript?: string; response?: string; error?: string }> =>
    ipcRenderer.invoke("audio:recording-complete", audioData),

  // Open URL in default browser
  openExternal: (url: string) => {
    ipcRenderer.invoke("shell:openExternal", url);
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
});
