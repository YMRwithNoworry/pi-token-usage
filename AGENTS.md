# Repository Guidelines

`codex-style` provides only a Niubash-backed `bash` tool on Windows and a strict Tab message queue for Pi and Oh My Pi. There is no build step.

- `token-usage.ts` is the Pi entry point; `omp/index.ts` is the Oh My Pi entry point.
- `internal/niubash-path.ts` resolves Niubash for both hosts. Keep host-specific Bash and TUI APIs separate.
- `internal/strict-message-queue.ts` manages Tab input and releases one item after each fully settled run.
- `tests/` covers both features and the entry point. `README.md` documents usage and installation.

Load locally with `pi --extension ./token-usage.ts`. Run the tests with `node --experimental-transform-types --test tests/*.test.ts`. If Pi's dependencies are not installed locally, set `PI_TEST_NODE_MODULES` to Pi's `node_modules` directory.

Use two-space indents, double quotes, semicolons, and trailing commas. Keep changes focused and use imperative commit subjects. Describe user-visible changes and verification in pull requests.
