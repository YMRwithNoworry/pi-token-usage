/** Verify only the native bash tool is routed through Niubash on Windows. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const JITI_PATH = "C:/Users/Administrator/.pi/agent/install/releases/1.4.0/node_modules/jiti/lib/jiti.cjs";
const { createJiti } = require(JITI_PATH);
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { registerNiubashBash } = await jiti.import("../internal/niubash-feature.ts");

const tools = new Map<string, any>();
registerNiubashBash({
  registerTool(tool: { name: string }) {
    tools.set(tool.name, tool);
  },
} as any);

if (process.platform !== "win32") {
  assert.equal(tools.size, 0, "non-Windows platforms must retain Pi's native bash tool");
  console.log("ok - non-Windows platforms keep the native bash tool");
} else {
  assert.deepEqual([...tools.keys()], ["bash"]);
  for (const name of ["read", "edit", "write", "grep", "find", "ls", "powershell"]) {
    assert.equal(tools.has(name), false, `${name} must remain a native Pi tool`);
  }

  const bashTool = tools.get("bash");
  assert.match(bashTool.description, /Niubash/u);
  const result = await bashTool.execute(
    "niubash-smoke",
    { command: "printf '%s' \"$NIU_SHELL\"" },
    undefined,
    undefined,
    undefined,
  );

  assert.equal(result.isError, undefined);
  assert.match(result.content[0]?.text ?? "", /niu\.exe/iu);
  console.log("ok - bash runs through Niubash while other native tool registrations are untouched");
}
