import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerNiubash } from "./internal/niubash-feature.ts";
import { registerStrictMessageQueue } from "./internal/strict-message-queue.ts";

export default function codexStyle(pi: ExtensionAPI): void {
  registerNiubash(pi);
  registerStrictMessageQueue(pi);
}
