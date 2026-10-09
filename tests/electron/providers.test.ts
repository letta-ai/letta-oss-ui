import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("../../src/electron/libs/control", () => ({ request }));

const providers = await import("../../src/electron/libs/providers");

beforeEach(() => request.mockReset());

describe("listProviders", () => {
  it("maps the runtime's provider list for the UI", async () => {
    request.mockResolvedValue({
      providers: [
        {
          id: "anthropic",
          display_name: "Anthropic",
          description: "Connect an Anthropic API key",
          provider_name: "anthropic",
          fields: [{ key: "apiKey", label: "API Key", secret: true, required: true }],
          connected_providers: [],
        },
        {
          id: "ollama",
          display_name: "Ollama (local)",
          description: "Connect Ollama",
          provider_name: "lc-ollama",
          fields: [{ key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434/v1" }],
          connected_providers: [
            { is_connected: true, provider_name: "lc-ollama", auth_type: "api", base_url: "http://localhost:11434/v1" },
            { is_connected: false },
          ],
        },
        {
          id: "amazon-bedrock",
          display_name: "Amazon Bedrock",
          description: "Connect Bedrock",
          provider_name: "bedrock",
          auth_methods: [{ id: "profile", label: "Profile", description: "Use an AWS profile", fields: [{ key: "profile", label: "Profile" }] }],
          connected_providers: [],
        },
        {
          id: "openai-oauth",
          display_name: "OpenAI (ChatGPT subscription)",
          description: "Connect a subscription account",
          provider_name: "openai",
          is_oauth: true,
          connected_providers: [],
        },
      ],
    });

    const [anthropic, ollama, bedrock, oauth] = await providers.listProviders();
    expect(request).toHaveBeenCalledWith("list_connect_providers", { target: "local" });

    expect(anthropic).toMatchObject({ id: "anthropic", name: "Anthropic", oauth: false, connections: [] });
    expect(anthropic?.fields).toEqual([
      { key: "apiKey", label: "API Key", placeholder: null, secret: true, required: true },
    ]);
    expect(ollama?.fields[0]).toMatchObject({ secret: false, required: false, placeholder: "http://localhost:11434/v1" });
    expect(ollama?.connections).toEqual([
      { name: "lc-ollama", authType: "api", baseUrl: "http://localhost:11434/v1" },
    ]);
    expect(bedrock?.authMethods[0]).toMatchObject({ id: "profile", fields: [{ key: "profile" }] });
    expect(oauth).toMatchObject({ oauth: true, fields: [], authMethods: [] });
  });
});

describe("connectProvider", () => {
  it("trims values and leaves empty optional fields out", async () => {
    request.mockResolvedValue({ providers: [] });
    await providers.connectProvider({
      providerId: "ollama",
      fields: { baseUrl: " http://localhost:11434/v1 ", apiKey: "  " },
    });
    expect(request).toHaveBeenCalledWith("connect_provider", {
      target: "local",
      provider_id: "ollama",
      fields: { baseUrl: "http://localhost:11434/v1" },
    });
  });

  it("sends the chosen sign-in method", async () => {
    request.mockResolvedValue({ providers: [] });
    await providers.connectProvider({ providerId: "amazon-bedrock", authMethodId: "profile", fields: { profile: "dev" } });
    expect(request.mock.lastCall?.[1]).toMatchObject({ auth_method_id: "profile" });
  });
});

describe("disconnectProvider", () => {
  it("names the connection to remove", async () => {
    request.mockResolvedValue({ providers: [] });
    await providers.disconnectProvider({ providerId: "zai", providerName: "zai_coding" });
    expect(request).toHaveBeenCalledWith("disconnect_provider", {
      target: "local",
      provider_id: "zai",
      provider_name: "zai_coding",
    });
  });
});

describe("listModels", () => {
  const entries = [
    { id: "a", handle: "p/a", label: "Model A" },
    { id: "b", handle: "p/b" },
  ];

  it("lists only the models the user can run", async () => {
    request.mockResolvedValue({ entries, available_handles: ["p/b"] });
    expect(await providers.listModels()).toEqual([{ id: "b", handle: "p/b", label: "p/b" }]);
    expect(request).toHaveBeenCalledWith("list_models", { force: false });
  });

  it("lists everything when availability is unknown, and can bypass the cache", async () => {
    request.mockResolvedValue({ entries, available_handles: null });
    expect(await providers.listModels(true)).toHaveLength(2);
    expect(request).toHaveBeenCalledWith("list_models", { force: true });
  });
});
