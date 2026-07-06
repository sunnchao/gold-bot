# Gold Analysis Agent Platform — 架构重构 SPEC

**版本**: v2.1  
**日期**: 2026-05-01  
**目标**: Python → Node.js + LangChain + LangGraph 自研 AGENT 体系

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Gold Analysis Agent Platform                        │
│                              (Node.js + LangGraph)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
           ┌────────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐
           │  Scheduler   │ │   State     │ │   Store     │
           │  (Bull MQ)   │ │  (Redis)    │ │  (SQLite)   │
           └──────┬───────┘ └─────────────┘ └─────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LangGraph Workflow Engine                          │
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐            │
│  │  Fetch   │───→│ Technical│───→│   Mao    │───→│ Publish  │            │
│  │  Agent   │    │  Analyst │    │Arbitrator│    │  Agent   │            │
│  └──────────┘    └────┬─────┘    └────┬─────┘    └──────────┘            │
│                       │               │                                    │
│                       ▼               ▼                                    │
│                  ┌──────────┐    ┌──────────┐                            │
│                  │   SR     │    │  Risk    │                            │
│                  │  Analyst │    │ Manager  │                            │
│                  └──────────┘    └──────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           gold-bot (Go) — 交易引擎                          │
│                                                                             │
│  GET  /api/v2/analysis_payload/{account}/{symbol}  →  提供多周期指标数据    │
│  POST /api/v2/ai_result/{account}/{symbol}         →  接收 AI 分析结果      │
│  GET  /api/pending_signal/{account}/{symbol}       →  获取待仲裁信号        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 项目结构

```
gold-analysis-agent/                 # 新 Node.js 项目
├── package.json
├── tsconfig.json
├── .env
├── README.md
├── AGENTS.md
│
├── src/
│   ├── main.ts                      # 入口：启动 scheduler + API server
│   ├── config/
│   │   └── index.ts                 # 环境变量、全局配置
│   │
│   ├── types/
│   │   ├── goldbot.ts               # gold-bot API 类型定义
│   │   ├── analysis.ts              # 分析结果类型
│   │   └── agent.ts                 # Agent 状态类型
│   │
│   ├── graph/                       # LangGraph 工作流定义
│   │   ├── state.ts                 # GraphState 定义
│   │   ├── nodes.ts                 # 各 Agent 节点注册
│   │   ├── edges.ts                 # 条件路由边
│   │   └── workflow.ts              # 工作流组装
│   │
│   ├── agents/                      # Agent 实现
│   │   ├── fetch-agent.ts           # 数据获取 Agent
│   │   ├── technical-analyst.ts     # 技术面分析 Agent
│   │   ├── sr-analyst.ts            # 支撑压力位分析 Agent
│   │   ├── mao-arbitrator.ts        # 毛选仲裁 Agent
│   │   ├── risk-manager.ts          # 风险管理 Agent
│   │   └── publisher.ts             # 结果发布 Agent
│   │
│   ├── tools/                       # LangChain Tools
│   │   ├── goldbot-api.ts           # gold-bot HTTP client
│   │   ├── llm-client.ts            # LLM 统一调用层
│   │   ├── indicators.ts            # 指标计算工具
│   │   └── sr-calculator.ts         # 支撑压力位计算
│   │
│   ├── prompts/                     # Prompt 模板
│   │   ├── technical-analysis.txt   # 技术面分析 Prompt
│   │   ├── sr-analysis.txt          # 支撑压力位 Prompt
│   │   ├── mao-arbitration.txt      # 毛选仲裁 Prompt
│   │   └── risk-assessment.txt      # 风险评估 Prompt
│   │
│   ├── scheduler/
│   │   └── index.ts                 # Bull MQ 定时调度器
│   │
│   ├── store/
│   │   ├── redis.ts                 # Redis 连接
│   │   └── sqlite.ts                # SQLite 本地缓存
│   │
│   └── utils/
│       ├── logger.ts                # 结构化日志
│       └── formatter.ts             # 数据格式化
│
├── prompts/                         # 大型 Prompt 文件
│   ├── technical-analysis-v1.txt
│   ├── sr-analysis-v1.txt
│   └── mao-arbitration-v1.txt
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── scripts/
    └── deploy.sh
```

---

## 3. LangGraph 状态机设计

### 3.1 GraphState

```typescript
// src/graph/state.ts

interface AnalysisState {
  // === 输入层 ===
  accountId: string;
  symbol: string;
  timestamp: number;

  // === 原始数据 ===
  payload?: GoldbotPayload;           // /api/analysis_payload 返回
  pendingSignal?: PendingSignal;      // /api/pending_signal 返回

  // === Agent 输出 ===
  technicalAnalysis?: TechnicalAnalysis;  // 技术面分析结果
  srLevels?: SRLevels;                    // 支撑压力位
  arbitration?: ArbitrationResult;        // 毛选仲裁结果
  riskAssessment?: RiskAssessment;        // 风险评估

  // === 最终输出 ===
  finalSignal?: AISignalResult;       // 最终信号（POST 到 gold-bot）

  // === 元数据 ===
  logs: AnalysisLog[];
  errors: string[];
  duration: number;                   // 总耗时 ms
}

// 初始状态工厂
function createInitialState(accountId: string, symbol: string): AnalysisState {
  return {
    accountId,
    symbol,
    timestamp: Date.now(),
    logs: [],
    errors: [],
    duration: 0,
  };
}
```

### 3.2 节点定义

