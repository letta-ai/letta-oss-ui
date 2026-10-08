import { BrowserWindow, dialog, ipcMain } from "electron";
import type { AppEvent, AppRequests } from "./types.js";
import {
  applyPermissionMode,
  archiveConversation,
  createAgent,
  getConnection,
  listAgents,
  listConversations,
  listModels,
  loadHistory,
  reconnect,
  renameConversation,
  respondApproval,
  sendMessage,
  stopTurn,
} from "./libs/runtime.js";
import { getSettings, updateSettings } from "./libs/settings.js";
import { describeError } from "./libs/transcript.js";
import { validateEventFrame } from "./util.js";

type Handlers = {
  [K in keyof AppRequests]: (
    ...args: Parameters<AppRequests[K]>
  ) => ReturnType<AppRequests[K]> | Promise<ReturnType<AppRequests[K]>>;
};

export function broadcast(event: AppEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("cowork:event", event);
  }
}

const handlers: Handlers = {
  getSettings,
  updateSettings: (update) => {
    const { connectionChanged } = updateSettings(update);
    if (update.permissionMode) applyPermissionMode();
    // The renderer follows the reconnect through `connection` events.
    if (connectionChanged) void reconnect();
    return getSettings();
  },
  getConnection,
  reconnect,
  listAgents,
  createAgent,
  listModels,
  listConversations,
  loadHistory,
  renameConversation,
  archiveConversation,
  sendMessage,
  stopTurn,
  respondApproval,
  selectDirectory: async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
};

export function registerIpc(): void {
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`cowork:${name}`, async (event, ...args: unknown[]) => {
      // Errors cross the bridge as data so the renderer sees the real message
      // instead of Electron's "Error invoking remote method" wrapper.
      try {
        validateEventFrame(event.senderFrame);
        const value = await (handler as (...input: unknown[]) => unknown)(...args);
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    });
  }
}
