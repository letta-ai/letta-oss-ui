/// <reference types="vite/client" />

interface Window {
  /** Bridge to the Electron main process, exposed by src/electron/preload.cts. */
  cowork: import("../electron/types").AppBridge;
}
