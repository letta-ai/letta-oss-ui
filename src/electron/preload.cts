import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppBridge, AppEvent, AppRequests } from "./types.js" with { "resolution-mode": "import" };

const METHODS = [
  "getSettings",
  "updateSettings",
  "getConnection",
  "reconnect",
  "listAgents",
  "createAgent",
  "getAgent",
  "updateAgent",
  "deleteAgent",
  "listModels",
  "listProviders",
  "connectProvider",
  "disconnectProvider",
  "listMemory",
  "readMemoryFile",
  "writeMemoryFile",
  "deleteMemoryFile",
  "listMemoryHistory",
  "readMemoryFileAt",
  "listConversations",
  "loadHistory",
  "renameConversation",
  "archiveConversation",
  "sendMessage",
  "stopTurn",
  "respondApproval",
  "selectDirectory",
] as const satisfies readonly (keyof AppRequests)[];

// Fails to compile if a request is added to AppRequests but not listed above.
type Missing = Exclude<keyof AppRequests, (typeof METHODS)[number]>;
const exhaustive: Missing extends never ? true : never = true;
void exhaustive;

type Reply = { ok: true; value: unknown } | { ok: false; error: string };

const requests = Object.fromEntries(
  METHODS.map((method) => [
    method,
    async (...args: unknown[]) => {
      const reply = (await ipcRenderer.invoke(`app:${method}`, ...args)) as Reply;
      if (!reply.ok) throw new Error(reply.error);
      return reply.value;
    },
  ]),
);

const bridge = {
  ...requests,
  onEvent: (listener: (event: AppEvent) => void) => {
    const handler = (_: IpcRendererEvent, event: AppEvent) => listener(event);
    ipcRenderer.on("app:event", handler);
    return () => {
      ipcRenderer.off("app:event", handler);
    };
  },
  platform: process.platform,
} as AppBridge;

contextBridge.exposeInMainWorld("bridge", bridge);
