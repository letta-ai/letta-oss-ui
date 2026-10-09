import { vi } from "vitest";

// UI modules read the preload bridge from `window.bridge` when they load.
// Tests that exercise the bridge replace these stubs with their own.
vi.stubGlobal("window", { bridge: { platform: "darwin" } });
