# Pi Token Usage

一个 Pi 扩展，在 TUI/RPC 底部状态栏实时显示当前会话的 token 使用情况：

- `↑` 输入 tokens（发送到模型的上下文）
- `↓` 输出 tokens（模型生成并返回的内容）
- `cache R/W` 缓存读取/写入 tokens（provider 提供时显示）
- 估算费用（provider 提供时显示）
- 流式生成期间实时刷新，回合结束后显示该会话分支的累计值

## 安装

将 `token-usage.ts` 放入项目扩展目录，或直接运行：

```bash
pi --extension ./token-usage.ts
```

也可以复制到用户扩展目录：

```text
~/.pi/agent/extensions/token-usage.ts
```

扩展只依赖 Pi 自带的 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 类型，不需要额外安装依赖。

## 说明

不同 provider 对流式中间 usage 的支持不同。实时统计使用 provider 提供的 usage；若尚无中间 usage，状态栏会用 `~` 标识近似值（输出根据已生成文本估算，输入参考 Pi 上下文用量）；最终累计值使用回合结束后 provider 返回的 usage。