```typescript
// src/graph/nodes.ts

const nodes = {
  // 1. 数据获取
  fetchData: async (state: AnalysisState): Promise<AnalysisState> => {
    const [payload, pendingSignal] = await Promise.all([
      goldbotApi.fetchAnalysisPayload(state.accountId, state.symbol),
      goldbotApi.fetchPendingSignal(state.accountId, state.symbol),
    ]);
    return { ...state, payload, pendingSignal };
  },

  // 2. 技术面分析（并行）
  technicalAnalysis: async (state: AnalysisState): Promise<AnalysisState> => {
    const result = await technicalAnalystAgent.run(state.payload!);
    return { ...state, technicalAnalysis: result };
  },

  // 3. 支撑压力位分析（并行）
  srAnalysis: async (state: AnalysisState): Promise<AnalysisState> => {
    const result = await srAnalystAgent.run(state.payload!);
    return { ...state, srLevels: result };
  },

  // 4. 风险管理（串行，依赖技术面+SR）
  riskAssessment: async (state: AnalysisState): Promise<AnalysisState> => {
    const result = await riskManagerAgent.run({
      technical: state.technicalAnalysis!,
      sr: state.srLevels!,
      payload: state.payload!,
    });
    return { ...state, riskAssessment: result };
  },

  // 5. 毛选仲裁
  maoArbitration: async (state: AnalysisState): Promise<AnalysisState> => {
    const result = await maoArbitratorAgent.run({
      technical: state.technicalAnalysis!,
      risk: state.riskAssessment!,
      payload: state.payload!,
      pendingSignal: state.pendingSignal,
    });
    return { ...state, arbitration: result };
  },

  // 6. 信号合成
  composeSignal: async (state: AnalysisState): Promise<AnalysisState> => {
    const finalSignal = composeFinalSignal(state);
    return { ...state, finalSignal };
  },

  // 7. 发布结果
  publishResult: async (state: AnalysisState): Promise<AnalysisState> => {
    if (state.finalSignal) {
      await goldbotApi.postAIResult(
        state.accountId,
        state.symbol,
        state.finalSignal
      );
    }
    return state;
  },

  // 8. 跳过节点（市场不可交易或仲裁观望）
  skipNode: async (state: AnalysisState): Promise<AnalysisState> => {
    logger.info(`[Skip] ${state.accountId}/${state.symbol} skipped`, {
      reason: !state.payload ? "no_payload" : "market_not_tradeable_or_low_confidence",
      timestamp: state.timestamp,
    });
    return {
      ...state,
      logs: [...state.logs, {
        level: "info" as const,
        message: "Analysis skipped",
        node: "skip",
        timestamp: Date.now(),
      }],
    };
  },

  // 9. 错误处理节点
  errorNode: async (state: AnalysisState): Promise<AnalysisState> => {
    const errorMsg = state.errors.length > 0
      ? state.errors.join("; ")
      : "Unknown error during analysis";
    logger.error(`[Error] ${state.accountId}/${state.symbol} failed`, {
      errors: state.errors,
      timestamp: state.timestamp,
    });
    // 可选：发送告警到飞书
    await publisherAgent.sendAlert(state.accountId, state.symbol, errorMsg).catch(() => {});
    return {
      ...state,
      duration: Date.now() - state.timestamp,
      logs: [...state.logs, {
        level: "error" as const,
        message: errorMsg,
        node: "error",
        timestamp: Date.now(),
      }],
    };
  },
};
```

### 3.3 composeFinalSignal 实现

```typescript
// src/graph/compose-signal.ts

function composeFinalSignal(state: AnalysisState): AISignalResult {
  const { technicalAnalysis, srLevels, arbitration, riskAssessment, payload } = state;

  // 默认为中性观望
  let bias: "bullish" | "bearish" | "neutral" = "neutral";
  let confidence = 0;
  let exitSuggestion: "hold" | "tighten" | "close_partial" | "close_all" = "hold";
  let riskAlert = false;
  let alertReason = "";

  // 1. 仲裁结果为主要信号源
  if (arbitration) {
    switch (arbitration.action) {
      case "开多": bias = "bullish"; break;
      case "开空": bias = "bearish"; break;
      case "持多收紧": bias = "bullish"; exitSuggestion = "tighten"; break;
      case "持空收紧": bias = "bearish"; exitSuggestion = "tighten"; break;
      case "平多": bias = "bearish"; exitSuggestion = "close_all"; break;
      case "平空": bias = "bullish"; exitSuggestion = "close_all"; break;
      default: bias = "neutral"; exitSuggestion = "hold";
    }
    confidence = arbitration.confidence;
  }

  // 2. 技术面确认
  if (technicalAnalysis) {
    if (technicalAnalysis.bias !== bias && technicalAnalysis.bias !== "neutral") {
      confidence = Math.max(confidence - 15, 10);  // 分歧降低置信度
    } else if (technicalAnalysis.bias === bias) {
      confidence = Math.min(confidence + 5, 95);    // 共振提升置信度
    }
    if (technicalAnalysis.exit_suggestion === "close_all") {
      exitSuggestion = "close_all";
    } else if (technicalAnalysis.exit_suggestion === "close_partial" && exitSuggestion === "hold") {
      exitSuggestion = "close_partial";
    }
  }

  // 3. 风险管理覆盖
  if (riskAssessment) {
    if (riskAssessment.riskLevel === "extreme") {
      riskAlert = true;
      alertReason = riskAssessment.warnings?.join("; ") || "extreme risk";
      exitSuggestion = "close_all";
    } else if (riskAssessment.riskLevel === "high") {
      riskAlert = true;
      alertReason = riskAssessment.warnings?.join("; ") || "high risk";
      if (exitSuggestion === "hold") exitSuggestion = "tighten";
    }
  }

  return {
    bias,
    confidence,
    exit_suggestion: exitSuggestion,
    risk_alert: riskAlert,
    alert_reason: alertReason || undefined,
    sr_levels: srLevels ? {
      support_levels: srLevels.support_levels,
      resistance_levels: srLevels.resistance_levels,
      recommendation: srLevels.recommendation,
    } : undefined,
    arbitration: arbitration ? {
      phase: arbitration.phase,
      primary_contradiction: arbitration.primary_contradiction,
      action: arbitration.action,
    } : undefined,
  };
}
```

---

### 3.4 条件路由

