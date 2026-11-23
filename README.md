# Codex Style

这个 Pi 扩展只提供两项功能：Windows 上用 Niubash 替换 Pi 的 `bash` 后端，以及在终端界面用 Tab 严格排队发送消息。

## Niubash

Windows 上，Pi 的 `bash` 工具通过 `niu.exe -c` 执行命令，保留 Pi 原有的输入、输出截断、超时和取消行为。依次从 `NIU_SHELL`、`NIUBASH_PATH`、`%LOCALAPPDATA%/Programs/Niubash/niu.exe` 和 `PATH` 查找 `niu.exe`；找不到时会报错，不回退到其他 shell。其他 Pi 工具和用户输入的 `!` / `!!` 不受影响。非 Windows 系统保留 Pi 原生 Bash 后端。

## 严格 Tab 队列

在终端界面输入普通消息并按 Tab。空闲时立即发送；忙碌时进入队列，等当前任务完全结束后按顺序逐条发送。单个工具调用结束不会放行下一条。空输入和斜杠命令仍使用 Pi 原有的 Tab 行为，Enter 也不受影响。

队列显示在编辑器上方，可用鼠标编辑或删除，也可使用 `/queue`、`/queue edit`、`/queue delete` 和 `/queue clear`。

## 安装

```bash
pi install npm:codex-style
```

在仓库中试用当前源码：

```bash
pi --extension ./token-usage.ts
```

手动安装时，将 `token-usage.ts`、`internal/niubash-feature.ts` 和 `internal/strict-message-queue.ts` 保持相对路径放入 `~/.pi/agent/extensions/`。npm 安装和手动安装只选一种，修改后重启 Pi 或对自动发现的扩展执行 `/reload`。

## 测试

使用 Node.js 22.19 或更高版本。若 Pi 的依赖不在项目的 `node_modules`，将 `PI_TEST_NODE_MODULES` 指向 Pi 安装目录下的 `node_modules`。

```bash
node --experimental-transform-types --test tests/*.test.ts
```
