import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Settings = typeof import("../../src/electron/libs/settings");

let userData: string;
let encryptionAvailable: boolean;
let settings: Settings;

// A stand-in for the OS keychain: reversible, and clearly not the plain text.
vi.mock("electron", () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
  },
}));

const savedFile = () => readFileSync(join(userData, "settings.json"), "utf8");

/** Load the module again, as a restarted app would. */
async function restart() {
  vi.resetModules();
  settings = await import("../../src/electron/libs/settings");
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), "oss-ui-settings-"));
  encryptionAvailable = true;
  for (const name of [
    "LETTA_BACKEND",
    "LETTA_API_KEY",
    "LETTA_BASE_URL",
    "LETTA_SERVER_URL",
    "LETTA_SERVER_TOKEN",
    "LETTA_APP_SERVER_TOKEN",
  ]) {
    vi.stubEnv(name, "");
  }
  await restart();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(userData, { recursive: true, force: true });
});

describe("backend selection", () => {
  it("defaults to the local backend", () => {
    expect(settings.getSettings()).toMatchObject({ backend: "local", hasApiKey: false, permissionMode: "standard" });
  });

  it("uses Letta Cloud when only an API key is in the environment", () => {
    vi.stubEnv("LETTA_API_KEY", "sk-env");
    expect(settings.getConnectionConfig()).toMatchObject({ backend: "cloud", apiKey: "sk-env" });
  });

  it("follows LETTA_BACKEND, and ignores a value it does not know", () => {
    vi.stubEnv("LETTA_BACKEND", "REMOTE");
    vi.stubEnv("LETTA_SERVER_URL", "ws://server:4500");
    expect(settings.getConnectionConfig()).toMatchObject({ backend: "remote", serverUrl: "ws://server:4500" });

    vi.stubEnv("LETTA_BACKEND", "nonsense");
    expect(settings.getConnectionConfig().backend).toBe("local");
  });

  it("lets a saved choice win over the environment", () => {
    vi.stubEnv("LETTA_BACKEND", "cloud");
    settings.updateSettings({ backend: "local" });
    expect(settings.getSettings().backend).toBe("local");
  });

  it("accepts either name for the server token", () => {
    vi.stubEnv("LETTA_APP_SERVER_TOKEN", "from-docs");
    expect(settings.getConnectionConfig().serverToken).toBe("from-docs");
    vi.stubEnv("LETTA_SERVER_TOKEN", "preferred");
    expect(settings.getConnectionConfig().serverToken).toBe("preferred");
  });
});

describe("secrets", () => {
  it("stores the API key encrypted and reads it back after a restart", async () => {
    settings.updateSettings({ backend: "cloud", apiKey: " sk-secret " });
    expect(savedFile()).not.toContain("sk-secret");
    expect(settings.getSettings().hasApiKey).toBe(true);

    await restart();
    expect(settings.getConnectionConfig().apiKey).toBe("sk-secret");
  });

  it("still works when the system has no keychain", async () => {
    encryptionAvailable = false;
    settings.updateSettings({ serverToken: "token-1" });
    await restart();
    expect(settings.getConnectionConfig().serverToken).toBe("token-1");
  });

  it("clears a secret when given null and keeps it when left out", () => {
    settings.updateSettings({ apiKey: "sk-secret" });
    settings.updateSettings({ permissionMode: "acceptEdits" });
    expect(settings.getSettings().hasApiKey).toBe(true);

    settings.updateSettings({ apiKey: null });
    expect(settings.getSettings().hasApiKey).toBe(false);
  });
});

describe("updateSettings", () => {
  it("reports when the connection has to be rebuilt", () => {
    expect(settings.updateSettings({ backend: "remote", serverUrl: "ws://a:1" }).connectionChanged).toBe(true);
    expect(settings.updateSettings({ serverUrl: "ws://a:1" }).connectionChanged).toBe(false);
    expect(settings.updateSettings({ permissionMode: "unrestricted" }).connectionChanged).toBe(false);
    expect(settings.updateSettings({ serverToken: "t" }).connectionChanged).toBe(true);
  });

  it("ignores a permission mode it does not know", () => {
    settings.updateSettings({ permissionMode: "everything" as never });
    expect(settings.getPermissionMode()).toBe("standard");
  });

  it("remembers a selected agent for each backend separately", () => {
    settings.updateSettings({ agentId: "agent-local" });
    settings.updateSettings({ backend: "remote", serverUrl: "ws://a:1" });
    expect(settings.getSettings().agentId).toBeNull();

    settings.updateSettings({ agentId: "agent-remote" });
    settings.updateSettings({ backend: "local" });
    expect(settings.getSettings().agentId).toBe("agent-local");

    settings.setAgentId(null);
    expect(settings.getSettings().agentId).toBeNull();
  });
});

describe("working folders", () => {
  it("remembers each chat's folder and the most recent folders first", () => {
    settings.rememberCwd("conv-1", "/a");
    settings.rememberCwd("conv-2", "/b");
    settings.rememberCwd("conv-3", "/a");

    expect(settings.getConversationCwd("conv-2")).toBe("/b");
    expect(settings.getSettings().recentCwds).toEqual(["/a", "/b"]);
  });

  it("keeps a short list of recent folders", () => {
    for (let index = 0; index < 12; index++) settings.rememberCwd(`conv-${index}`, `/dir-${index}`);
    const recent = settings.getSettings().recentCwds;
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe("/dir-11");
  });

  it("forgets a chat's folder when the chat is removed", () => {
    settings.rememberCwd("conv-1", "/a");
    settings.forgetConversation("conv-1");
    expect(settings.getConversationCwd("conv-1")).toBeNull();
  });
});