```typescript
// src/graph/edges.ts

function routeAfterFetch(state: AnalysisState): string {
  if (!state.payload) {
    return "error";  // 数据获取失败
  }
  if (!state.payload.market_status.tradeable) {
    return "skip";   // 市场不可交易
  }
  return "analyze";  // 正常流程
}

function routeAfterArbitration(state: AnalysisState): string {
  if (state.arbitration?.action === "观望") {
    return "skip_publish";  // 仲裁结果为观望，不发布
  }
  if (state.arbitration?.confidence < 60) {
    return "skip_publish";  // 置信度不足
  }
  return "publish";
}

// routeAfterRisk 已简化为直接边，无需条件路由
// 原始版本中两个分支都返回 "arbitrate"，属于冗余逻辑

// 工作流图
const workflow = new StateGraph(AnalysisState)
  .addNode("fetch", nodes.fetchData)
  .addNode("technical", nodes.technicalAnalysis)
  .addNode("sr", nodes.srAnalysis)
  .addNode("risk", nodes.riskAssessment)
  .addNode("arbitration", nodes.maoArbitration)
  .addNode("compose", nodes.composeSignal)
  .addNode("publish", nodes.publishResult)
  .addNode("skip", nodes.skipNode)
  .addNode("error", nodes.errorNode)

  // 入口
  .addEdge(START, "fetch")

  // fetch 后路由
  .addConditionalEdges("fetch", routeAfterFetch, {
    analyze: "technical",
    skip: "skip",
    error: "error",
  })

  // technical 和 sr 并行
  // ⚠️ LangGraph 并行 fan-in 说明：
  // 当两个并行节点写入同一 state 字段时，LangGraph 默认使用 LastValue reducer，
  // 后写入的值会覆盖先写入的。由于 technical 和 sr 写入不同字段
  // (technicalAnalysis vs srLevels)，所以直接 fan-in 到 risk 节点是安全的。
  // 如果需要并行节点写入同一字段，必须使用 Annotated<T[], reducer> 或 Send API。
  .addEdge("technical", "risk")
  .addEdge("sr", "risk")

  // risk → arbitration 直接边（原 routeAfterRisk 两分支相同，已简化）
  .addEdge("risk", "arbitration")

  // 仲裁后路由
  .addConditionalEdges("arbitration", routeAfterArbitration, {
    publish: "compose",
    skip_publish: "skip",
  })

  .addEdge("compose", "publish")
  .addEdge("publish", END)
  .addEdge("skip", END)
  .addEdge("error", END);
```

---

## 4. Agent 详细设计

### 4.1 Fetch Agent

```typescript
// src/agents/fetch-agent.ts

class FetchAgent {
  async run(accountId: string, symbol: string): Promise<{
    payload: GoldbotPayload;
    pendingSignal: PendingSignal | null;
  }> {
    const start = Date.now();

    const [payload, pendingSignal] = await Promise.all([
      this.fetchPayload(accountId, symbol),
      this.fetchPendingSignal(accountId, symbol),
    ]);

    logger.info(`[Fetch] ${accountId}/${symbol} payload=${payloadSize}B pending=${pendingSignal ? 'yes' : 'no'} ${Date.now() - start}ms`);

    return { payload, pendingSignal };
  }

  private async fetchPayload(accountId: string, symbol: string): Promise<GoldbotPayload> {
    const url = `${config.goldbotApiUrl}/api/v2/analysis_payload/${accountId}/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: { 'X-API-Token': config.goldbotApiToken },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
```

### 4.2 Technical Analyst Agent (LangChain)

```typescript
// src/agents/technical-analyst.ts

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { JsonOutputParser } from "@langchain/core/output_parsers";

class TechnicalAnalystAgent {
  private chain: RunnableSequence;

  constructor() {
    const prompt = ChatPromptTemplate.fromTemplate(`
你是黄金交易技术面分析专家。基于以下多周期指标数据，给出专业的市场分析。

当前市场状态
当前价格: {currentPrice}
品种: {symbol}
账户净值: {equity}
持仓: {positions}

多周期指标
{indicatorTable}

分析要求
趋势判断: H4 定大方向，H1 确认，M30/M15 找时机
矛盾识别: 各周期信号是否一致？如有分歧，哪个是主要矛盾？
阶段判断: 当前处于战略防御/相持/反攻哪个阶段？
操作建议: bullish/bearish/neutral，confidence 0-100
出场建议: hold / tighten / close_partial / close_all

输出格式（严格 JSON）
{{
  "bias": "bullish|bearish|neutral",
  "confidence": 0-100,
  "phase": "防御|相持|反攻",
  "primary_contradiction": "描述主要矛盾",
  "m15_analysis": "M15 分析",
  "m30_analysis": "M30 分析",
  "h1_analysis": "H1 分析",
  "h4_analysis": "H4 分析",
  "exit_suggestion": "hold|tighten|close_partial|close_all",
  "reasoning": "2-3句核心推理"
}}
`);

    this.chain = RunnableSequence.from([
      prompt,
      llmClient.getModel("qwen3.5"),
      new JsonOutputParser<TechnicalAnalysis>(),
    ]);
  }

  async run(payload: GoldbotPayload): Promise<TechnicalAnalysis> {
    const indicatorTable = this.formatIndicators(payload.indicators);

    return this.chain.invoke({
      currentPrice: payload.market.ask,
      symbol: payload.market.symbol,
      equity: payload.account.equity,
      positions: JSON.stringify(payload.positions),
      indicatorTable,
    });
  }

  private formatIndicators(indicators: Record<string, IndicatorPack>): string {
    const timeframes = ["M15", "M30", "H1", "H4"];
    const rows: string[] = [];
    
    // 表头
    rows.push("| 周期 | 价格 | EMA20 | EMA60 | RSI | ADX | MACD | ATR | BB Upper | BB Lower |");
    rows.push("|------|------|-------|-------|-----|-----|------|-----|----------|----------|");
    
    for (const tf of timeframes) {
      const ind = indicators[tf];
      if (!ind) continue;
      rows.push(
        `| ${tf} | ${ind.close?.toFixed(2) ?? "N/A"} | ${ind.EMA20?.toFixed(2) ?? "N/A"} | ${ind.EMA60?.toFixed(2) ?? "N/A"} | ${ind.RSI?.toFixed(1) ?? "N/A"} | ${ind.ADX?.toFixed(1) ?? "N/A"} | ${ind.MACD?.toFixed(4) ?? "N/A"} | ${ind.ATR?.toFixed(2) ?? "N/A"} | ${ind.BBUpper?.toFixed(2) ?? "N/A"} | ${ind.BBLower?.toFixed(2) ?? "N/A"} |`
      );
    }
    
    return rows.join("\n");
  }
}
```

### 4.3 SR Analyst Agent

```typescript
// src/agents/sr-analyst.ts

class SRAnalystAgent {
  async run(payload: GoldbotPayload): Promise<SRLevels> {
    const h1Bars = payload.indicators.H1;
    const h4Bars = payload.indicators.H4;

    // 1. 计算 Swing High/Low
    const swing = this.calculateSwingPoints(h1Bars, 20);

    // 2. 计算 Fibonacci
    const fib = this.calculateFibonacci(swing.high, swing.low);

    // 3. 计算 Pivot Points
    const pivot = this.calculatePivotPoints(h1Bars);

    // 4. 布林带边界
    const bb = {
      upper: h1Bars.BBUpper,
      lower: h1Bars.BBLower,
    };

    // 5. 心理关口
    const psychological = this.findPsychologicalLevels(payload.market.ask);

    // 6. 用 LLM 做最终融合和强度评分
    const result = await this.llmFuse({
      currentPrice: payload.market.ask,
      atr: h1Bars.ATR,
      swing,
      fib,
      pivot,
      bb,
      psychological,
    });

    return result;
  }

