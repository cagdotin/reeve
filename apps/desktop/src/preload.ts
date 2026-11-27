/**
 * Preload for the app window. It runs sandboxed, so it is bundled to CommonJS on its own and may
 * only use Electron's renderer modules. The web app reads `window.reeve` to draw macOS window
 * chrome (title bar strip, room for the traffic lights) that the browser build leaves out, to use
 * native dialogs where a browser has none (picking a file).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("reeve", {
  isDesktop: true,
  platform: process.platform,
  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke("reeve:is-full-screen"),
  pickFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke("reeve:pick-folder", defaultPath),
  showFolder: (folder: string): Promise<void> => ipcRenderer.invoke("reeve:show-folder", folder),
  onFullScreenChange: (listener: (fullScreen: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, fullScreen: boolean) => listener(fullScreen);
    ipcRenderer.on("reeve:full-screen", handler);
    return () => {
      ipcRenderer.removeListener("reeve:full-screen", handler);
    };
  },
});
