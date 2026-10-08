import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppSettings, BackendKind, PermissionMode, SettingsUpdate } from "../types.js";

/**
 * App settings, persisted as JSON in the user data directory.
 *
 * Environment variables (LETTA_BACKEND, LETTA_API_KEY, LETTA_BASE_URL,
 * LETTA_SERVER_URL, LETTA_SERVER_TOKEN or LETTA_APP_SERVER_TOKEN) act as defaults for anything the user
 * has not set in the Settings dialog, so a `.env` file keeps working in
 * development.
 */

type StoredSettings = {
  backend?: BackendKind;
  serverUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  serverToken?: string;
  permissionMode?: PermissionMode;
  agentIds?: Partial<Record<BackendKind, string>>;
  recentCwds?: string[];
  conversationCwds?: Record<string, string>;
};

export type ConnectionConfig = {
  backend: BackendKind;
  serverUrl: string;
  serverToken: string;
  apiKey: string;
  apiBaseUrl: string;
};

const BACKENDS: BackendKind[] = ["local", "cloud", "remote"];
const PERMISSION_MODES: PermissionMode[] = ["standard", "acceptEdits", "unrestricted", "strict"];
const MAX_RECENT_CWDS = 8;
const MAX_CONVERSATION_CWDS = 500;

let cache: StoredSettings | null = null;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function load(): StoredSettings {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(settingsPath(), "utf8")) as StoredSettings;
  } catch {
    cache = {};
  }
  return cache;
}

function save(next: StoredSettings): void {
  cache = next;
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
}

// Secrets are encrypted with the OS keychain when it is available. Without one
// (some Linux setups) they fall back to the 0600 settings file.
function encodeSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString("base64")}`;
  }
  return `raw:${value}`;
}

function decodeSecret(stored: string | undefined): string {
  if (!stored) return "";
  try {
    if (stored.startsWith("enc:")) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
    }
    if (stored.startsWith("raw:")) return stored.slice(4);
  } catch {
    // An undecryptable secret (e.g. a keychain reset) is treated as unset.
  }
  return "";
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getConnectionConfig(): ConnectionConfig {
  const stored = load();
  const apiKey = decodeSecret(stored.apiKey) || env("LETTA_API_KEY");
  const envBackend = env("LETTA_BACKEND").toLowerCase() as BackendKind;
  const backend =
    stored.backend ??
    (BACKENDS.includes(envBackend) ? envBackend : apiKey ? "cloud" : "local");
  return {
    backend,
    apiKey,
    serverUrl: stored.serverUrl ?? env("LETTA_SERVER_URL"),
    serverToken:
      decodeSecret(stored.serverToken) ||
      env("LETTA_SERVER_TOKEN") ||
      env("LETTA_APP_SERVER_TOKEN"),
    apiBaseUrl: stored.apiBaseUrl ?? env("LETTA_BASE_URL"),
  };
}

export function getSettings(): AppSettings {
  const stored = load();
  const config = getConnectionConfig();
  return {
    backend: config.backend,
    serverUrl: config.serverUrl,
    apiBaseUrl: config.apiBaseUrl,
    hasApiKey: config.apiKey.length > 0,
    hasServerToken: config.serverToken.length > 0,
    permissionMode: stored.permissionMode ?? "standard",
    agentId: stored.agentIds?.[config.backend] ?? null,
    recentCwds: stored.recentCwds ?? [],
    defaultCwd: homedir(),
  };
}

/** Apply an update and report whether the backend connection must be rebuilt. */
export function updateSettings(update: SettingsUpdate): { connectionChanged: boolean } {
  const before = JSON.stringify(getConnectionConfig());
  const next: StoredSettings = { ...load() };

  if (update.backend && BACKENDS.includes(update.backend)) next.backend = update.backend;
  if (update.serverUrl !== undefined) next.serverUrl = update.serverUrl.trim();
  if (update.apiBaseUrl !== undefined) next.apiBaseUrl = update.apiBaseUrl.trim();
  if (update.apiKey !== undefined) {
    next.apiKey = update.apiKey ? encodeSecret(update.apiKey.trim()) : undefined;
  }
  if (update.serverToken !== undefined) {
    next.serverToken = update.serverToken ? encodeSecret(update.serverToken.trim()) : undefined;
  }
  if (update.permissionMode && PERMISSION_MODES.includes(update.permissionMode)) {
    next.permissionMode = update.permissionMode;
  }
  save(next);

  if (update.agentId !== undefined) setAgentId(update.agentId);
  return { connectionChanged: before !== JSON.stringify(getConnectionConfig()) };
}

export function setAgentId(agentId: string | null): void {
  const stored = load();
  const backend = getConnectionConfig().backend;
  const agentIds = { ...stored.agentIds };
  if (agentId) agentIds[backend] = agentId;
  else delete agentIds[backend];
  save({ ...stored, agentIds });
}

export function getPermissionMode(): PermissionMode {
  return load().permissionMode ?? "standard";
}

export function getConversationCwd(conversationId: string): string | null {
  return load().conversationCwds?.[conversationId] ?? null;
}

/** Remember the working directory a conversation ran in. */
export function rememberCwd(conversationId: string, cwd: string): void {
  const stored = load();
  if (stored.conversationCwds?.[conversationId] === cwd && stored.recentCwds?.[0] === cwd) return;

  const recentCwds = [cwd, ...(stored.recentCwds ?? []).filter((item) => item !== cwd)].slice(
    0,
    MAX_RECENT_CWDS,
  );
  const entries = Object.entries({ ...stored.conversationCwds, [conversationId]: cwd });
  const conversationCwds = Object.fromEntries(entries.slice(-MAX_CONVERSATION_CWDS));
  save({ ...stored, recentCwds, conversationCwds });
}

export function forgetConversation(conversationId: string): void {
  const stored = load();
  if (!stored.conversationCwds?.[conversationId]) return;
  const conversationCwds = { ...stored.conversationCwds };
  delete conversationCwds[conversationId];
  save({ ...stored, conversationCwds });
}
