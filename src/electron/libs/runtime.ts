import { randomUUID } from "node:crypto";
import {
  LettaAgentClient,
  createTranscriptAccumulator,
  type CanUseToolResponse,
  type LettaAgent,
  type LettaCodeSession,
  type LettaConversation,
  type TranscriptAccumulator,
  type TranscriptRow,
} from "@letta-ai/letta-agent-sdk";
import type {
  AgentSummary,
  AppEvent,
  ApprovalDecision,
  ApprovalRequest,
  ChatRow,
  ConnectionState,
  ConversationSummary,
  HistoryResult,
  ModelOption,
  SendMessageInput,
} from "../types.js";
import { startAppServer, type AppServerHandle } from "./app-server.js";
import {
  type ConnectionConfig,
  forgetConversation,
  getConnectionConfig,
  getConversationCwd,
  getPermissionMode,
  rememberCwd,
  setAgentId,
} from "./settings.js";
import { describeError, mergeHistory, projectHistory, toChatRow } from "./transcript.js";

/**
 * Everything that talks to Letta: the SDK client, agent and conversation
 * management, and the turns currently streaming.
 */

type PendingApproval = {
  request: ApprovalRequest;
  resolve: (response: CanUseToolResponse) => void;
};

type Turn = {
  conversationId: string;
  session: LettaCodeSession;
  accumulator: TranscriptAccumulator;
  /** Last version of each row sent to the renderer, for identity diffing. */
  sent: Map<string, TranscriptRow>;
  approvals: Map<string, PendingApproval>;
  activity: string | null;
  flushTimer: NodeJS.Timeout | null;
  stopped: boolean;
  finished: boolean;
};

const ROW_FLUSH_MS = 40;
const STOP_GRACE_MS = 5_000;
const TITLE_MAX_CHARS = 60;

const ACTIVITY: Record<string, string | null> = {
  SENDING_API_REQUEST: "Thinking",
  WAITING_FOR_API_RESPONSE: "Thinking",
  PROCESSING_API_RESPONSE: "Responding",
  RETRYING_API_REQUEST: "Retrying",
  WAITING_ON_APPROVAL: "Waiting for approval",
  EXECUTING_CLIENT_SIDE_TOOL: "Running tool",
  EXECUTING_COMMAND: "Running command",
  WAITING_ON_INPUT: null,
};

let emit: (event: AppEvent) => void = () => {};
let client: LettaAgentClient | null = null;
let server: AppServerHandle | null = null;
let connecting: Promise<LettaAgentClient> | null = null;
let connection: ConnectionState = { status: "connecting", backend: "local" };

const turns = new Map<string, Turn>();
const conversations = new Map<string, ConversationSummary>();

export function initRuntime(emitter: (event: AppEvent) => void): void {
  emit = emitter;
  connection = { status: "connecting", backend: getConnectionConfig().backend };
  void ensureClient().catch(() => {
    // The failure is already reflected in the connection state.
  });
}

// --- Connection -------------------------------------------------------------

function setConnection(state: ConnectionState): void {
  connection = state;
  emit({ type: "connection", state });
}

export function getConnection(): ConnectionState {
  return connection;
}

/** Connection failures the user can fix get a message that says how. */
function describeConnectionError(error: unknown, config: ConnectionConfig): string {
  const detail = describeError(error);
  if (config.backend === "remote" && /WebSocket|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
    return `Could not reach the Letta server at ${config.serverUrl}. Check that it is running and that the URL is correct.`;
  }
  if (config.backend === "cloud" && /LETTA_API_KEY/.test(detail)) {
    return "Add your Letta API key in Settings to use Letta Cloud.";
  }
  return detail;
}

