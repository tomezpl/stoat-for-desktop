import { contextBridge, ipcRenderer } from "electron";

import { version } from "../../package.json";

contextBridge.exposeInMainWorld("native", {
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron,
    desktop: () => version,
  },

  minimise: () => ipcRenderer.send("minimise"),
  maximise: () => ipcRenderer.send("maximise"),
  close: () => ipcRenderer.send("close"),

  setBadgeCount: (count: number) => ipcRenderer.send("setBadgeCount", count),

  onKeyInput: (callback: (key: {key: string, vkCode: number}, state: 'up' | 'down') => void) => {
    ipcRenderer.on("keyInput", (_, key, state) => callback(key, state));
    ipcRenderer.send("onKeyInput");
  }
});
