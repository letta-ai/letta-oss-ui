import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSummary,
  AppBridge,
  AppSettings,
  ChatRow,
  ConversationSummary,
} from "../../src/ui/types";

type Store = typeof import("../../src/ui/store");

const settings: AppSettings = {
  backend: "local",
  serverUrl: "",
  apiBaseUrl: "",
  hasApiKey: false,
  hasServerToken: false,
  permissionMode: "standard",
  agentId: "agent-2",
  recentCwds: ["/recent"],
  defaultCwd: "/home",
};

const agents: AgentSummary[] = [
  { id: "agent-1", name: "One", description: null, model: "provider/one" },
  { id: "agent-2", name: "Two", description: null, model: "provider/two" },
];

const conversation = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  agentId: "agent-2",
  title: id,
  updatedAt: 1,
  model: null,
  cwd: null,
  ...extra,
});

const assistant = (key: string, text: string): ChatRow => ({ kind: "assistant", key, text });

/** A bridge where every request resolves with something sensible. */
function createBridge() {
  return {
    platform: "darwin",
    onEvent: vi.fn(() => () => undefined),
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async () => settings),
    getConnection: vi.fn(),
    reconnect: vi.fn(),
    listAgents: vi.fn(async () => agents),
    createAgent: vi.fn(),
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(async () => undefined),
    listModels: vi.fn(async () => []),
    listProviders: vi.fn(async () => []),
    connectProvider: vi.fn(),
    disconnectProvider: vi.fn(),
    listMemory: vi.fn(async () => ({ enabled: true, files: [] })),
    readMemoryFile: vi.fn(),
    writeMemoryFile: vi.fn(),
    deleteMemoryFile: vi.fn(),
    listMemoryHistory: vi.fn(),
    readMemoryFileAt: vi.fn(),
    listConversations: vi.fn(async () => [conversation("conv-1")]),
    loadHistory: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    sendMessage: vi.fn(),
    stopTurn: vi.fn(),
    respondApproval: vi.fn(),
    selectDirectory: vi.fn(),
  } satisfies Record<keyof AppBridge, unknown>;
}

let bridge: ReturnType<typeof createBridge>;
let useAppStore: Store["useAppStore"];
let selectCwd: Store["selectCwd"];
let selectModel: Store["selectModel"];

const state = () => useAppStore.getState();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Bring the store to a connected state with agent-2 selected. */
async function connect() {
  state().handleEvent({
    type: "connection",
    state: { status: "ready", backend: "local", detail: "This computer", providers: false },
  });
  await flush();
}

beforeEach(async () => {
  bridge = createBridge();
  vi.stubGlobal("window", { bridge });
  vi.stubGlobal("crypto", { randomUUID: () => "otid-1" });
  // The store reads the bridge when its module loads, so load it fresh.
  vi.resetModules();
  ({ useAppStore, selectCwd, selectModel } = await import("../../src/ui/store"));
});

describe("connection", () => {
  it("loads agents when the backend becomes ready and selects the remembered one", async () => {
    await connect();
    expect(state().agents).toEqual(agents);
    expect(state().agentId).toBe("agent-2");
    expect(state().conversations.map((item) => item.id)).toEqual(["conv-1"]);
  });

  it("falls back to the first agent when the remembered one is gone", async () => {
    bridge.getSettings.mockResolvedValue({ ...settings, agentId: "deleted" });
    await connect();
    expect(state().agentId).toBe("agent-1");
  });

  it("clears agents and chats when the connection is lost", async () => {
    await connect();
    state().handleEvent({
      type: "connection",
      state: { status: "error", backend: "local", error: "gone" },
    });
    expect(state().agents).toEqual([]);
    expect(state().agentId).toBeNull();
    expect(state().conversations).toEqual([]);
  });

  it("loads providers only when the server keeps its own keys", async () => {
    await connect();
    expect(bridge.listProviders).not.toHaveBeenCalled();

    state().handleEvent({ type: "connection", state: { status: "connecting", backend: "local" } });
    state().handleEvent({
      type: "connection",
      state: { status: "ready", backend: "local", detail: "This computer", providers: true },
    });
    await flush();
    expect(bridge.listProviders).toHaveBeenCalledOnce();
  });
});

