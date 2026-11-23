# Codex Style

这个扩展支持 Pi 和 Oh My Pi，仅提供 Windows 上的 Niubash 后端，以及终端界面的严格 Tab 消息队列。

## Niubash

Windows 上，agent 的 `bash` 工具通过 `niu.exe -c` 执行命令，支持工作目录、超时和取消。依次从 `NIU_SHELL`、`NIUBASH_PATH`、`%LOCALAPPDATA%/Programs/Niubash/niu.exe` 和 `PATH` 查找 `niu.exe`；找不到时会报错，不回退到其他 shell。Oh My Pi 的覆盖只支持非交互式命令，不提供原生 Bash 工具的 PTY 和后台服务模式。其他工具和 `!` / `!!` 不受影响。非 Windows 系统保留原生 Bash 后端。

## 严格 Tab 队列

在终端界面输入普通消息并按 Tab。空闲时立即发送；忙碌时进入队列，等当前任务完全结束后按顺序逐条发送。单个工具调用结束不会放行下一条。空输入和斜杠命令仍使用 Pi 原有的 Tab 行为，Enter 也不受影响。

待发送消息显示在编辑器上方。Pi 版还支持鼠标编辑、删除和 `/queue` 管理命令。

## 安装

### Pi

```bash
pi install npm:codex-style
```

在仓库中试用当前源码：`pi --extension ./token-usage.ts`。

手动安装时，把 `token-usage.ts` 和 `internal/` 保持相对路径放入 `~/.pi/agent/extensions/`。npm 安装和手动安装只选一种，修改后重启 Pi 或对自动发现的扩展执行 `/reload`。

### Oh My Pi

在此仓库中运行 `omp plugin link .`，然后重启 `omp` 或执行 `/reload-plugins`。也可用 `omp --extension ./omp/index.ts` 单独试用。已在 Oh My Pi 19.1.1 上验证。

## 测试

使用 Node.js 22.19 或更高版本。若 Pi 的依赖不在项目的 `node_modules`，将 `PI_TEST_NODE_MODULES` 指向 Pi 安装目录下的 `node_modules`。

```bash
node --experimental-transform-types --test tests/*.test.ts
```