  private async llmFuse(data: SRInput): Promise<SRLevels> {
    const prompt = `
基于以下技术面计算结果，融合分析出最关键的支撑和压力位。

当前价格: {currentPrice}
ATR: {atr}

计算结果:
- Swing High: {swingHigh}, Swing Low: {swingLow}
- Fib 382: {fib382}, Fib 618: {fib618}
- Pivot R1: {pivotR1}, Pivot S1: {pivotS1}
- BB Upper: {bbUpper}, BB Lower: {bbLower}
- 心理关口: {psychological}

请输出 JSON:
{{
  "support_levels": [
    {{"price": 4600.0, "strength": 9, "source": "fib_618", "timeframe": "H4"}}
  ],
  "resistance_levels": [
    {{"price": 4630.0, "strength": 8, "source": "prev_high", "timeframe": "H1"}}
  ],
  "recommendation": {{"buy_sl": 4595, "buy_tp1": 4625, "sell_sl": 4635, "sell_tp1": 4605, "buffer_atr": 0.3}},
  "rationale": "..."
}}
`;
    // 调用 LLM...
  }
}
```

### 4.4 Mao Arbitrator Agent

```typescript
// src/agents/mao-arbitrator.ts

const MAO_SYSTEM_PROMPT = `你是黄金交易 AI 仲裁者，用毛泽东《毛选》思维框架分析多周期技术面冲突。

核心心智模型
矛盾分析法 —— 抓主要矛盾
多周期信号分歧时，找出主要矛盾：趋势延续 vs 反转？

实践论 —— 从数据出发
"没有调查就没有发言权"。判断必须基于指标数据。

持久战 —— 判断阶段
战略防御：ADX < 25，趋势转弱
战略相持：ADX 20-25，多空胶着
战略反攻：ADX >= 25，趋势明确

农村包围城市 —— 从边缘到中心
短期(M15/M30)是边缘，长期(H1/H4)是中心
短周期和长周期矛盾时，以长周期为主

纸老虎论 —— 看透本质
战略上藐视：超买不一定是反转
战术上重视：每个信号都要认真对待

统一战线 —— 化解分歧
多周期共振是"统一战线胜利"
分叉是"内部矛盾"

决策规则
H4 定大方向
H1/M30 找入场时机
短周期和长周期矛盾时，以长周期为主
ADX < 20 时趋势指标不可靠
持仓方向与技术面矛盾时，要特别慎重
多周期共振时加大置信度
纸老虎信号要识别

输出格式（严格 JSON）
{
  "final_direction": "bullish|bearish|neutral",
  "confidence": 50-95,
  "primary_contradiction": "一句话描述当前主要矛盾",
  "phase": "防御|相持|反攻",
  "reasoning": "2-3句推理",
  "action": "开多|开空|观望|持多收紧|持空收紧|平多|平空",
  "united_front_analysis": "各周期信号关系描述"
}`;

class MaoArbitratorAgent {
  private chain: RunnableSequence;

  constructor() {
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", MAO_SYSTEM_PROMPT],
      ["human", `
技术面分析结果
{technicalAnalysis}

风险管理评估
{riskAssessment}

当前持仓
{positions}

待仲裁信号（Go 引擎产生）
{pendingSignal}

请基于毛选思维框架进行仲裁。
`],
    ]);

    this.chain = RunnableSequence.from([
      prompt,
      llmClient.getModel("qwen3.5"),
      new JsonOutputParser<ArbitrationResult>(),
    ]);
  }

  async run(input: ArbitrationInput): Promise<ArbitrationResult> {
    return this.chain.invoke({
      technicalAnalysis: JSON.stringify(input.technical),
      riskAssessment: JSON.stringify(input.risk),
      positions: JSON.stringify(input.payload.positions),
      pendingSignal: input.pendingSignal ? JSON.stringify(input.pendingSignal) : "无",
    });
  }
}
```

### 4.5 Risk Manager Agent

```typescript
// src/agents/risk-manager.ts

class RiskManagerAgent {
  async run(input: RiskInput): Promise<RiskAssessment> {
    const { technical, sr, payload } = input;

    // 1. 计算风险指标
    const drawdown = this.calculateDrawdown(payload);
    const riskPerTrade = this.calculateRiskPerTrade(payload);
    const correlationRisk = this.checkCorrelation(payload.positions);

    // 2. 检查 AI 推荐的 SL/TP 是否合理
    const srValid = this.validateSRLevels(sr, payload.market.ask, payload.indicators.H1.ATR);

    // 3. 综合评估
    const riskLevel = this.assessRiskLevel({
      drawdown,
      riskPerTrade,
      correlationRisk,
      srValid,
      confidence: technical.confidence,
    });

    return {
      riskLevel,  // "low" | "medium" | "high" | "extreme"
      maxPositionSize: this.calculateMaxPosition(payload),
      suggestedSL: sr.recommendation,
      warnings: this.generateWarnings(input),
    };
  }

  private validateSRLevels(sr: SRLevels, price: number, atr: number): boolean {
    // 验证 SL 在合理范围内
    // 验证盈亏比 >= 1.5
    // 验证支撑压力位与当前价格的距离合理
    return true;
  }
}
```

### 4.6 Publisher Agent

```typescript
// src/agents/publisher.ts

class PublisherAgent {
  private feishuWebhookUrl: string;
  private goldbotApi: GoldbotAPI;

  constructor() {
    this.feishuWebhookUrl = config.feishuWebhookUrl;
    this.goldbotApi = new GoldbotAPI();
  }

  /**
   * 发布分析结果到 gold-bot + 飞书
   */
  async publish(state: AnalysisState): Promise<void> {
    const { accountId, symbol, finalSignal, arbitration, technicalAnalysis, srLevels } = state;

    if (!finalSignal) {
      logger.warn(`[Publisher] ${accountId}/${symbol} no final signal, skipping`);
      return;
    }

    // 1. POST 到 gold-bot
    try {
      await this.goldbotApi.postAIResult(accountId, symbol, finalSignal);
      logger.info(`[Publisher] ${accountId}/${symbol} result posted to gold-bot`);
    } catch (err) {
      logger.error(`[Publisher] ${accountId}/${symbol} failed to post to gold-bot`, { error: err });
    }

    // 2. 推送到飞书
    try {
      await this.sendFeishuNotification(accountId, symbol, finalSignal, arbitration, srLevels);
      logger.info(`[Publisher] ${accountId}/${symbol} notification sent to Feishu`);
    } catch (err) {
      logger.error(`[Publisher] ${accountId}/${symbol} failed to send Feishu notification`, { error: err });
    }
  }

