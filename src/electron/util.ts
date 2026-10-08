import { app, type WebFrameMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEV_PORT = 5173;
export const DEV_URL = `http://localhost:${DEV_PORT}`;

export function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

export function getPreloadPath(): string {
  return join(app.getAppPath(), "dist-electron", "preload.cjs");
}

export function getUIPath(): string {
  return join(app.getAppPath(), "dist-react", "index.html");
}

export function getIconPath(): string {
  return join(app.getAppPath(), "templateIcon.png");
}

/** True when a URL is the app's own UI rather than somewhere it navigated to. */
export function isAppUrl(url: string): boolean {
  if (isDev()) return new URL(url).origin === DEV_URL;
  return url.split(/[?#]/)[0] === pathToFileURL(getUIPath()).toString();
}

/** Reject IPC from anything other than the app's own UI. */
export function validateEventFrame(frame: WebFrameMain | null): void {
  if (!frame || !isAppUrl(frame.url)) throw new Error("Blocked IPC from an untrusted frame.");
}
