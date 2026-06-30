# Gold Analysis Agent Platform v2.1

Node.js + LangChain + LangGraph 自研 Agent 体系，替代原 Python 分析层。

## ⚠️ AI Agent 约束规则

**1. AI Agent（含 Hermes/Claude/Codex 等）禁止直接修改 TypeScript 源码和配置文件。**
- 所有代码修改必须通过 Codex CLI 代理执行。
- Hermes 自身只能用 patch/write_file 修改非代码文件（.md、.json、.yaml 文档等）。
- 违反此规则可能导致：测试不同步、Codex 上下文缺失、改动不可追溯。

**2. 代码修改流程**
1. GSD 分析 → 写 `.planning/` 文档
2. 写 CODEX_TASK.md（含 Mission/Architecture/Steps/DANGER ZONES/Success Criteria）
3. `cat CODEX_TASK.md | codex exec --yolo` 执行
4. `npm run build` 或 `tsc --noEmit` 验证
5. `git diff --stat HEAD` 检查改动范围

**3. 版本发布前必须询问用户意见。** 禁止未授权 push。

**4. 策略名与 Magic 号映射是 EA 端的事。** Go 端的 signal.Strategy 必须与 EA 的 Magic 号一致。

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

## Architecture

Read SPEC.md for full architecture details.

## Key Files

- `src/main.ts` — NestJS bootstrap
- `src/app.module.ts` — Root Nest module
- `src/graph/workflow.service.ts` — LangGraph workflow service
- `src/graph/workflow-nodes.service.ts` — Workflow node implementations
- `src/agents/` — Injectable agents (technical, sr, mao, risk, publisher)
- `src/tools/` — Injectable goldbot-api/llm-client plus pure indicators
- `src/scheduler/` — Nest BullMQ cron and processor