  /**
   * 发送飞书 Webhook 通知
   */
  private async sendFeishuNotification(
    accountId: string,
    symbol: string,
    signal: AISignalResult,
    arbitration?: ArbitrationResult,
    srLevels?: SRLevels
  ): Promise<void> {
    const emoji = signal.bias === "bullish" ? "🟢" : signal.bias === "bearish" ? "🔴" : "⚪";
    const riskEmoji = signal.risk_alert ? "⚠️" : "✅";

    const card = {
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: `${emoji} AI 分析: ${symbol} (${accountId})` },
          template: signal.bias === "bullish" ? "green" : signal.bias === "bearish" ? "red" : "grey",
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: [
                `**方向**: ${signal.bias.toUpperCase()} | **置信度**: ${signal.confidence}%`,
                `**操作**: ${arbitration?.action || "N/A"} | **出场**: ${signal.exit_suggestion}`,
                `**阶段**: ${arbitration?.phase || "N/A"} | ${riskEmoji} **风险**: ${signal.risk_alert ? "HIGH" : "OK"}`,
                signal.alert_reason ? `**风险原因**: ${signal.alert_reason}` : "",
                arbitration?.primary_contradiction ? `**主要矛盾**: ${arbitration.primary_contradiction}` : "",
              ].filter(Boolean).join("\n"),
            },
          },
          ...(srLevels?.support_levels?.length ? [{
            tag: "div",
            text: {
              tag: "lark_md",
              content: [
                "**支撑位**: " + srLevels.support_levels.slice(0, 3).map(l => `${l.price}(${l.strength})`).join(", "),
                "**压力位**: " + srLevels.resistance_levels.slice(0, 3).map(l => `${l.price}(${l.strength})`).join(", "),
              ].join("\n"),
            },
          }] : []),
          {
            tag: "note",
            elements: [{
              tag: "plain_text",
              content: `⏱ ${new Date().toISOString()} | ${state.duration}ms`,
            }],
          },
        ],
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(this.feishuWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Feishu webhook returned ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 发送告警通知（错误节点使用）
   */
  async sendAlert(accountId: string, symbol: string, errorMsg: string): Promise<void> {
    if (!this.feishuWebhookUrl) return;

    const card = {
      msg_type: "interactive",
      card: {
        header: {
          title: { tag: "plain_text", content: `🚨 AI 分析失败: ${symbol} (${accountId})` },
          template: "red",
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: `**错误**: ${errorMsg}\n**时间**: ${new Date().toISOString()}`,
            },
          },
        ],
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      await fetch(this.feishuWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
        signal: controller.signal,
      });
    } catch (err) {
      logger.error(`[Publisher] Alert send failed for ${accountId}/${symbol}`, { error: err });
    } finally {
      clearTimeout(timer);
    }
  }
}

// 导出单例
export const publisherAgent = new PublisherAgent();
```

---

## 5. 调度系统（Bull MQ）

```typescript
// src/scheduler/index.ts

import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const redis = new IORedis(config.redisUrl);
const analysisQueue = new Queue("gold-analysis", { connection: redis });

// 注册定时任务
export async function registerSchedules() {
  // 每15分钟执行一次
  await analysisQueue.add(
    "analyze",
    { accounts: config.accounts },
    {
      repeat: { cron: "*/15 * * * *" },
      jobId: "gold-analysis-15min",
    }
  );
}

// Worker 处理
const worker = new Worker(
  "gold-analysis",
  async (job) => {
    const { accounts } = job.data;

    // 构建所有 account/symbol 任务组合
    const tasks: Array<{ accountId: string; symbol: string }> = [];
    for (const account of accounts) {
      for (const symbol of account.symbols) {
        tasks.push({ accountId: account.id, symbol });
      }
    }

    // 并行执行所有分析任务
    const results = await Promise.allSettled(
      tasks.map(async ({ accountId, symbol }) => {
        const result = await runAnalysisWorkflow(accountId, symbol);
        logger.info(`[Scheduler] ${accountId}/${symbol} done`, {
          duration: result.duration,
          bias: result.technicalAnalysis?.bias,
          action: result.arbitration?.action,
        });
        return result;
      })
    );

    // 记录失败任务
    const failures = results.filter(r => r.status === "rejected");
    if (failures.length > 0) {
      logger.error(`[Scheduler] ${failures.length}/${tasks.length} tasks failed`, {
        errors: failures.map(f => (f as PromiseRejectedResult).reason?.message),
      });
    }
  },
  {
    connection: redis,
    concurrency: 3,
    // Bull MQ 重试配置
    settings: {
      retryProcessDelay: 5000,
    },
  }
);
```

---

## 6. 与 gold-bot 集成

### 6.1 API Client

```typescript
// src/tools/goldbot-api.ts

class GoldbotAPI {
  private baseUrl: string;
  private token: string;
  private timeout: number = 30_000; // 30s AbortController timeout

  constructor() {
    this.baseUrl = config.goldbotApiUrl;
    this.token = config.goldbotApiToken;
  }

  private createFetchOptions(init?: RequestInit): RequestInit {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    return {
      ...init,
      signal: controller.signal,
      headers: { "X-API-Token": this.token, ...init?.headers },
    } as RequestInit;
  }