async function connect(): Promise<LettaAgentClient> {
  const config = getConnectionConfig();
  setConnection({ status: "connecting", backend: config.backend });

  let next: LettaAgentClient | null = null;
  let owned: AppServerHandle | null = null;
  try {
    let detail: string;
    if (config.backend === "remote") {
      if (!config.serverUrl) throw new Error("Add your Letta server URL in Settings.");
      next = new LettaAgentClient({
        backend: "remote",
        url: config.serverUrl,
        ...(config.serverToken ? { authToken: config.serverToken } : {}),
      });
      detail = config.serverUrl;
    } else {
      const cloud = config.backend === "cloud";
      owned = await startAppServer({
        harnessBackend: cloud ? "api" : "local",
        env: cloud
          ? {
              ...(config.apiKey ? { LETTA_API_KEY: config.apiKey } : {}),
              ...(config.apiBaseUrl ? { LETTA_BASE_URL: config.apiBaseUrl } : {}),
            }
          : {},
      });
      next = new LettaAgentClient({
        backend: "local",
        appServer: { url: owned.url, harnessBackend: cloud ? "api" : "local" },
      });
      detail = cloud ? "Letta Cloud" : "This computer";
    }

    // A cheap request that proves the server is reachable and authenticated.
    await next.agents.list({ limit: 1 });

    owned?.onExit((reason) => {
      if (server !== owned) return;
      void disconnect().then(() => {
        setConnection({ status: "error", backend: config.backend, error: describeError(reason) });
      });
    });
    client = next;
    server = owned;
    setConnection({ status: "ready", backend: config.backend, detail });
    return next;
  } catch (error) {
    await next?.close().catch(() => undefined);
    owned?.close();
    setConnection({
      status: "error",
      backend: config.backend,
      error: describeConnectionError(error, config),
    });
    throw error;
  }
}

function ensureClient(): Promise<LettaAgentClient> {
  if (client) return Promise.resolve(client);
  connecting ??= connect().finally(() => {
    connecting = null;
  });
  return connecting;
}

export async function disconnect(): Promise<void> {
  await connecting?.catch(() => undefined);
  for (const turn of [...turns.values()]) {
    turn.stopped = true;
    finishTurn(turn);
  }
  conversations.clear();
  const previousClient = client;
  const previousServer = server;
  client = null;
  server = null;
  await previousClient?.close().catch(() => undefined);
  previousServer?.close();
}

export async function reconnect(): Promise<ConnectionState> {
  await disconnect();
  await ensureClient().catch(() => undefined);
  return connection;
}

// --- Agents and models ------------------------------------------------------

function toAgentSummary(agent: LettaAgent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name || "Untitled agent",
    description: agent.description ?? null,
    model: agent.model ?? agent.llm_config?.handle ?? null,
  };
}

export async function listAgents(): Promise<AgentSummary[]> {
  const sdk = await ensureClient();
  const agents = await sdk.agents.list({ limit: 100 });
  return agents.map(toAgentSummary);
}

export async function createAgent(input: { name: string; model?: string }): Promise<AgentSummary> {
  const sdk = await ensureClient();
  const agentId = await sdk.createAgent({
    name: input.name.trim() || "Cowork",
    ...(input.model ? { model: input.model } : {}),
  });
  setAgentId(agentId);
  return toAgentSummary(await sdk.agents.retrieve(agentId));
}

export async function listModels(): Promise<ModelOption[]> {
  const sdk = await ensureClient();
  const result = await sdk.models.list();
  const available = result.availableHandles ? new Set(result.availableHandles) : null;
  return result.entries
    .filter((entry) => !available || available.has(entry.handle))
    .map((entry) => ({ id: entry.id, handle: entry.handle, label: entry.label || entry.handle }));
}

// --- Conversations ----------------------------------------------------------

