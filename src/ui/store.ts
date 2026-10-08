import { create } from "zustand";
import { mergeHistory, optimisticUserRow, rowIdentity, upsertRows } from "./lib/rows";
import type {
  AgentSummary,
  AppEvent,
  AppSettings,
  ApprovalDecision,
  ApprovalRequest,
  ChatRow,
  ChatTextRow,
  ConnectionState,
  ConversationSummary,
  ModelOption,
  SettingsUpdate,
} from "./types";

const api = window.cowork;

/** Key for the chat that has not been sent yet. */
export const NEW_CHAT = "new";
const HISTORY_PAGE = 100;

export type ChatState = {
  rows: ChatRow[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  limit: number;
  running: boolean;
  activity: string | null;
  error: string | null;
  approvals: ApprovalRequest[];
};

const EMPTY_CHAT: ChatState = {
  rows: [],
  loaded: false,
  loading: false,
  hasMore: false,
  limit: HISTORY_PAGE,
  running: false,
  activity: null,
  error: null,
  approvals: [],
};

type AppState = {
  settings: AppSettings | null;
  connection: ConnectionState | null;
  agents: AgentSummary[];
  agentsLoaded: boolean;
  agentId: string | null;
  models: ModelOption[];
  conversations: ConversationSummary[];
  conversationsLoaded: boolean;
  /** null is the new, unsent chat. */
  activeId: string | null;
  chats: Record<string, ChatState>;
  /** Unsent composer text per chat. */
  drafts: Record<string, string>;
  /** Working directory and model picked in the composer but not yet sent. */
  cwdOverrides: Record<string, string>;
  modelOverrides: Record<string, string>;
  /** The first message of a new chat, shown while its conversation is created. */
  pendingFirstMessage: ChatTextRow | null;
  notice: string | null;
  settingsOpen: boolean;
  newAgentOpen: boolean;

  bootstrap: () => Promise<void>;
  handleEvent: (event: AppEvent) => void;
  refreshAgents: () => Promise<void>;
  selectAgent: (agentId: string) => Promise<void>;
  createAgent: (input: { name: string; model?: string }) => Promise<void>;
  openChat: (conversationId: string | null) => void;
  loadHistory: (conversationId: string, limit?: number) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  respondApproval: (requestId: string, decision: ApprovalDecision) => void;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  archiveConversation: (conversationId: string) => Promise<void>;
  saveSettings: (update: SettingsUpdate) => Promise<void>;
  reconnect: () => void;
  pickCwd: () => Promise<void>;
  setCwd: (cwd: string) => void;
  setModel: (handle: string) => void;
  setDraft: (text: string) => void;
  setNotice: (notice: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewAgentOpen: (open: boolean) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function patchChat(
  state: AppState,
  conversationId: string,
  patch: (chat: ChatState) => Partial<ChatState>,
): Pick<AppState, "chats"> {
  const chat = state.chats[conversationId] ?? EMPTY_CHAT;
  return { chats: { ...state.chats, [conversationId]: { ...chat, ...patch(chat) } } };
}

function upsertConversation(
  list: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  return [conversation, ...list.filter((item) => item.id !== conversation.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

const CLEARED = {
  agents: [],
  agentsLoaded: false,
  agentId: null,
  models: [],
  conversations: [],
  conversationsLoaded: false,
  activeId: null,
  chats: {},
  pendingFirstMessage: null,
} satisfies Partial<AppState>;

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  connection: null,
  ...CLEARED,
  drafts: {},
  cwdOverrides: {},
  modelOverrides: {},
  notice: null,
  settingsOpen: false,
  newAgentOpen: false,

  bootstrap: async () => {
    const [settings, connection] = await Promise.all([api.getSettings(), api.getConnection()]);
    set({ settings });
    get().handleEvent({ type: "connection", state: connection });
  },

  handleEvent: (event) => {
    switch (event.type) {
      case "connection": {
        const previous = get().connection;
        set({ connection: event.state });
        if (event.state.status === "ready" && previous?.status !== "ready") {
          void get().refreshAgents();
        } else if (event.state.status !== "ready" && previous?.status === "ready") {
          // Agents and conversations belong to the backend that just went away.
          set(CLEARED);
        }
        break;
      }
      case "turn.started":
        set((state) =>
          patchChat(state, event.conversationId, () => ({
            running: true,
            error: null,
            activity: "Starting",
          })),
        );
        break;
      case "turn.rows":
        set((state) =>
          patchChat(state, event.conversationId, (chat) => ({
            rows: upsertRows(chat.rows, event.rows),
          })),
        );
        break;
      case "turn.rows.removed": {
        const removed = new Set(event.keys);
        set((state) =>
          patchChat(state, event.conversationId, (chat) => ({
            rows: chat.rows.filter((row) => !removed.has(row.key)),
          })),
        );
        break;
      }
      case "turn.activity":
        set((state) =>
          patchChat(state, event.conversationId, () => ({ activity: event.activity })),
        );
        break;
      case "turn.finished":
        set((state) =>
          patchChat(state, event.conversationId, () => ({
            running: false,
            activity: null,
            approvals: [],
            error: event.error ?? null,
          })),
        );
        break;
      case "approval.requested":
        set((state) =>
          patchChat(state, event.conversationId, (chat) => ({
            approvals: [
              ...chat.approvals.filter((item) => item.requestId !== event.request.requestId),
              event.request,
            ],
          })),
        );
        break;
      case "approval.resolved":
        set((state) =>
          patchChat(state, event.conversationId, (chat) => ({
            approvals: chat.approvals.filter((item) => item.requestId !== event.requestId),
          })),
        );
        break;
      case "conversation.updated":
        if (event.conversation.agentId !== get().agentId) break;
        set((state) => ({
          conversations: upsertConversation(state.conversations, event.conversation),
        }));
        break;
      case "menu":
        if (event.command === "new-chat") get().openChat(null);
        else set({ settingsOpen: true });
        break;
    }
  },

  refreshAgents: async () => {
    try {
      const [agents, settings] = await Promise.all([api.listAgents(), api.getSettings()]);
      set({ agents, agentsLoaded: true, settings });
      void api
        .listModels()
        .then((models) => set({ models }))
        .catch(() => undefined);

      const agentId =
        agents.find((agent) => agent.id === settings.agentId)?.id ?? agents[0]?.id ?? null;
      if (agentId) await get().selectAgent(agentId);
      else set({ agentId: null, conversations: [], conversationsLoaded: true });
    } catch (error) {
      set({ agentsLoaded: true, notice: errorMessage(error) });
    }
  },

  selectAgent: async (agentId) => {
    set({
      agentId,
      conversations: [],
      conversationsLoaded: false,
      activeId: null,
      pendingFirstMessage: null,
    });
    void api
      .updateSettings({ agentId })
      .then((settings) => set({ settings }))
      .catch(() => undefined);
    try {
      const conversations = await api.listConversations(agentId);
      if (get().agentId === agentId) set({ conversations, conversationsLoaded: true });
    } catch (error) {
      if (get().agentId === agentId) {
        set({ conversationsLoaded: true, notice: errorMessage(error) });
      }
    }
  },

  createAgent: async (input) => {
    const agent = await api.createAgent(input);
    set((state) => ({ agents: [agent, ...state.agents.filter((item) => item.id !== agent.id)] }));
    await get().selectAgent(agent.id);
  },

  openChat: (conversationId) => {
    set({ activeId: conversationId });
    if (!conversationId) return;
    const chat = get().chats[conversationId];
    if (!chat?.loaded && !chat?.loading) void get().loadHistory(conversationId);
  },

  loadHistory: async (conversationId, limit) => {
    const pageSize = limit ?? get().chats[conversationId]?.limit ?? HISTORY_PAGE;
    set((state) => patchChat(state, conversationId, () => ({ loading: true, limit: pageSize })));
    try {
      const history = await api.loadHistory(conversationId, pageSize);
      set((state) =>
        patchChat(state, conversationId, (chat) => ({
          rows: mergeHistory(history.rows, chat.rows),
          loaded: true,
          loading: false,
          hasMore: history.hasMore,
          running: history.running,
          activity: history.running ? (chat.activity ?? history.activity) : null,
          approvals: history.approvals,
        })),
      );
    } catch (error) {
      set((state) =>
        patchChat(state, conversationId, () => ({
          loaded: true,
          loading: false,
          error: errorMessage(error),
        })),
      );
    }
  },

  send: async (rawText) => {
    const text = rawText.trim();
    const state = get();
    const { agentId, activeId } = state;
    if (!text || !agentId) return;
    const key = activeId ?? NEW_CHAT;
    if (activeId ? state.chats[activeId]?.running : state.pendingFirstMessage) return;

    const otid = crypto.randomUUID();
    const userRow = optimisticUserRow(text, otid);
    const cwd = selectCwd(state, key);
    const pickedModel = state.modelOverrides[key];
    const currentModel = state.conversations.find((item) => item.id === activeId)?.model;
    const model = pickedModel && pickedModel !== currentModel ? pickedModel : undefined;

    const clearComposer = (id: string) => (current: AppState) => {
      const drafts = { ...current.drafts };
      const cwdOverrides = { ...current.cwdOverrides };
      const modelOverrides = { ...current.modelOverrides };
      delete drafts[id];
      delete cwdOverrides[id];
      delete modelOverrides[id];
      return { drafts, cwdOverrides, modelOverrides };
    };

    if (activeId) {
      set((current) => ({
        ...clearComposer(activeId)(current),
        ...patchChat(current, activeId, (chat) => ({
          rows: upsertRows(chat.rows, [userRow]),
          running: true,
          error: null,
          activity: "Starting",
        })),
      }));
    } else {
      set((current) => ({ ...clearComposer(NEW_CHAT)(current), pendingFirstMessage: userRow }));
    }

    try {
      const conversation = await api.sendMessage({
        agentId,
        conversationId: activeId,
        text,
        otid,
        cwd,
        ...(model ? { model } : {}),
      });
      set((current) => ({
        conversations: upsertConversation(current.conversations, {
          ...conversation,
          model: model ?? conversation.model,
        }),
        ...(activeId
          ? {}
          : {
              // The turn may already be streaming into this conversation; the
              // first message always leads it.
              ...patchChat(current, conversation.id, (chat) => ({
                rows: upsertRows([userRow], chat.rows),
                loaded: true,
              })),
              pendingFirstMessage: null,
              activeId:
                current.pendingFirstMessage === userRow && current.activeId === null
                  ? conversation.id
                  : current.activeId,
            }),
      }));
    } catch (error) {
      // Nothing was sent: put the message back in the composer.
      set((current) => ({
        drafts: { ...current.drafts, [key]: current.drafts[key] || text },
        notice: errorMessage(error),
        ...(activeId
          ? patchChat(current, activeId, (chat) => ({
              rows: chat.rows.filter((row) => rowIdentity(row) !== rowIdentity(userRow)),
              running: false,
              activity: null,
            }))
          : { pendingFirstMessage: null }),
      }));
    }
  },

  stop: () => {
    const { activeId } = get();
    if (activeId) void api.stopTurn(activeId);
  },

  respondApproval: (requestId, decision) => {
    const { activeId } = get();
    if (!activeId) return;
    set((state) =>
      patchChat(state, activeId, (chat) => ({
        approvals: chat.approvals.filter((item) => item.requestId !== requestId),
      })),
    );
    void api.respondApproval(activeId, requestId, decision);
  },

  renameConversation: async (conversationId, title) => {
    try {
      const conversation = await api.renameConversation(conversationId, title);
      set((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === conversationId ? { ...item, title: conversation.title } : item,
        ),
      }));
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  archiveConversation: async (conversationId) => {
    try {
      await api.archiveConversation(conversationId);
      set((state) => {
        const chats = { ...state.chats };
        delete chats[conversationId];
        return {
          chats,
          conversations: state.conversations.filter((item) => item.id !== conversationId),
          activeId: state.activeId === conversationId ? null : state.activeId,
        };
      });
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  saveSettings: async (update) => {
    set({ settings: await api.updateSettings(update) });
  },

  reconnect: () => {
    void api.reconnect();
  },

  pickCwd: async () => {
    const directory = await api.selectDirectory();
    if (directory) get().setCwd(directory);
  },

  setCwd: (cwd) =>
    set((state) => ({
      cwdOverrides: { ...state.cwdOverrides, [state.activeId ?? NEW_CHAT]: cwd },
    })),

  setModel: (handle) =>
    set((state) => ({
      modelOverrides: { ...state.modelOverrides, [state.activeId ?? NEW_CHAT]: handle },
    })),

  setDraft: (text) =>
    set((state) => ({ drafts: { ...state.drafts, [state.activeId ?? NEW_CHAT]: text } })),

  setNotice: (notice) => set({ notice }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNewAgentOpen: (newAgentOpen) => set({ newAgentOpen }),
}));

// --- Selectors --------------------------------------------------------------

type Selectable = Pick<
  AppState,
  "settings" | "conversations" | "cwdOverrides" | "modelOverrides" | "agents" | "agentId"
>;

/** Working directory the next message in a chat will run in. */
export function selectCwd(state: Selectable, key: string): string {
  return (
    state.cwdOverrides[key] ??
    state.conversations.find((item) => item.id === key)?.cwd ??
    state.settings?.recentCwds[0] ??
    state.settings?.defaultCwd ??
    ""
  );
}

/** Model the next message in a chat will use. */
export function selectModel(state: Selectable, key: string): string | null {
  return (
    state.modelOverrides[key] ??
    state.conversations.find((item) => item.id === key)?.model ??
    state.agents.find((agent) => agent.id === state.agentId)?.model ??
    null
  );
}

export { EMPTY_CHAT };
