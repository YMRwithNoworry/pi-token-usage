import { registerWorkingVerbs } from "./internal/working-verb.ts";
import { registerStrictMessageQueue } from "./internal/strict-message-queue.ts";
import { registerBackgroundTaskQueue } from "./internal/background-task-queue.ts";
import { registerPersistentGoals } from "./internal/goal-feature.ts";
import { registerInitCommand } from "./internal/init-feature.ts";
import { registerSonnetCompatibility } from "./internal/sonnet-compat-feature.ts";
import { registerCodexTodo } from "./internal/todo-feature.ts";
import { registerSubagentTeam } from "./internal/subagent-team-feature.ts";
import { registerNiubashBash } from "./internal/niubash-feature.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function codexStyle(pi: ExtensionAPI): void {
  registerPersistentGoals(pi);
  registerInitCommand(pi);
  registerWorkingVerbs(pi);
  registerSonnetCompatibility(pi);
  registerCodexTodo(pi);
  registerStrictMessageQueue(pi);
  registerBackgroundTaskQueue(pi);
  registerSubagentTeam(pi);
  registerNiubashBash(pi);
}
