# advisor advice port

advisor 是外部评估/打分端口，只提供 `advice`，不产生 verdict，也不阻塞房间。代码、配置和消息统一使用 `advisor`，不再保留其他名字的别名。

## 配置

```bash
ADVISOR_URL=https://advisor.example/evaluate
ADVISOR_TOKEN=...
ADVISOR_TIMEOUT_MS=8000
```

配置只读 `ADVISOR_*`。以后如果要接具体的外部产品，按同样的请求/响应契约新增独立适配器，不把产品名扩散进业务层。

本仓库带一个可独立运行的评估服务：

```bash
npm run advisor:serve
ADVISOR_URL=http://127.0.0.1:8798/evaluate
```

它有两种模式：

- `rules`（默认）：按目标结构、验收命令、证据字段做规则打分，不需要模型。
- `model`：接一个 OpenAI 兼容的 chat completions 端点做语义评估，要求模型只返回 JSON。

```bash
ADVISOR_MODE=model \
ADVISOR_MODEL_URL=http://127.0.0.1:11434/v1/chat/completions \
ADVISOR_MODEL_KEY=... \
ADVISOR_MODEL=你的模型 \
ADVISOR_MODEL_TIMEOUT_MS=20000 \
npm run advisor:serve
```

`ADVISOR_MODE` 未设置时，有 `ADVISOR_MODEL_URL` 就用模型，否则用规则。模型超时、非 2xx、返回不是 JSON 时自动回退规则，并在建议里带 `warning`；Gate 和 Verifier 都不会被阻塞。`GET /health` 返回当前模式和模型，便于确认服务是否真的接上。

它是本地实现，不是外部产品的替代；外部服务只要满足下面的 `ADVISOR_URL` 契约即可接入。

- 未配置 `ADVISOR_URL` 时，客户端返回 `{ available: false, advice: [] }`。
- 超时、HTTP 错误、非法 JSON 同样 fail soft；Gate 和 Verifier 继续按自己的规则工作。

## 请求

`server/crew/advisor.js` 向 `ADVISOR_URL` 发送：

```json
{
  "mode": "gate",
  "goal": "目标",
  "roomType": "studio",
  "plan": {},
  "verify": "test",
  "acceptance": "npm test"
}
```

Verifier 复核时 `mode: "review"`，附带：

```json
{
  "stage": { "title": "...", "acceptance": "...", "manual": false },
  "evidence": { "id": "...", "text": "...", "command": "...", "exit": 0, "diff": "...", "files": [] }
}
```

## 响应

支持直接返回一条建议：

```json
{
  "score": 0.72,
  "summary": "建议补一条回滚测试",
  "reasons": ["缺少回滚测试"],
  "risks": ["依赖外部网络"],
  "missingEvidence": ["rollback.log"],
  "model": "advisor-xxx",
  "version": "2026-11"
}
```

也支持 `{ "advice": [ ... ] }`，最多保留 10 条。

## 使用位置

- **Gate**：建房预置前调用；`advice` 写进 `room.gate`，建房消息、Planner 交接提示里可见。Gate 的结构化 `allow/reject` 不因 advisor 改写。
- **Verifier**：复核请求时调用；追加一条 `advisor_advice` 消息，并把建议放进 Verifier prompt。Verifier 仍独立产出 `verdict`。
- **Planner 的 `check_gate`**：通过 MCP 调用时也会带 advisor 建议返回，不改房间状态。
- 聊天室不调用 advisor。

## 边界

advisor 不是 `roleKind`，不写 `pass`，不替代 Verifier，不因为“建议通过”直接放行。没有 advisor 服务时，Gate 和 Verifier 仍完整可用。
