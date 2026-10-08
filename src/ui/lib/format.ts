import type { ModelOption } from "../types";

const isWindows = window.cowork.platform === "win32";

/** Last two segments of a path, enough to recognize a project folder. */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `${isWindows ? "" : ".../"}${parts.slice(-2).join("/")}`;
}

export function folderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "";
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function modelLabel(handle: string | null, models: ModelOption[]): string {
  if (!handle) return "Default model";
  const match = models.find((model) => model.handle === handle || model.id === handle);
  return match?.label ?? handle.split("/").pop() ?? handle;
}

/** Input fields that best describe a tool call, in priority order. */
const SUMMARY_KEYS = [
  "command",
  "cmd",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "description",
  "prompt",
];

/** One line describing what a tool call is doing, whatever toolset the model uses. */
export function toolSummary(input: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value.join(" ");
    }
  }
  return "";
}

/** "exec_command" and "WebFetch" both become readable labels. */
export function toolLabel(name: string): string {
  const spaced = name
    .replace(/^mcp__/, "")
    .replace(/__/g, ": ")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