describe("turn events", () => {
  it("builds a chat from streamed rows", () => {
    const { handleEvent } = state();
    handleEvent({ type: "turn.started", conversationId: "c" });
    handleEvent({ type: "turn.rows", conversationId: "c", rows: [assistant("a1", "He")] });
    handleEvent({ type: "turn.rows", conversationId: "c", rows: [assistant("a1", "Hello")] });
    handleEvent({ type: "turn.activity", conversationId: "c", activity: "Responding" });

    expect(state().chats.c).toMatchObject({
      running: true,
      activity: "Responding",
      rows: [assistant("a1", "Hello")],
    });
  });

  it("drops the rows of an abandoned attempt when a turn retries", () => {
    const { handleEvent } = state();
    handleEvent({ type: "turn.rows", conversationId: "c", rows: [assistant("a1", "x"), assistant("a2", "y")] });
    handleEvent({ type: "turn.rows.removed", conversationId: "c", keys: ["a2"] });
    expect(state().chats.c?.rows).toEqual([assistant("a1", "x")]);
  });

  it("settles the chat when the turn finishes, keeping any error", () => {
    const { handleEvent } = state();
    handleEvent({ type: "turn.started", conversationId: "c" });
    handleEvent({
      type: "approval.requested",
      conversationId: "c",
      request: { requestId: "r1", toolCallId: null, toolName: "Bash", input: {}, suggestions: [] },
    });
    handleEvent({ type: "turn.finished", conversationId: "c", error: "No credit" });

    expect(state().chats.c).toMatchObject({
      running: false,
      activity: null,
      approvals: [],
      error: "No credit",
    });
  });

  it("tracks approval requests without duplicating a repeated one", () => {
    const { handleEvent } = state();
    const request = { requestId: "r1", toolCallId: null, toolName: "Bash", input: {}, suggestions: [] };
    handleEvent({ type: "approval.requested", conversationId: "c", request });
    handleEvent({ type: "approval.requested", conversationId: "c", request });
    expect(state().chats.c?.approvals).toHaveLength(1);

    handleEvent({ type: "approval.resolved", conversationId: "c", requestId: "r1" });
    expect(state().chats.c?.approvals).toEqual([]);
  });

  it("ignores conversation updates that belong to another agent", async () => {
    await connect();
    state().handleEvent({
      type: "conversation.updated",
      conversation: conversation("other", { agentId: "agent-1" }),
    });
    expect(state().conversations.map((item) => item.id)).toEqual(["conv-1"]);
  });
});

