# Jev advice port

Jev 是外部评估/打分服务，只提供 `advice`，不产生 verdict，也不阻塞房间。

## 配置

```bash
JEV_URL=https://jev.example/evaluate
JEV_TOKEN=...
JEV_TIMEOUT_MS=8000
```

本仓库带一个可独立运行的评估服务：

```bash
npm run jev:serve
JEV_URL=http://127.0.0.1:8798/evaluate
```

它有两种模式：

- `rules`（默认）：按目标结构、验收命令、证据字段做规则打分，不需要模型。
- `model`：接一个 OpenAI 兼容的 chat completions 端点做语义评估，要求模型只返回 JSON。

```bash
JEV_MODE=model \
JEV_MODEL_URL=http://127.0.0.1:11434/v1/chat/completions \
JEV_MODEL_KEY=... \
JEV_MODEL=你的模型 \
JEV_MODEL_TIMEOUT_MS=20000 \
npm run jev:serve
```

`JEV_MODE` 未设置时，有 `JEV_MODEL_URL` 就用模型，否则用规则。模型超时、非 2xx、返回不是 JSON 时自动回退规则，并在建议里带 `warning`；Gate 和 Verifier 都不会被阻塞。`GET /health` 返回当前模式和模型，便于确认服务是否真的接上。

它是本地实现，不是外部 Jev 产品；外部 Jev 仍用同一个 `JEV_URL` 契约接入。

- 未配置 `JEV_URL` 时，客户端返回 `{ available: false, advice: [] }`。
- 超时、HTTP 错误、非法 JSON 同样 fail soft；Gate 和 Verifier 继续按自己的规则工作。

## 请求

`server/crew/jev.js` 向 `JEV_URL` 发送：

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
  "model": "jev-xxx",
  "version": "2026-11"
}
```

也支持 `{ "advice": [ ... ] }`，最多保留 10 条。

## 使用位置

- **Gate**：建房预置前调用；`advice` 写进 `room.gate`，建房消息、Planner 交接提示里可见。Gate 的结构化 `allow/reject` 不因 Jev 改写。
- **Verifier**：复核请求时调用；追加一条 `jev_advice` 消息，并把建议放进 Verifier prompt。Verifier 仍独立产出 `verdict`。
- **Planner 的 `check_gate`**：通过 MCP 调用时也会带 Jev 建议返回，不改房间状态。
- 聊天室不调用 Jev。

## 边界

Jev 不是 `roleKind`，不写 `pass`，不替代 Verifier，不因为“建议通过”直接放行。没有 Jev 服务时，Gate 和 Verifier 仍完整可用。
