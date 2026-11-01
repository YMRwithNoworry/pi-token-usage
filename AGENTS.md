# Repository Guidelines

A Codex-style Pi extension bundling real-time token usage, persistent Goals, task plans, `/init` guidance generation, Chinese working status, strict Tab messaging, Enter-submitted background tasks, Claude 5.5 Anthropic payload compatibility, and bounded subagent teams. `package.json` exposes the package to Pi's npm installer; there is no build step or external runtime dependency installation outside Pi's host APIs.

## Project Structure & Module Organization

- `package.json` — npm metadata and the Pi manifest that loads only `token-usage.ts`.
- `token-usage.ts` — the only entry point; default export `tokenUsage(pi)` registers every feature.
- `internal/` — one module per feature, each exporting a single `registerX(pi)` function: `goal-feature.ts`, `init-feature.ts`, `todo-feature.ts`, `working-verb.ts`, `strict-message-queue.ts`, `background-task-queue.ts`, `subagent-team-feature.ts`, `sonnet-compat-feature.ts`.
- `tests/` — flat `*.test.ts` files, one per internal module.
- `README.md` — user-facing behavior and installation docs.

Add a feature as `internal/<name>-feature.ts` plus a `register<Name>(pi)` call inside `token-usage.ts`; keep the entry point thin.

## Build, Test, and Development Commands

No compilation step. Load directly into Pi:

```bash
pi --extension ./token-usage.ts
```

Run a single test file (each is self-contained):

```bash
node --experimental-strip-types tests/working-verb.test.ts
```

Run all: repeat for `strict-message-queue`, `background-task-queue`, `entrypoint-registration`, `goal-command`, `init-command`, `todo-feature`, `working-verb`, `sonnet-compat`, and `subagent-team-feature`. A suite prints `ok - <name>` per test and exits non-zero on failure.

Install from npm with `pi install npm:codex-style`, or copy `token-usage.ts` and `internal/*` into `~/.pi/agent/extensions/` preserving relative paths. These are mutually exclusive installation methods; do not load the npm package and manual copy at the same time.

## Coding Style & Naming Conventions

- 2-space indent, double quotes, semicolons, trailing commas.
- TypeScript with `type` aliases; annotate parameter and return types on every function.
- `camelCase` for functions/variables, `PascalCase` for types, `CONSTANT_CASE` for module-level constants (e.g. `STATUS_KEY`, `BUTTONS`).
- `/** ... */` doc comments only where the behavior is non-obvious.
- No linter or formatter is configured; match surrounding code.

## Testing Guidelines

Tests use `node:assert/strict` with a hand-rolled harness that fakes `ExtensionAPI`/`ExtensionContext` and records events. They import modules through `jiti` using a hard-coded `JITI_PATH` under `~/.pi/agent/install/...`; update it if your Pi install moves. Register tests in the local `tests` array as `[name, async fn]` pairs and use behavioral names such as `turn_start and streaming events rotate the verb`.

## Commit & Pull Request Guidelines

Commit subjects are single-line, imperative, sentence case, with no prefix (`Add rotating working verbs and strict message queue`, `Make Tab message queue strictly settle runs`). Keep one logical change per commit.

Pull requests should describe the user-visible behavior change, note affected `internal/` modules, list commands run to verify, and include a TUI screenshot for any widget or status-line change.
