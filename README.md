# Pi Token Usage + Persistent Goals

这个 Pi 扩展包含实时 token 用量、`/init` 项目指南生成、持久化 Goal、中文工作状态和严格 Tab 消息队列。只加载 `token-usage.ts`，它会注册其余内部功能。

## `/init` 项目指南

运行 `/init` 会让 agent 检查当前项目并创建 200–400 词的 `AGENTS.md`，内容包括项目结构、开发与测试命令、代码风格和提交规范。提示明确要求先检查当前工作目录；如果 `AGENTS.md` 已存在，不得覆盖或修改。任务繁忙时，初始化请求会排在当前任务之后。

## 实时 Token 用量

在 TUI/RPC 状态栏显示当前会话用量：

- `↑` 输入 tokens（发送到模型的上下文）
- `↓` 输出 tokens（模型生成并返回的内容）
- `cache R/W` 缓存读取/写入 tokens（provider 提供时显示）
- 估算费用（provider 提供时显示）
- 流式生成期间刷新，回合结束后显示当前分支累计值

不同 provider 对流式中间 usage 的支持不同。中间用量不可用时会以 `~` 标出估算值；最终累计值使用回合结束后 provider 返回的 usage。

## 中文工作状态

模型工作或思考时，扩展会隐藏 Pi 默认的 `Working` 状态，随机显示并轮换 `D:\Downloads\claude-code-zh-cn-main\verbs\zh-CN.json` 中的 `verbs`。默认每 1.6 秒轮换一次，并避免连续显示同一项。

可以用 `PI_WORKING_VERBS_FILE` 指定其他 JSON 文件。文件格式为：

```json
{
  "mode": "replace",
  "verbs": ["架构中", "推敲中", "生成中"]
}
```

文件读取失败或列表为空时使用内置中文状态作为 fallback。

## 严格 Tab 消息队列

普通消息在编辑器中按 Tab 会进入严格队列；只有上一条消息对应的整个模型任务完全结束后才发送下一条，单个命令或工具执行结束不会提前触发下一条，队列消息不会并发触发多个回合。空输入和以 `/` 开头的命令保留 Pi 原有行为，因此命令仍可使用 Pi 的 Tab 补全。

队列显示在编辑器上方，支持鼠标 `[编辑]`、`[删除]`，也可以使用：

```text
/queue
/queue edit
/queue delete
/queue clear
```

## 持久化 Goal

直接使用 `/goal <objective>` 创建并立即开始目标；预算可以放在目标文本中：

```text
/goal 完成插件功能并运行测试 --budget 50000
```

命令补全会提供保留子命令和预算值；自由格式目标不会被补全吞掉。完整命令如下：

```text
/goal <objective> [--budget N]
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

推荐通过 npm 安装（需要 Pi 1.4.0 或更高版本）：

```bash
pi install npm:@paojiao134/pi-token-usage
```

安装后重启 Pi，或在运行中的会话执行 `/reload`。如需手动安装，将以下文件保持相对路径放入用户扩展目录 `~/.pi/agent/extensions/`：

```text
token-usage.ts
internal/goal-feature.ts
internal/init-feature.ts
internal/working-verb.ts
internal/strict-message-queue.ts
```

也可以在项目目录中显式加载：

```bash
pi --extension ./token-usage.ts
```

`token-usage.ts` 使用 Pi 自带的扩展接口；不需要额外安装依赖。

## 测试

```bash
node --experimental-strip-types tests/working-verb.test.ts
node --experimental-strip-types tests/strict-message-queue.test.ts
node --experimental-strip-types tests/goal-command.test.ts
node --experimental-strip-types tests/init-command.test.ts
```

