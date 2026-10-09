import { createAppServerClient, type AppServerClient } from "@letta-ai/letta-code/app-server-client";

/**
 * A direct connection to the Letta app server for the parts of its protocol
 * the SDK does not wrap yet: model provider setup and agent memory files.
 *
 * It runs beside the SDK client, on the same server. The connection opens on
 * first use and reopens if it drops.
 */

export type ControlTarget = { url: string; authToken?: string };

type Reply = { type: string; request_id?: string; success?: boolean; error?: string };

let target: ControlTarget | null = null;
let connection: Promise<AppServerClient> | null = null;

export function setControlTarget(next: ControlTarget | null): void {
  const previous = connection;
  target = next;
  connection = null;
  void previous?.then((client) => client.close()).catch(() => undefined);
}

function connect(): Promise<AppServerClient> {
  if (!target) return Promise.reject(new Error("Not connected to Letta."));
  if (connection) return connection;

  const opening: Promise<AppServerClient> = createAppServerClient(target)
    .connect()
    .then((client) => {
      client.onDisconnect(() => {
        if (connection === opening) connection = null;
      });
      return client;
    });
  opening.catch(() => {
    if (connection === opening) connection = null;
  });
  connection = opening;
  return opening;
}

function isReply(message: unknown, type: string, requestId: string): message is Reply {
  const reply = message as Reply | null;
  return reply?.type === type && reply.request_id === requestId;
}

/** Send one command and wait for its response. Throws if the server reports failure. */
export async function request<TResponse extends Reply>(
  type: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const client = await connect();
  const requestId = client.nextRequestId(type);
  const response = await client.requestRaw<Reply & Record<string, unknown>>(
    { type, request_id: requestId, ...body },
    {
      predicate: (message): message is Reply & Record<string, unknown> =>
        isReply(message, `${type}_response`, requestId),
    },
  );
  if (response.success === false) throw new Error(response.error ?? `${type} failed.`);
  return response as unknown as TResponse;
}

/** Send a command whose response arrives in chunks, each ending with `done`. */
export async function requestChunks<TResponse extends Reply & { done: boolean }>(
  type: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<TResponse[]> {
  const client = await connect();
  const requestId = client.nextRequestId(type);

  return new Promise((resolve, reject) => {
    const chunks: TResponse[] = [];
    const finish = (error?: Error) => {
      clearTimeout(timer);
      stopListening();
      stopWatching();
      if (error) reject(error);
      else resolve(chunks);
    };
    const timer = setTimeout(() => finish(new Error(`${type} timed out.`)), timeoutMs);
    const stopWatching = client.onDisconnect(() => finish(new Error("Lost the connection to Letta.")));
    const stopListening = client.onMessage((message) => {
      if (!isReply(message, `${type}_response`, requestId)) return;
      const chunk = message as TResponse;
      if (chunk.success === false) {
        finish(new Error(chunk.error ?? `${type} failed.`));
        return;
      }
      chunks.push(chunk);
      if (chunk.done) finish();
    });
    client.sendRaw({ type, request_id: requestId, ...body });
  });
}

/** Which harness backend the server runs: "local" stores agents on its machine. */
export async function serverBackend(): Promise<string | null> {
  try {
    const client = await connect();
    return (await client.info()).backend ?? null;
  } catch {
    return null;
  }
}
