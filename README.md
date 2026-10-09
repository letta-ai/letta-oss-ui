<div align="center">

# Letta Cowork

[![Platform](https://img.shields.io/badge/platform-%20macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](https://github.com/letta-ai/letta-oss-ui/releases)

An open-source desktop app for working with Letta agents, built on the [Letta Agent SDK](https://docs.letta.com/agent-sdk).

</div>

## What it is

Letta Cowork is a desktop app for [stateful agents](https://docs.letta.com/concepts/stateful-agents). You point an agent at a folder, describe a task, and watch it work. The agent keeps its memory across every chat.

- **Agents on your machine.** By default, agents and their memory are stored on your computer. No account is needed.
- **Three backends.** Use the local runtime, Letta Cloud, or a Letta app server that you host.
- **Many agents, many chats.** Switch between agents. Each agent has its own list of chats, and your history is there when you come back.
- **You stay in control.** The agent asks before it runs a command or edits a file. You can allow once, allow from now on, or deny.
- **Any model.** Connect model providers in the app, then pick a model for each chat.
- **Memory you can read.** See what an agent remembers, edit it, and roll back to an earlier version.

The code started as a fork of [Claude-Cowork](https://github.com/DevAgentForge/Claude-Cowork) and replaces the Claude SDK with [`@letta-ai/letta-agent-sdk`](https://www.npmjs.com/package/@letta-ai/letta-agent-sdk).

## Quick start

You need [Bun](https://bun.sh/).

```bash
git clone https://github.com/letta-ai/letta-oss-ui.git
cd letta-oss-ui
bun install
bun run dev
```

The app opens connected to the local runtime. Create an agent, choose a folder, and send a message.

The local runtime needs at least one model provider. The app asks you to connect one the first time. You can also open **Settings > Model providers** at any time to add an API key or a local server such as Ollama or LM Studio.

Providers that sign in with a subscription account are connected from the [Letta CLI](https://docs.letta.com/platform/cli): run `letta` and use `/connect`.

## Where your agents live

Open **Settings** (the gear in the sidebar, or `Cmd/Ctrl+,`) to choose a backend.

| Backend            | Agents are stored | Tools run        | You need                    |
| ------------------ | ----------------- | ---------------- | --------------------------- |
| This computer      | On this machine   | On this machine  | Nothing                     |
| Letta Cloud        | In Letta Cloud    | On this machine  | A [Letta API key](https://app.letta.com/settings) |
| Self-hosted server | On your server    | On your server   | The server URL              |

To run your own server, see the [App Server docs](https://docs.letta.com/self-hosting/app-server):

```bash
letta server --backend local --listen ws://127.0.0.1:4500
```

Settings are saved in the app's user data folder. API keys and server tokens are encrypted with the operating system keychain when one is available.

### Defaults from the environment

In development you can set defaults in a `.env` file instead. Copy `.env.example` to `.env` and edit it. A value saved in Settings takes priority over the environment.

## Using the app

- **Folder.** The folder chip in the message box sets where the agent works. Each chat remembers its folder.
- **Model.** The model chip changes the model for the current chat.
- **Permissions.** The shield chip sets what the agent may do without asking:
  - *Ask first* asks before commands and file edits.
  - *Accept edits* edits files freely and asks before commands.
  - *Full access* runs everything without asking.
- **Chats.** Use the menu on a chat to rename it, archive it, or copy a command that resumes it in the Letta CLI.
- **Memory.** The Memory button in the sidebar shows the selected agent's memory files. You can add, edit, and delete files. Each change is saved as a version, so History can show and restore an earlier one. Letta checks every change against its memory rules and the app tells you if a change is not allowed.

## Build an installer

```bash
bun run dist:mac-arm64   # macOS, Apple silicon
bun run dist:mac-x64     # macOS, Intel
bun run dist:linux       # Linux AppImage
bun run dist:win         # Windows portable .exe
```

Installers are written to `dist/`. Builds are not code signed unless you configure signing for [electron-builder](https://www.electron.build/code-signing).

## How it works

```text
React UI  <-- IPC -->  Electron main process  <-- WebSocket -->  Letta app server
(src/ui)               (src/electron)                            (local or remote)
```

- The main process owns one `LettaAgentClient`. For the local and cloud backends it starts one Letta app server (the CLI bundled with the SDK) and shares it across all chats. For the self-hosted backend it connects to your server.
- Each message opens an SDK session on its conversation, streams the turn, and closes the session. Conversations are durable. Sessions are not.
- The SDK's transcript accumulator turns the message stream and the saved history into the same rows, so a chat looks the same live and after a restart.
- Tool approvals go through the SDK's `canUseTool` callback and are answered in the UI.
- Model providers and memory files use app server protocol commands that the SDK does not wrap yet. `src/electron/libs/control.ts` sends them over a second connection to the same server.

`src/electron/types.ts` defines every message that crosses between the UI and the main process.

## Development

```bash
bun run dev        # Start the app with hot reload
bun run check      # Type-check and lint
bun run build      # Build the UI bundle
```

### Upgrading the SDK

`@letta-ai/letta-agent-sdk` and `@letta-ai/letta-code` depend on each other at exact versions. `package.json` pins both in `overrides` so that one copy of each is installed. When you upgrade the SDK, change its version in `dependencies` and in `overrides`, and set the `@letta-ai/letta-code` override to the version that SDK release depends on:

```bash
npm view @letta-ai/letta-agent-sdk@<version> dependencies
```
