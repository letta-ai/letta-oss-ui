import type { ModelOption, ProviderField, ProviderSummary } from "../types.js";
import { request } from "./control.js";

/**
 * Model providers for the local backend: the API keys and local inference
 * servers the runtime sends prompts to. Credentials are stored by the runtime,
 * never by this app.
 */

// Wire shapes from the app server protocol (protocol_v2 in @letta-ai/letta-code).
// They are declared here because the package's type export for them does not
// resolve under Node module resolution.
type WireField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
};

type WireConnection = {
  is_connected: boolean;
  provider_name?: string;
  auth_type?: "api" | "oauth";
  base_url?: string;
};

type WireProvider = {
  id: string;
  display_name: string;
  description: string;
  provider_name: string;
  is_oauth?: boolean;
  fields?: WireField[];
  auth_methods?: Array<{ id: string; label: string; description: string; fields: WireField[] }>;
  connected_providers: WireConnection[];
};

type ProvidersReply = { type: string; providers: WireProvider[] };

type ModelsReply = {
  type: string;
  entries: Array<{ id: string; handle: string; label?: string }>;
  available_handles?: string[] | null;
};

function toField(field: WireField): ProviderField {
  return {
    key: field.key,
    label: field.label,
    placeholder: field.placeholder ?? null,
    secret: field.secret ?? false,
    required: field.required ?? false,
  };
}

function toProviderSummary(entry: WireProvider): ProviderSummary {
  return {
    id: entry.id,
    name: entry.display_name,
    description: entry.description,
    oauth: entry.is_oauth ?? false,
    fields: (entry.fields ?? []).map(toField),
    authMethods: (entry.auth_methods ?? []).map((method) => ({
      id: method.id,
      label: method.label,
      description: method.description,
      fields: method.fields.map(toField),
    })),
    connections: entry.connected_providers
      .filter((state) => state.is_connected)
      .map((state) => ({
        name: state.provider_name ?? entry.provider_name,
        authType: state.auth_type ?? null,
        baseUrl: state.base_url ?? null,
      })),
  };
}

export async function listProviders(): Promise<ProviderSummary[]> {
  const reply = await request<ProvidersReply>("list_connect_providers", { target: "local" });
  return reply.providers.map(toProviderSummary);
}

export async function connectProvider(input: {
  providerId: string;
  authMethodId?: string;
  fields: Record<string, string>;
}): Promise<ProviderSummary[]> {
  // Empty optional fields are left out so the runtime applies its defaults.
  const fields = Object.fromEntries(
    Object.entries(input.fields)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value),
  );
  const reply = await request<ProvidersReply>("connect_provider", {
    target: "local",
    provider_id: input.providerId,
    ...(input.authMethodId ? { auth_method_id: input.authMethodId } : {}),
    fields,
  });
  return reply.providers.map(toProviderSummary);
}

export async function disconnectProvider(input: {
  providerId: string;
  providerName?: string;
}): Promise<ProviderSummary[]> {
  const reply = await request<ProvidersReply>("disconnect_provider", {
    target: "local",
    provider_id: input.providerId,
    ...(input.providerName ? { provider_name: input.providerName } : {}),
  });
  return reply.providers.map(toProviderSummary);
}

/**
 * The model catalog. `refresh` bypasses the runtime's availability cache, which
 * is needed right after a provider is connected or removed.
 */
export async function listModels(refresh = false): Promise<ModelOption[]> {
  const reply = await request<ModelsReply>("list_models", { force: refresh });
  const available = reply.available_handles ? new Set(reply.available_handles) : null;
  return reply.entries
    .filter((entry) => !available || available.has(entry.handle))
    .map((entry) => ({ id: entry.id, handle: entry.handle, label: entry.label || entry.handle }));
}