  async fetchAnalysisPayload(accountId: string, symbol: string): Promise<GoldbotPayload> {
    const url = `${this.baseUrl}/api/v2/analysis_payload/${accountId}/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, this.createFetchOptions());
    if (!res.ok) throw new Error(`fetchPayload failed: ${res.status}`);
    return res.json();
  }

  async fetchPendingSignal(accountId: string, symbol: string): Promise<PendingSignal | null> {
    const url = `${this.baseUrl}/api/pending_signal/${accountId}/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, this.createFetchOptions());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetchPendingSignal failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  async postAIResult(accountId: string, symbol: string, result: AISignalResult): Promise<void> {
    const url = `${this.baseUrl}/api/v2/ai_result/${accountId}/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, this.createFetchOptions({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(result),
    }));
    if (!res.ok) throw new Error(`postAIResult failed: ${res.status}`);
  }
}
```

### 6.2 结果格式兼容

```typescript
interface AISignalResult {
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  exit_suggestion: "hold" | "tighten" | "close_partial" | "close_all";
  risk_alert: boolean;
  alert_reason?: string;

  // 新增：支撑压力位
  sr_levels?: {
    support_levels: SLevel[];
    resistance_levels: SLevel[];
    recommendation: SLTPRecommendation;
  };

  // 新增：仲裁详情
  arbitration?: {
    phase: string;
    primary_contradiction: string;
    action: string;
  };
}
```

---

## 7. 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                        JP Node (日本 VPS)                   │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐               │
│  │  gold-bot (Go)  │◄──►│  gold-analysis   │               │
│  │  :8880          │    │  (Node.js) :3000 │               │
│  │                 │    │                 │               │
│  │  - 交易引擎      │    │  - LangGraph    │               │
│  │  - 数据存储      │    │  - Bull MQ      │               │
│  │  - 策略执行      │    │  - Redis        │               │
│  └─────────────────┘    └─────────────────┘               │
│           │                        │                        │
│           └────────┬───────────────┘                        │
│                    │                                        │
│           ┌────────▼────────┐                             │
│           │   PostgreSQL    │                             │
│           │   Redis         │                             │
│           └─────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

### Docker Compose

```yaml
version: "3.8"
services:
  gold-analysis-agent:
    build: .
    container_name: gold-analysis-agent
    restart: unless-stopped
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    environment:
      NODE_ENV: production
      GOLDBOT_API_URL: http://gold-bot:8880/
      GOLDBOT_API_TOKEN: ${GOLDBOT_API_TOKEN}
      REDIS_URL: redis://redis:6379
      LLM_PROVIDER: bailian
      LLM_API_KEY: ${BAILIAN_API_KEY}
      SCHEDULE_CRON: "*/15 * * * *"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    depends_on:
      - redis
      - gold-bot

  redis:
    image: redis:7-alpine
    container_name: gold-analysis-redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 256M
        reservations:
          memory: 128M
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

### Dockerfile

```dockerfile
# Dockerfile
# Multi-stage build: node:20 builder → node:20-slim runtime

# === Stage 1: Build ===
FROM node:20 AS builder

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# 复制源码并编译 TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# 生产依赖
RUN npm prune --production

# === Stage 2: Runtime ===
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从 builder 复制编译产物和生产依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 复制 prompts 文件
COPY prompts/ ./prompts/

# 创建数据目录
RUN mkdir -p /app/data /app/logs

# 非 root 用户运行
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

### .env.example

```bash
# .env.example — Gold Analysis Agent Platform v2.1
# 复制此文件为 .env 并填入实际值

# === gold-bot 集成 ===
GOLDBOT_API_URL=http://localhost:8880
GOLDBOT_API_TOKEN=your_goldbot_api_token_here

# === Redis ===
REDIS_URL=redis://localhost:6379

# === LLM 配置 ===
LLM_PROVIDER=bailian                    # bailian | openai | azure
LLM_API_KEY=your_bailian_api_key_here
LLM_MODEL=qwen3.5                      # 默认模型
LLM_FALLBACK_MODEL=qwen2.5             # 备用模型
LLM_TIMEOUT=30000                       # LLM 调用超时 (ms)
LLM_MAX_RETRIES=3                       # LLM 重试次数

# === 调度 ===
SCHEDULE_CRON=*/15 * * * *             # 15分钟间隔

# === 飞书通知 ===
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/your_webhook_id

# === 日志 ===
LOG_LEVEL=info                          # debug | info | warn | error
LOG_FORMAT=json                         # json | pretty

# === 账户配置 (JSON) ===
# 格式: [{"id":"account1","symbols":["XAUUSD","XAUEUR"]}]
ACCOUNTS_CONFIG=[{"id":"default","symbols":["XAUUSD"]}]

# === 应用 ===
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
```

---

## 8. 迁移计划

### Phase 1: 基础设施（1天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 初始化 Node.js 项目 | package.json, tsconfig.json | TypeScript + ESM |
| 1.2 安装依赖 | npm install | LangChain, Bull MQ, ioredis, zod |
| 1.3 配置环境 | .env, src/config/index.ts | 复用现有 gold-analysis 的 .env |
| 1.4 类型定义 | src/types/*.ts | 从 Python 类型迁移 |

### Phase 2: Core Agent（2天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 Fetch Agent | src/agents/fetch-agent.ts | 复用现有 API 调用逻辑 |
| 2.2 gold-bot API Client | src/tools/goldbot-api.ts | HTTP client |
| 2.3 LLM Client | src/tools/llm-client.ts | Bailian/Qwen 统一调用层 |
| 2.4 LangGraph State | src/graph/state.ts | 状态机定义 |
| 2.5 LangGraph Workflow | src/graph/workflow.ts | 工作流组装 |

### Phase 3: Agent 实现（3天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 Technical Analyst | src/agents/technical-analyst.ts | 从 analyze_gold.py 迁移 Prompt |
| 3.2 SR Analyst | src/agents/sr-analyst.ts | 新增：支撑压力位分析 |
| 3.3 Mao Arbitrator | src/agents/mao-arbitrator.ts | 从 mao_arbitrator.py 迁移 |
| 3.4 Risk Manager | src/agents/risk-manager.ts | 新增：风险评估 |
| 3.5 Publisher | src/agents/publisher.ts | 结果回写 + 飞书推送 |

### Phase 4: 调度与部署（1天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 4.1 Bull MQ Scheduler | src/scheduler/index.ts | 每15分钟定时任务 |
| 4.2 Docker 构建 | Dockerfile, docker-compose.yml | 容器化 |
| 4.3 日志系统 | src/utils/logger.ts | 结构化日志（Winston/Pino） |
| 4.4 健康检查 | src/main.ts | /health 端点 |

### Phase 5: 测试与切换（1天）

| 任务 | 说明 |
|------|------|
| 5.1 单元测试 | Jest 测试各 Agent |
| 5.2 集成测试 | 端到端工作流测试 |
| 5.3 并行运行 | Python + Node.js 同时运行，对比输出 |
| 5.4 切换 | 停用 Python cron，启用 Node.js |
| 5.5 监控 | 观察日志，确保无异常 |

**总计：约 8 个工作日**

---

## 9. 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 20 + TypeScript | 生态丰富，LangChain 官方支持好 |
| AI 框架 | LangChain + LangGraph | 状态机工作流，适合多 Agent 协作 |
| 任务队列 | Bull MQ + Redis | 可靠的定时调度，支持重复任务 |
| LLM 提供商 | Bailian (百炼) / DashScope | 复用现有 Qwen API，中文场景优化 |
| 数据缓存 | Redis | Agent 状态共享，结果去重 |
| 本地存储 | SQLite | 轻量，分析结果历史记录 |
| 日志 | Pino | 高性能 JSON 日志 |
| 配置管理 | dotenv + zod | 类型安全的环境变量 |

---

## 10. 与现有系统的兼容性

| 现有组件 | 影响 | 处理方式 |
|----------|------|----------|
| gold-bot Go API | 零改动 | 复用 /api/v2/analysis_payload 和 /api/ai_result |
| gold-bot DB | 新增表 ai_sr_levels | 可选，不影响现有流程 |
| Python analyze_gold.py | 逐步停用 | 并行运行一段时间后停用 |
| Python mao_arbitrator.py | 逐步停用 | Prompt 迁移到 Node.js |
| 飞书推送 | 逻辑迁移 | Publisher Agent 复用现有 webhook |
| Hermes Cron | 替换 | 由 Bull MQ 调度器替代 |

---

## 11. 错误处理与容错

### 11.1 LLM 调用重试

```typescript
// src/tools/llm-client.ts (重试配置)

import pRetry from "p-retry";

class LLMClient {
  private defaultOptions = {
    retries: 3,
    minTimeout: 1_000,
    maxTimeout: 10_000,
    factor: 2, // exponential backoff
  };

  async invoke<T>(modelName: string, prompt: string, options?: { retries?: number }): Promise<T> {
    const maxRetries = options?.retries ?? this.defaultOptions.retries;

    return pRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.llmTimeout);

        try {
          const model = this.getModel(modelName);
          const result = await model.invoke(prompt, { signal: controller.signal });
          return result;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        retries: maxRetries,
        minTimeout: this.defaultOptions.minTimeout,
        maxTimeout: this.defaultOptions.maxTimeout,
        factor: this.defaultOptions.factor,
        onFailedAttempt: (error) => {
          logger.warn(`[LLM] Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, {
            error: error.message,
            model: modelName,
          });
        },
      }
    );
  }
}
```

### 11.2 Circuit Breaker（熔断器）

```typescript
// src/utils/circuit-breaker.ts

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly threshold: number = 5,      // 连续失败次数触发熔断
    private readonly resetTimeout: number = 60_000, // 熔断恢复时间 (ms)
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = "half-open";
        logger.info("[CircuitBreaker] Half-open, attempting request");
      } else {
        throw new Error("Circuit breaker is open");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
      logger.error(`[CircuitBreaker] OPEN after ${this.failures} consecutive failures`);
    }
  }
}

// 全局实例
export const llmCircuitBreaker = new CircuitBreaker(5, 60_000);
export const apiCircuitBreaker = new CircuitBreaker(3, 30_000);
```

### 11.3 超时配置汇总

| 组件 | 超时 | 重试 | 说明 |
|------|------|------|------|
| LLM 调用 | 30s | 3次 exponential | p-retry + AbortController |
| gold-bot API | 30s | 2次 exponential | AbortController |
| 飞书 Webhook | 15s | 1次 | AbortController |
| Bull MQ Job | 5min | 3次 exponential | Bull MQ 内置 |
| Redis 连接 | 5s | 自动重连 | ioredis 默认 |

### 11.4 JSON 解析容错

```typescript
// JsonOutputParser 包装器，处理 LLM 输出格式异常
function safeJsonParse<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    // 1. 尝试直接解析
    return schema.parse(JSON.parse(raw));
  } catch {
    try {
      // 2. 尝试提取 JSON 块（LLM 可能输出 markdown 代码块）
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return schema.parse(JSON.parse(match[1].trim()));

      // 3. 尝试找到第一个 { 和最后一个 }
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        return schema.parse(JSON.parse(raw.slice(start, end + 1)));
      }
    } catch { /* fall through */ }
    return null;
  }
}
```

---

## 12. 监控与可观测性

### 12.1 Prometheus Metrics

```typescript
// src/utils/metrics.ts

