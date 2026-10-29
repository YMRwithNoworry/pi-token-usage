# Pi Token Usage + Persistent Goals

这个 Pi 扩展包含两个功能：

## 实时 Token 用量

在 TUI/RPC 状态栏显示当前会话用量：

- `↑` 输入 tokens（发送到模型的上下文）
- `↓` 输出 tokens（模型生成并返回的内容）
- `cache R/W` 缓存读取/写入 tokens（provider 提供时显示）
- 估算费用（provider 提供时显示）
- 流式生成期间刷新，回合结束后显示当前分支累计值

不同 provider 对流式中间 usage 的支持不同。中间用量不可用时会以 `~` 标出估算值；最终累计值使用回合结束后 provider 返回的 usage。

## 持久化 Goal

新增持久化 Goal 功能，内部实现参考 Codex 的目标模型：每个 Pi 会话分支保存一个目标，目标会出现在状态栏和模型上下文中；目标未完成时可自动续做。

```text
/goal start [--budget N] <objective>
/goal status
/goal pause
/goal resume
/goal budget <N|none>
/goal complete
/goal clear
/goal help
```

模型也可以使用 `create_goal`、`get_goal`、`update_goal` 工具。目标状态、累计 tokens 和预算保存在 Pi 会话分支中；达到预算后会停止自动续做。单次用户请求最多自动续做 8 次，之后可继续发消息或运行 `/goal resume`。

## 安装

将 `token-usage.ts`（以及它引用的 `internal/goal-feature.ts`）放入用户扩展目录 `~/.pi/agent/extensions/`；也可以用命令行显式加载：

```bash
pi --extension ./token-usage.ts
```

`token-usage.ts` 使用 Pi 自带的扩展接口；Goal 功能使用 Pi 自带的 `@earendil-works/pi-ai` 工具 schema 和 `@earendil-works/pi-coding-agent` 扩展接口，不需要额外安装依赖。