describe("sending", () => {
  beforeEach(connect);

  it("starts a new chat, showing the message before the conversation exists", async () => {
    let finish!: (value: ConversationSummary) => void;
    bridge.sendMessage.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    state().setDraft("build it");

    const sending = state().send("build it");
    expect(state().pendingFirstMessage).toMatchObject({ kind: "user", text: "build it" });
    expect(state().drafts.new).toBeUndefined();
    expect(bridge.sendMessage).toHaveBeenCalledWith({
      agentId: "agent-2",
      conversationId: null,
      text: "build it",
      otid: "otid-1",
      cwd: "/recent",
    });

    // The turn can start streaming before the request that created it returns.
    state().handleEvent({ type: "turn.started", conversationId: "new-conv" });
    state().handleEvent({ type: "turn.rows", conversationId: "new-conv", rows: [assistant("a1", "On it")] });
    finish(conversation("new-conv", { updatedAt: 5 }));
    await sending;

    expect(state().activeId).toBe("new-conv");
    expect(state().pendingFirstMessage).toBeNull();
    expect(state().chats["new-conv"]?.rows.map((row) => row.kind)).toEqual(["user", "assistant"]);
    expect(state().chats["new-conv"]?.running).toBe(true);
    expect(state().conversations[0]?.id).toBe("new-conv");
  });

  it("adds the message to an open chat right away", async () => {
    bridge.sendMessage.mockResolvedValue(conversation("conv-1"));
    useAppStore.setState({ activeId: "conv-1" });

    await state().send("  next step  ");
    expect(state().chats["conv-1"]).toMatchObject({ running: true, error: null });
    expect(state().chats["conv-1"]?.rows).toEqual([
      { kind: "user", key: "user:otid:otid-1", text: "next step", otid: "otid-1" },
    ]);
  });

  it("puts the message back in the composer when sending fails", async () => {
    bridge.sendMessage.mockRejectedValue(new Error("Runtime stopped"));
    useAppStore.setState({ activeId: "conv-1" });

    await state().send("try this");
    expect(state().drafts["conv-1"]).toBe("try this");
    expect(state().notice).toBe("Runtime stopped");
    expect(state().chats["conv-1"]).toMatchObject({ running: false, rows: [] });
  });

  it("does not send while the chat is still working, or when the text is blank", async () => {
    useAppStore.setState({ activeId: "conv-1" });
    state().handleEvent({ type: "turn.started", conversationId: "conv-1" });
    await state().send("again");
    await state().send("   ");
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a model only when the user picked a different one for the chat", async () => {
    bridge.sendMessage.mockResolvedValue(conversation("conv-1"));
    useAppStore.setState({
      activeId: "conv-1",
      conversations: [conversation("conv-1", { model: "provider/current" })],
    });

    state().setModel("provider/current");
    await state().send("same model");
    expect(bridge.sendMessage.mock.lastCall?.[0]).not.toHaveProperty("model");

    state().handleEvent({ type: "turn.finished", conversationId: "conv-1" });
    state().setModel("provider/other");
    await state().send("new model");
    expect(bridge.sendMessage.mock.lastCall?.[0]).toMatchObject({ model: "provider/other" });
    expect(state().modelOverrides["conv-1"]).toBeUndefined();
  });
});

describe("selectors", () => {
  beforeEach(connect);

  it("picks a chat's folder: composer choice, then the chat's own, then recent, then home", () => {
    useAppStore.setState({ conversations: [conversation("conv-1", { cwd: "/chat" })] });
    expect(selectCwd(state(), "new")).toBe("/recent");
    expect(selectCwd(state(), "conv-1")).toBe("/chat");

    useAppStore.setState({ activeId: "conv-1" });
    state().setCwd("/picked");
    expect(selectCwd(state(), "conv-1")).toBe("/picked");

    useAppStore.setState({ settings: { ...settings, recentCwds: [] } });
    expect(selectCwd(state(), "new")).toBe("/home");
  });

  it("picks a chat's model: composer choice, then the chat's own, then the agent's default", () => {
    expect(selectModel(state(), "new")).toBe("provider/two");
    useAppStore.setState({ conversations: [conversation("conv-1", { model: "provider/chat" })] });
    expect(selectModel(state(), "conv-1")).toBe("provider/chat");
  });
});

describe("agents", () => {
  beforeEach(connect);

  it("moves to another agent after the selected one is deleted", async () => {
    bridge.listAgents.mockResolvedValue([agents[0]!]);
    bridge.getSettings.mockResolvedValue({ ...settings, agentId: null });
    useAppStore.setState({ agentSettingsOpen: true });

    await state().deleteAgent();
    expect(bridge.deleteAgent).toHaveBeenCalledWith("agent-2");
    expect(state().agentSettingsOpen).toBe(false);
    expect(state().agentId).toBe("agent-1");
  });

  it("shows the empty state when the last agent is deleted", async () => {
    bridge.listAgents.mockResolvedValue([]);
    useAppStore.setState({ activeId: "conv-1", view: "memory" });

    await state().deleteAgent();
    expect(state()).toMatchObject({ agentId: null, activeId: null, view: "chat", conversations: [] });
  });

  it("replaces the agent in the list after an update", async () => {
    bridge.updateAgent.mockResolvedValue({ ...agents[1]!, name: "Renamed" });
    await state().updateAgent({ name: "Renamed" });
    expect(bridge.updateAgent).toHaveBeenCalledWith("agent-2", { name: "Renamed" });
    expect(state().agents.find((agent) => agent.id === "agent-2")?.name).toBe("Renamed");
  });
});