import { Counter, Histogram, Gauge } from "prom-client";

// 分析任务指标
export const analysisTotal = new Counter({
  name: "gold_analysis_total",
  help: "Total number of analysis runs",
  labelNames: ["account", "symbol", "status"], // status: success|failed|skipped
});

export const analysisDuration = new Histogram({
  name: "gold_analysis_duration_seconds",
  help: "Analysis workflow duration in seconds",
  labelNames: ["account", "symbol"],
  buckets: [5, 10, 15, 20, 30, 45, 60],
});

// LLM 指标
export const llmCallsTotal = new Counter({
  name: "gold_llm_calls_total",
  help: "Total LLM API calls",
  labelNames: ["model", "status"], // status: success|failed|timeout
});

export const llmDuration = new Histogram({
  name: "gold_llm_duration_seconds",
  help: "LLM call duration in seconds",
  labelNames: ["model"],
  buckets: [1, 2, 5, 10, 15, 20, 30],
});

export const llmTokensUsed = new Counter({
  name: "gold_llm_tokens_total",
  help: "Total tokens consumed",
  labelNames: ["model", "direction"], // direction: input|output
});

// gold-bot API 指标
export const goldbotApiCalls = new Counter({
  name: "gold_goldbot_api_calls_total",
  help: "gold-bot API calls",
  labelNames: ["endpoint", "status"],
});

