import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerNiubash } from "./niubash.ts";
import { registerStrictTabQueue } from "./strict-tab-queue.ts";

export default function codexStyleForOmp(pi: ExtensionAPI): void {
  registerNiubash(pi);
  registerStrictTabQueue(pi);
}
