import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import "./pi-host.ts";

const { findNiubashPath, registerNiubash } = await import("../internal/niubash-feature.ts");

type Tool = {
  name: string;
  description: string;
  execute: (id: string, params: { command: string; timeout: number }) => Promise<{
    content: Array<{ text?: string }>;
    isError?: boolean;
  }>;
};

function registeredTools(platform: string): Tool[] {
  const tools: Tool[] = [];
  const pi = { registerTool(tool: Tool): void { tools.push(tool); } };
  registerNiubash(pi as unknown as Parameters<typeof registerNiubash>[0], platform);
  return tools;
}

test("only Windows registers a Niubash-backed bash tool", () => {
  assert.deepEqual(registeredTools("linux"), []);
  const tools = registeredTools("win32");
  assert.deepEqual(tools.map(({ name }) => name), ["bash"]);
  assert.match(tools[0].description, /Niubash/u);
});

test("discovers Niubash in order and rejects other shells", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-style-niu-"));
  try {
    const inherited = join(root, "inherited", "niu.exe");
    const override = join(root, "override", "niu.exe");
    const standard = join(root, "Programs", "Niubash", "niu.exe");
    const onPath = join(root, "bin", "niu.exe");
    for (const path of [inherited, override, standard, onPath]) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
    }
    writeFileSync(join(root, "bash.exe"), "");
    const env = { Path: join(root, "bin"), LOCALAPPDATA: root, NIUBASH_PATH: override };
    assert.equal(findNiubashPath({ ...env, NIU_SHELL: `"${inherited}"` }), inherited);
    assert.equal(findNiubashPath(env), override);
    assert.equal(findNiubashPath({ ...env, NIUBASH_PATH: root }), standard);
    assert.equal(findNiubashPath({ Path: env.Path }), onPath);
    assert.throws(() => findNiubashPath({ PATH: root }), /Niubash was not found/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

let hasNiubash = false;
if (process.platform === "win32") {
  try {
    findNiubashPath();
    hasNiubash = true;
  } catch {
    // The integration check requires a local Niubash installation.
  }
}

test("the real Pi Bash tool executes through Niubash", { skip: !hasNiubash }, async () => {
  const [bash] = registeredTools("win32");
  const result = await bash.execute("smoke", { command: 'printf "%s" "${NIU_SHELL##*[\\\\/]}"', timeout: 5 });
  assert.ok(!result.isError);
  assert.equal(result.content[0]?.text?.trim().toLowerCase(), "niu.exe");
});
