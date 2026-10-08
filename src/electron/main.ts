import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { broadcast, registerIpc } from "./ipc.js";
import { disconnect, initRuntime } from "./libs/runtime.js";
import type { AppEvent } from "./types.js";
import { DEV_URL, getIconPath, getPreloadPath, getUIPath, isAppUrl, isDev } from "./util.js";

const isMac = process.platform === "darwin";
const QUIT_TIMEOUT_MS = 3_000;

let mainWindow: BrowserWindow | null = null;
let quitting = false;

/** In development, a `.env` in the project root provides connection defaults. */
function loadDevEnv(): void {
  if (app.isPackaged) return;
  try {
    process.loadEnvFile(join(process.cwd(), ".env"));
  } catch {
    // No .env file - settings come from the Settings dialog.
  }
}

/**
 * Apps launched from Finder or a desktop launcher get a minimal PATH, so tools
 * the agent runs (git, node, package managers) would not be found. Take PATH
 * from the user's login shell instead.
 */
function inheritShellPath(): void {
  if (process.platform === "win32" || !app.isPackaged) return;
  try {
    const output = execFileSync(
      process.env.SHELL || "/bin/sh",
      ["-ilc", 'printf "__PATH__%s__PATH__" "$PATH"'],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const path = output.match(/__PATH__(.+)__PATH__/s)?.[1];
    if (path) process.env.PATH = path;
  } catch {
    // Keep the inherited PATH.
  }
}

function sendMenuCommand(command: Extract<AppEvent, { type: "menu" }>["command"]): void {
  if (!mainWindow) createWindow();
  mainWindow?.show();
  broadcast({ type: "menu", command });
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => sendMenuCommand("settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("new-chat") },
        ...(isMac
          ? []
          : ([
              {
                label: "Settings...",
                accelerator: "CmdOrCtrl+,",
                click: () => sendMenuCommand("settings"),
              },
            ] satisfies MenuItemConstructorOptions[])),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: getIconPath(),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d1d1d" : "#ffffff",
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 15, y: 18 } }
      : {}),
    webPreferences: { preload: getPreloadPath() },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Links in agent output open in the browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  if (isDev()) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(getUIPath());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    loadDevEnv();
    inheritShellPath();
    Menu.setApplicationMenu(buildMenu());
    registerIpc();
    initRuntime(broadcast);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });

  // Stop running turns and the Letta runtime, then exit. `app.exit` is used
  // for the second step because the quit sequence was already interrupted once.
  app.on("before-quit", (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const timeout = new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS));
    void Promise.race([disconnect(), timeout]).finally(() => app.exit(0));
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => app.quit());
  }
}
