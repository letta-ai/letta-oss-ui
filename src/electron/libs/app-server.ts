import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The Letta Code app server this app owns.
 *
 * The SDK can spawn its own server per session, but it launches the CLI with
 * `process.execPath`, which inside Electron is the Electron binary. Starting it
 * here lets us set ELECTRON_RUN_AS_NODE so the CLI runs as a plain Node script,
 * and gives every session one shared, long-lived server instead of a process
 * per conversation.
 */

export type AppServerHandle = {
  url: string;
  close(): void;
  /** Called if the server exits on its own after startup. */
  onExit(listener: (detail: string) => void): void;
};

export type AppServerOptions = {
  /** "local": agents stored on this machine. "api": agents stored in Letta Cloud. */
  harnessBackend: "local" | "api";
  env?: Record<string, string>;
};

const LISTENING_RE = /^Listening on\s+(ws:\/\/\S+)\s*$/m;
const STARTUP_TIMEOUT_MS = 30_000;
const MAX_LOG_CHARS = 4_000;

const require = createRequire(import.meta.url);

function findCli(): string {
  const override = process.env.LETTA_CLI_PATH;
  if (override && existsSync(override)) return override;
  // In a packaged app the CLI and its native dependencies are unpacked from
  // the asar archive (see asarUnpack in electron-builder.json), because the CLI
  // runs as its own process and launches helper binaries.
  return require
    .resolve("@letta-ai/letta-code")
    .replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 1_000).unref();
}

export function startAppServer(options: AppServerOptions): Promise<AppServerHandle> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [findCli(), "--backend", options.harnessBackend, "server", "--listen", "ws://127.0.0.1:0"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );

    let output = "";
    let started = false;
    let exitListener: ((detail: string) => void) | null = null;

    const timeout = setTimeout(() => {
      fail(new Error("Timed out waiting for the Letta runtime to start."));
    }, STARTUP_TIMEOUT_MS);

    const fail = (error: Error) => {
      if (started) return;
      started = true;
      clearTimeout(timeout);
      terminate(child);
      reject(error);
    };

    const onOutput = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-MAX_LOG_CHARS);
      if (started) return;
      const url = output.match(LISTENING_RE)?.[1];
      if (!url) return;
      started = true;
      clearTimeout(timeout);
      resolve({
        url,
        close: () => {
          exitListener = null;
          terminate(child);
        },
        onExit: (listener) => {
          exitListener = listener;
        },
      });
    };

    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.on("error", (error) => fail(error));
    child.on("exit", (code, signal) => {
      const detail = output.trim().split("\n").slice(-5).join("\n");
      if (!started) {
        fail(new Error(detail || `The Letta runtime exited before starting (${signal ?? code}).`));
        return;
      }
      exitListener?.(detail || `The Letta runtime stopped (${signal ?? code}).`);
    });
  });
}