function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toConversationSummary(conversation: LettaConversation): ConversationSummary {
  const summary: ConversationSummary = {
    id: conversation.id,
    agentId: conversation.agent_id,
    title: conversation.summary?.trim() ?? "",
    updatedAt:
      timestamp(conversation.last_message_at) ||
      timestamp(conversation.updated_at) ||
      timestamp(conversation.created_at),
    model: conversation.model ?? null,
    cwd: getConversationCwd(conversation.id),
  };
  conversations.set(summary.id, summary);
  return summary;
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}...` : line;
}

export async function listConversations(agentId: string): Promise<ConversationSummary[]> {
  const sdk = await ensureClient();
  const list = await sdk.conversations.list({ agentId, limit: 100 });
  return list
    // Skip archived chats and the empty conversation every new agent starts with.
    .filter(
      (conversation) =>
        !conversation.archived && Boolean(conversation.summary || conversation.last_message_at),
    )
    .map(toConversationSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  const sdk = await ensureClient();
  return toConversationSummary(
    await sdk.conversations.update(conversationId, { summary: title.trim() }),
  );
}

export async function archiveConversation(conversationId: string): Promise<void> {
  const sdk = await ensureClient();
  await stopTurn(conversationId);
  await sdk.conversations.update(conversationId, { archived: true });
  conversations.delete(conversationId);
  forgetConversation(conversationId);
}

export async function loadHistory(conversationId: string, limit: number): Promise<HistoryResult> {
  const sdk = await ensureClient();
  const page = await sdk.conversations.listMessages(conversationId, { limit, order: "desc" });
  const history = projectHistory(page.messages);
  const turn = turns.get(conversationId);
  return {
    rows: turn ? mergeHistory(history, turn.accumulator.rows().map(toChatRow)) : history,
    hasMore: page.hasMore ?? page.messages.length >= limit,
    running: Boolean(turn),
    activity: turn?.activity ?? null,
    approvals: turn ? [...turn.approvals.values()].map((pending) => pending.request) : [],
  };
}

// --- Turns ------------------------------------------------------------------

function flushRows(turn: Turn): void {
  if (turn.flushTimer) {
    clearTimeout(turn.flushTimer);
    turn.flushTimer = null;
  }
  // Rows keep their object identity when nothing changed, so an identity
  // comparison against the last sent version is an exact diff.
  const changed: ChatRow[] = [];
  for (const row of turn.accumulator.rows()) {
    if (turn.sent.get(row.key) === row) continue;
    turn.sent.set(row.key, row);
    changed.push(toChatRow(row));
  }
  if (changed.length > 0) {
    emit({ type: "turn.rows", conversationId: turn.conversationId, rows: changed });
  }
}

function scheduleFlush(turn: Turn): void {
  turn.flushTimer ??= setTimeout(() => flushRows(turn), ROW_FLUSH_MS);
}

function setActivity(turn: Turn, activity: string | null): void {
  if (turn.activity === activity) return;
  turn.activity = activity;
  emit({ type: "turn.activity", conversationId: turn.conversationId, activity });
}

function settleApprovals(turn: Turn, message: string): void {
  for (const [requestId, pending] of turn.approvals) {
    pending.resolve({ behavior: "deny", message, interrupt: true });
    emit({ type: "approval.resolved", conversationId: turn.conversationId, requestId });
  }
  turn.approvals.clear();
}

function finishTurn(turn: Turn, error?: string): void {
  if (turn.finished) return;
  turn.finished = true;
  flushRows(turn);
  settleApprovals(turn, "The turn ended.");
  // Sessions hold a live connection to the runtime; the conversation itself is
  // durable, so the session is closed as soon as the turn is over.
  try {
    turn.session.close();
  } catch {
    // Already closed.
  }
  if (turns.get(turn.conversationId) === turn) turns.delete(turn.conversationId);
  emit({
    type: "turn.finished",
    conversationId: turn.conversationId,
    ...(error && !turn.stopped ? { error } : {}),
  });

  const conversation = conversations.get(turn.conversationId);
  if (conversation) {
    const updated = { ...conversation, updatedAt: Date.now() };
    conversations.set(updated.id, updated);
    emit({ type: "conversation.updated", conversation: updated });
  }
}

async function runTurn(turn: Turn, text: string, otid: string): Promise<void> {
  let failure: string | undefined;
  try {
    // A conversation left waiting on an approval (for example, the app quit
    // mid-turn) stays wedged until the runtime re-drives it through canUseTool.
    await turn.session.recoverPendingApprovals({ timeoutMs: 5_000 }).catch(() => undefined);
    await turn.session.send(text, { otid });

    for await (const message of turn.session.stream()) {
      if (turn.finished) return;
      switch (message.type) {
        case "error":
          failure = describeError(message.errorDetail ?? message.message);
          break;
        case "result":
          failure = message.success
            ? undefined
            : (failure ??
              describeError(message.errorDetail ?? message.error ?? "The turn failed."));
          break;
        case "retry": {
          // A retried turn re-streams from the top, so the rows written by the
          // abandoned attempt are dropped rather than accumulated onto.
          failure = undefined;
          const keys = [...turn.sent.keys()];
          turn.accumulator.reset();
          turn.sent.clear();
          if (keys.length > 0) {
            emit({ type: "turn.rows.removed", conversationId: turn.conversationId, keys });
          }
          setActivity(turn, `Retrying (${message.attempt}/${message.maxAttempts})`);
          break;
        }
        case "loop_status":
          if (message.status in ACTIVITY) setActivity(turn, ACTIVITY[message.status]);
          break;
        default:
          turn.accumulator.apply(message);
          scheduleFlush(turn);
      }
    }
  } catch (error) {
    failure = describeError(error);
  } finally {
    finishTurn(turn, failure);
  }
}

export async function sendMessage(input: SendMessageInput): Promise<ConversationSummary> {
  const sdk = await ensureClient();
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty.");
  if (input.conversationId && turns.has(input.conversationId)) {
    throw new Error("This chat is still working. Stop it or wait for it to finish.");
  }

  let conversation: ConversationSummary;
  if (input.conversationId) {
    conversation =
      conversations.get(input.conversationId) ??
      toConversationSummary(await sdk.conversations.retrieve(input.conversationId));
    if (!conversation.title) {
      conversation = toConversationSummary(
        await sdk.conversations.update(conversation.id, { summary: titleFrom(text) }),
      );
    }
  } else {
    conversation = toConversationSummary(
      await sdk.conversations.create({ agentId: input.agentId, summary: titleFrom(text) }),
    );
  }

  rememberCwd(conversation.id, input.cwd);
  setAgentId(conversation.agentId);
  conversation = {
    ...conversation,
    cwd: input.cwd,
    updatedAt: Date.now(),
    // The session applies this as the conversation's model override.
    ...(input.model ? { model: input.model } : {}),
  };
  conversations.set(conversation.id, conversation);

  const turn: Turn = {
    conversationId: conversation.id,
    accumulator: createTranscriptAccumulator(),
    sent: new Map(),
    approvals: new Map(),
    activity: "Starting",
    flushTimer: null,
    stopped: false,
    finished: false,
    session: sdk.resumeSession(conversation.id, {
      cwd: input.cwd,
      permissionMode: getPermissionMode(),
      ...(input.model ? { model: input.model } : {}),
      canUseTool: (toolName, toolInput, context) =>
        new Promise<CanUseToolResponse>((resolve) => {
          const request: ApprovalRequest = {
            requestId: context?.requestId ?? randomUUID(),
            toolCallId: context?.toolCallId ?? null,
            toolName,
            input: toolInput,
            suggestions: context?.permissionSuggestions ?? [],
          };
          turn.approvals.set(request.requestId, { request, resolve });
          // Make sure the tool call is on screen before asking about it.
          flushRows(turn);
          emit({ type: "approval.requested", conversationId: turn.conversationId, request });
        }),
    }),
  };
  turns.set(conversation.id, turn);
  emit({ type: "turn.started", conversationId: conversation.id });
  void runTurn(turn, text, input.otid);

  return conversation;
}

export async function stopTurn(conversationId: string): Promise<void> {
  const turn = turns.get(conversationId);
  if (!turn || turn.stopped) return;
  turn.stopped = true;
  settleApprovals(turn, "Stopped by the user.");
  setActivity(turn, "Stopping");
  // If the runtime does not wind the turn down promptly, end it locally.
  setTimeout(() => finishTurn(turn), STOP_GRACE_MS).unref();
  await turn.session.abort().catch(() => undefined);
}

export function respondApproval(
  conversationId: string,
  requestId: string,
  decision: ApprovalDecision,
): void {
  const turn = turns.get(conversationId);
  const pending = turn?.approvals.get(requestId);
  if (!turn || !pending) return;
  turn.approvals.delete(requestId);
  pending.resolve(
    decision.behavior === "allow"
      ? {
          behavior: "allow",
          ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
          ...(decision.suggestionIds ? { updatedPermissions: decision.suggestionIds } : {}),
        }
      : { behavior: "deny", message: decision.message || "Denied by the user." },
  );
  emit({ type: "approval.resolved", conversationId, requestId });
}

/** Apply a permission mode change to turns that are already running. */
export function applyPermissionMode(): void {
  const permissionMode = getPermissionMode();
  for (const turn of turns.values()) {
    void turn.session.changeDeviceState({ permissionMode }).catch(() => undefined);
  }
}
