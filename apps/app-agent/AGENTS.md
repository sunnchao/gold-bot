# Gold Analysis Agent Platform v2.1

Node.js + LangChain + LangGraph 自研 Agent 体系，替代原 Python 分析层。

## ⚠️ AI Agent 约束规则

**1. 版本发布前必须询问用户意见。** 禁止未授权 push。

**2. 策略名与 Magic 号映射是 EA 端的事。** Go 端的 signal.Strategy 必须与 EA 的 Magic 号一致。

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