export const goldbotApiDuration = new Histogram({
  name: "gold_goldbot_api_duration_seconds",
  help: "gold-bot API call duration",
  labelNames: ["endpoint"],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// 系统指标
export const activeAnalyses = new Gauge({
  name: "gold_active_analyses",
  help: "Currently running analysis workflows",
});

export const queueDepth = new Gauge({
  name: "gold_queue_depth",
  help: "Bull MQ queue depth",
  labelNames: ["queue"],
});
```

### 12.2 结构化日志规范

```typescript
// src/utils/logger.ts

import pino from "pino";

export const logger = pino({
  level: config.logLevel,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: "gold-analysis-agent",
    version: "2.1",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// 日志字段规范
// 必须字段: timestamp, level, service, message
// 上下文字段: accountId, symbol, node (LangGraph 节点名)
// 性能字段: duration, tokenCount
// 错误字段: error (Error 对象), stack
```

### 12.3 告警规则

| 告警 | 条件 | 严重级别 | 通知方式 |
|------|------|----------|----------|
| 分析连续失败 | 连续 3 次任务失败 | 🔴 Critical | 飞书 + Discord |
| LLM 超时率高 | 5分钟内超时率 > 50% | 🟡 Warning | 飞书 |
| gold-bot 不可达 | API 连续 3 次超时 | 🔴 Critical | 飞书 + Discord |
| 队列积压 | 队列深度 > 10 | 🟡 Warning | 飞书 |
| 内存使用高 | 容器内存 > 80% | 🟡 Warning | Docker events |
| 分析延迟过高 | 单次分析 > 60s | 🟡 Warning | 飞书 |

### 12.4 健康检查端点

```typescript
// src/main.ts 中的健康检查

app.get("/health", async (req, res) => {
  const checks = {
    redis: false,
    goldbot: false,
    llm: false,
  };

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${config.goldbotApiUrl}/health`, { signal: controller.signal });
    checks.goldbot = res.ok;
  } catch {}

  const allHealthy = Object.values(checks).every(Boolean);
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    checks,
    uptime: process.uptime(),
    version: "2.1",
  });
});
```

---

## 13. 回滚策略

### 13.1 回滚触发条件

- Node.js 版本连续 3 次调度周期（45分钟）产生错误分析结果
- 与 gold-bot 集成失败（API 不兼容）
- 内存泄漏或性能严重退化

### 13.2 回滚步骤

```bash
# Step 1: 停止 Node.js 版本
docker compose stop gold-analysis-agent

# Step 2: 恢复 Python 版本 cron
# 在 Hermes Agent 中重新启用 Python 分析 cron
hermes cron enable gold-analysis-python

# Step 3: 验证 Python 版本正常
curl -s http://localhost:8880/api/v2/analysis_payload/default/XAUUSD | jq .market_status

# Step 4: 清理（可选）
docker compose down gold-analysis-agent
```

### 13.3 并行运行期间的数据隔离

```typescript
// 并行运行时，Node.js 版本使用不同的 ai_result 端点路径
// 避免与 Python 版本冲突
const PARALLEL_MODE = process.env.PARALLEL_MODE === "true";
const apiPath = PARALLEL_MODE
  ? `/api/v2/ai_result_v2/${accountId}/${symbol}`  // v2 端点
  : `/api/v2/ai_result/${accountId}/${symbol}`;      // 正式端点
```

### 13.4 回滚检查清单

- [ ] Python 版本 cron 已恢复运行
- [ ] gold-bot 收到 Python 版本的分析结果
- [ ] 飞书通知恢复正常
- [ ] Node.js 容器已停止（节省资源）
- [ ] 日志中无错误

---

## 14. 安全考虑

### 14.1 API Token 安全

```typescript
// Token 轮换机制
class TokenManager {
  private currentToken: string;
  private previousToken: string | null = null;
  private rotateAt: number;

  constructor() {
    this.currentToken = config.goldbotApiToken;
    this.rotateAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30天后轮换
  }

  getToken(): string {
    if (Date.now() > this.rotateAt) {
      logger.warn("[TokenManager] Token rotation needed — please update GOLDBOT_API_TOKEN");
      // 发送飞书告警
    }
    return this.currentToken;
  }

  // 支持双 token 过渡期
  rotate(newToken: string) {
    this.previousToken = this.currentToken;
    this.currentToken = newToken;
    this.rotateAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    logger.info("[TokenManager] Token rotated successfully");
  }
}
```

### 14.2 输入验证

```typescript
// src/config/validation.ts

import { z } from "zod";

const AccountSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Invalid account ID format"),
  symbols: z.array(z.string().regex(/^[A-Z]{3,10}$/, "Invalid symbol format")).min(1),
});

const ConfigSchema = z.object({
  goldbotApiUrl: z.string().url(),
  goldbotApiToken: z.string().min(16),
  redisUrl: z.string().url(),
  llmApiKey: z.string().min(8),
  accounts: z.array(AccountSchema).min(1),
  feishuWebhookUrl: z.string().url().optional(),
});

// 启动时验证
export function validateConfig(raw: unknown) {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    logger.error("[Config] Validation failed", { errors: result.error.issues });
    process.exit(1);
  }
  return result.data;
}
```

### 14.3 Prompt 注入防护

```typescript
// src/utils/sanitize.ts

/**
 * 清洗用户输入，防止 Prompt 注入
 * - 移除可能的指令注入模式
 * - 限制输入长度
 * - 转义特殊字符
 */
function sanitizeForPrompt(input: string, maxLength: number = 2000): string {
  return input
    .slice(0, maxLength)
    // 移除可能的指令注入
    .replace(/\b(ignore|forget|disregard)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi, "[FILTERED]")
    .replace(/\b(system|assistant|user)\s*:/gi, "[FILTERED]:")
    .replace(/```/g, "[FILTERED]")
    .trim();
}

// 在 Agent 调用 LLM 前清洗所有外部输入
function sanitizePayload(payload: GoldbotPayload): GoldbotPayload {
  return {
    ...payload,
    // 市场数据是数值型，不需要清洗
    // 但 positions 的 comment 字段可能包含用户输入
    positions: payload.positions.map(p => ({
      ...p,
      comment: sanitizeForPrompt(p.comment || ""),
    })),
  };
}
```

### 14.4 速率限制

```typescript
// API 端点速率限制
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 30,                   // 每分钟最多30次请求
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

app.use("/api/", apiLimiter);
```

### 14.5 LLM 输出安全过滤

```typescript
// LLM 输出内容安全检查
function validateLLMOutput(result: ArbitrationResult): ArbitrationResult {
  // 1. 置信度范围检查
  if (result.confidence < 0 || result.confidence > 100) {
    logger.warn("[Safety] LLM returned out-of-range confidence", { confidence: result.confidence });
    result.confidence = Math.max(0, Math.min(100, result.confidence));
  }

  // 2. action 白名单
  const validActions = ["开多", "开空", "观望", "持多收紧", "持空收紧", "平多", "平空"];
  if (!validActions.includes(result.action)) {
    logger.error("[Safety] LLM returned invalid action", { action: result.action });
    result.action = "观望";
    result.confidence = Math.min(result.confidence, 30);
  }

  // 3. direction 白名单
  const validDirections = ["bullish", "bearish", "neutral"];
  if (!validDirections.includes(result.final_direction)) {
    logger.error("[Safety] LLM returned invalid direction", { direction: result.final_direction });
    result.final_direction = "neutral";
  }

  return result;
}
```

