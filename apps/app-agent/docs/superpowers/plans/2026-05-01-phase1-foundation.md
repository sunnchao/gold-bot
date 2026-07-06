# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the project foundation for Gold Analysis Agent Platform — config, types, logger, goldbot-api client, and LLM client — so Phase 2 agents can be built on top.

**Architecture:** ESM-only Node.js 20+ project with TypeScript (NodeNext module resolution). All environment variables validated at startup via zod schemas. Structured JSON logging via pino. HTTP client for gold-bot with 30s timeout and exponential-backoff retry. LangChain ChatOpenAI wrapper configured for Bailian/DashScope (Qwen models).

**Tech Stack:** TypeScript 5.5+, Node.js 20+, zod, pino, p-retry, @langchain/core, @langchain/openai, vitest, tsx (dev runner)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | Project metadata, scripts, dependencies |
| `tsconfig.json` | TypeScript compiler options (ESM, NodeNext) |
| `.env.example` | Environment variable template |
| `.gitignore` | Git ignore patterns |
| `src/config/index.ts` | Load, validate, and export typed config |
| `src/types/goldbot.ts` | gold-bot API request/response types |
| `src/types/analysis.ts` | Analysis result types (TechnicalAnalysis, SRLevels, ArbitrationResult, RiskAssessment) |
| `src/types/agent.ts` | LangGraph state types (AnalysisState, AISignalResult, AnalysisLog) |
| `src/utils/logger.ts` | Pino logger singleton |
| `src/tools/goldbot-api.ts` | gold-bot HTTP client with retry/timeout |
| `src/tools/llm-client.ts` | LangChain ChatOpenAI wrapper for Bailian/Qwen |
| `tests/unit/config.test.ts` | Config validation tests |
| `tests/unit/logger.test.ts` | Logger tests |
| `tests/unit/goldbot-api.test.ts` | goldbot-api client tests |
| `tests/unit/llm-client.test.ts` | LLM client tests |

---

### Task 1: Create package.json + tsconfig.json + .env.example + .gitignore

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "gold-analysis-agent",
  "version": "2.1.0",
  "description": "Gold Analysis Agent Platform — Node.js + LangChain + LangGraph",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "keywords": ["gold", "analysis", "langchain", "langgraph", "trading"],
  "license": "UNLICENSED",
  "private": true
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create .env.example**

```bash
# .env.example — Gold Analysis Agent Platform v2.1
# Copy this file to .env and fill in actual values

# === gold-bot integration ===
GOLDBOT_API_URL=http://localhost:8880
GOLDBOT_API_TOKEN=your_golddot_token_here

# === Redis ===
REDIS_URL=redis://localhost:6379

# === LLM Configuration ===
LLM_PROVIDER=bailian                    # bailian | openai | azure
LLM_API_KEY=your_bailian_api_key_here
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus                    # default model
LLM_FALLBACK_MODEL=qwen-turbo          # fallback model
LLM_TIMEOUT=30000                       # LLM call timeout (ms)
LLM_MAX_RETRIES=3                       # LLM retry count

# === Scheduling ===
SCHEDULE_CRON=*/15 * * * *             # 15-minute interval

# === Feishu Notification ===
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/your_webhook_id

# === Logging ===
LOG_LEVEL=info                          # debug | info | warn | error
LOG_FORMAT=json                         # json | pretty

# === Account Configuration (JSON) ===
# Format: [{"id":"account1","symbols":["XAUUSD","XAUEUR"]}]
ACCOUNTS_CONFIG=[{"id":"default","symbols":["XAUUSD"]}]

# === Application ===
NODE_ENV=development
PORT=3000
DATA_DIR=./data
```

- [ ] **Step 4: Create .gitignore**

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log

# Data
data/
*.db
*.sqlite

# Test coverage
coverage/

# TypeScript cache
*.tsbuildinfo
```

- [ ] **Step 5: Install all dependencies**

Run:
```bash
cd /root/gold-analysis-agent
npm install zod pino p-retry @langchain/core @langchain/openai
npm install -D typescript tsx vitest @types/node pino-pretty
```

Expected: `package.json` and `package-lock.json` updated, `node_modules/` created.

- [ ] **Step 6: Verify TypeScript compilation**

Create a temporary file to verify the config works:
```bash
cd /root/gold-analysis-agent
echo 'console.log("hello")' > /tmp/check.ts
npx tsc --noEmit --project tsconfig.json 2>&1 || true
```

Expected: No errors (no source files yet is fine, tsc will just succeed silently).

- [ ] **Step 7: Commit**

```bash
cd /root/gold-analysis-agent
git add package.json package-lock.json tsconfig.json .env.example .gitignore
git commit -m "feat: initialize project with package.json, tsconfig, .env.example, .gitignore"
```

---

### Task 2: Create src/config/index.ts with zod validation

**Files:**
- Create: `src/config/index.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("config", () => {
  const validEnv = {
    GOLDBOT_API_URL: "http://localhost:8880",
    GOLDBOT_API_TOKEN: "a".repeat(20),
    REDIS_URL: "redis://localhost:6379",
    LLM_API_KEY: "sk-" + "a".repeat(10),
    LLM_PROVIDER: "bailian",
    LLM_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    LLM_MODEL: "qwen-plus",
    LLM_FALLBACK_MODEL: "qwen-turbo",
    LLM_TIMEOUT: "30000",
    LLM_MAX_RETRIES: "3",
    LOG_LEVEL: "info",
    LOG_FORMAT: "json",
    ACCOUNTS_CONFIG: '[{"id":"default","symbols":["XAUUSD"]}]',
    NODE_ENV: "development",
    PORT: "3000",
    FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/abc123",
    SCHEDULE_CRON: "*/15 * * * *",
    DATA_DIR: "./data",
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("should parse valid config", async () => {
    vi.stubEnv("GOLDBOT_API_URL", validEnv.GOLDBOT_API_URL);
    vi.stubEnv("GOLDBOT_API_TOKEN", validEnv.GOLDBOT_API_TOKEN);
    vi.stubEnv("REDIS_URL", validEnv.REDIS_URL);
    vi.stubEnv("LLM_API_KEY", validEnv.LLM_API_KEY);
    vi.stubEnv("LLM_PROVIDER", validEnv.LLM_PROVIDER);
    vi.stubEnv("LLM_BASE_URL", validEnv.LLM_BASE_URL);
    vi.stubEnv("LLM_MODEL", validEnv.LLM_MODEL);
    vi.stubEnv("LLM_FALLBACK_MODEL", validEnv.LLM_FALLBACK_MODEL);
    vi.stubEnv("LLM_TIMEOUT", validEnv.LLM_TIMEOUT);
    vi.stubEnv("LLM_MAX_RETRIES", validEnv.LLM_MAX_RETRIES);
    vi.stubEnv("LOG_LEVEL", validEnv.LOG_LEVEL);
    vi.stubEnv("LOG_FORMAT", validEnv.LOG_FORMAT);
    vi.stubEnv("ACCOUNTS_CONFIG", validEnv.ACCOUNTS_CONFIG);
    vi.stubEnv("NODE_ENV", validEnv.NODE_ENV);
    vi.stubEnv("PORT", validEnv.PORT);
    vi.stubEnv("FEISHU_WEBHOOK_URL", validEnv.FEISHU_WEBHOOK_URL);
    vi.stubEnv("SCHEDULE_CRON", validEnv.SCHEDULE_CRON);
    vi.stubEnv("DATA_DIR", validEnv.DATA_DIR);

    const { loadConfig } = await import("../../src/config/index.js");
    const cfg = loadConfig();

    expect(cfg.goldbotApiUrl).toBe("http://localhost:8880");
    expect(cfg.goldbotApiToken).toBe("a".repeat(20));
    expect(cfg.redisUrl).toBe("redis://localhost:6379");
    expect(cfg.llmProvider).toBe("bailian");
    expect(cfg.llmModel).toBe("qwen-plus");
    expect(cfg.llmFallbackModel).toBe("qwen-turbo");
    expect(cfg.llmTimeout).toBe(30000);
    expect(cfg.llmMaxRetries).toBe(3);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.logFormat).toBe("json");
    expect(cfg.accounts).toEqual([{ id: "default", symbols: ["XAUUSD"] }]);
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.port).toBe(3000);
    expect(cfg.feishuWebhookUrl).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/abc123");
    expect(cfg.scheduleCron).toBe("*/15 * * * *");
  });

  it("should throw on missing required env vars", async () => {
    // Clear all env
    for (const key of Object.keys(validEnv)) {
      vi.stubEnv(key, "");
    }

    const { loadConfig } = await import("../../src/config/index.js");
    expect(() => loadConfig()).toThrow();
  });

  it("should throw on invalid account JSON", async () => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("ACCOUNTS_CONFIG", "not-json");

    const { loadConfig } = await import("../../src/config/index.js");
    expect(() => loadConfig()).toThrow();
  });

  it("should apply defaults for optional fields", async () => {
    for (const [key, value] of Object.entries(validEnv)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("FEISHU_WEBHOOK_URL", "");

    const { loadConfig } = await import("../../src/config/index.js");
    const cfg = loadConfig();
    expect(cfg.feishuWebhookUrl).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/config.test.ts 2>&1 | tail -20
```

Expected: FAIL — module `../../src/config/index.js` not found.

- [ ] **Step 3: Write the implementation**

Create `src/config/index.ts`:

```typescript
import { z } from "zod";

// --- Schemas ---

const AccountSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Invalid account ID format"),
  symbols: z
    .array(z.string().regex(/^[A-Z]{2,10}$/, "Invalid symbol format"))
    .min(1, "At least one symbol required"),
});

const LlmProviderSchema = z.enum(["bailian", "openai", "azure"]);

const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const LogFormatSchema = z.enum(["json", "pretty"]);

const EnvSchema = z.object({
  GOLDBOT_API_URL: z.string().url("GOLDBOT_API_URL must be a valid URL"),
  GOLDBOT_API_TOKEN: z.string().min(16, "GOLDBOT_API_TOKEN must be at least 16 chars"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),
  LLM_API_KEY: z.string().min(8, "LLM_API_KEY must be at least 8 chars"),
  LLM_PROVIDER: LlmProviderSchema.default("bailian"),
  LLM_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  LLM_MODEL: z.string().min(1).default("qwen-plus"),
  LLM_FALLBACK_MODEL: z.string().min(1).default("qwen-turbo"),
  LLM_TIMEOUT: z.coerce.number().int().positive().default(30000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  LOG_LEVEL: LogLevelSchema.default("info"),
  LOG_FORMAT: LogFormatSchema.default("json"),
  ACCOUNTS_CONFIG: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(z.array(AccountSchema).min(1, "At least one account required")),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  FEISHU_WEBHOOK_URL: z.string().url().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  SCHEDULE_CRON: z.string().min(1).default("*/15 * * * *"),
  DATA_DIR: z.string().min(1).default("./data"),
});

// --- Types ---

export type AccountConfig = z.infer<typeof AccountSchema>;
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export interface AppConfig {
  goldbotApiUrl: string;
  goldbotApiToken: string;
  redisUrl: string;
  llmProvider: LlmProvider;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmFallbackModel: string;
  llmTimeout: number;
  llmMaxRetries: number;
  logLevel: z.infer<typeof LogLevelSchema>;
  logFormat: z.infer<typeof LogFormatSchema>;
  accounts: AccountConfig[];
  nodeEnv: "development" | "production" | "test";
  port: number;
  feishuWebhookUrl?: string;
  scheduleCron: string;
  dataDir: string;
}

// --- Loader ---

let _config: AppConfig | undefined;

/**
 * Load and validate configuration from process.env.
 * Throws ZodError with detailed messages on validation failure.
 * Caches result — subsequent calls return the same instance.
 */
export function loadConfig(): AppConfig {
  if (_config) return _config;

  const raw = EnvSchema.parse(process.env);

  _config = {
    goldbotApiUrl: raw.GOLDBOT_API_URL.replace(/\/+$/, ""), // strip trailing slashes
    goldbotApiToken: raw.GOLDBOT_API_TOKEN,
    redisUrl: raw.REDIS_URL,
    llmProvider: raw.LLM_PROVIDER,
    llmApiKey: raw.LLM_API_KEY,
    llmBaseUrl: raw.LLM_BASE_URL,
    llmModel: raw.LLM_MODEL,
    llmFallbackModel: raw.LLM_FALLBACK_MODEL,
    llmTimeout: raw.LLM_TIMEOUT,
    llmMaxRetries: raw.LLM_MAX_RETRIES,
    logLevel: raw.LOG_LEVEL,
    logFormat: raw.LOG_FORMAT,
    accounts: raw.ACCOUNTS_CONFIG,
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    feishuWebhookUrl: raw.FEISHU_WEBHOOK_URL,
    scheduleCron: raw.SCHEDULE_CRON,
    dataDir: raw.DATA_DIR,
  };

  return _config;
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  _config = undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/config.test.ts 2>&1 | tail -20
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/gold-analysis-agent
git add src/config/index.ts tests/unit/config.test.ts
git commit -m "feat: add config module with zod validation"
```

---

### Task 3: Create src/types/goldbot.ts with all gold-bot API types

**Files:**
- Create: `src/types/goldbot.ts`

- [ ] **Step 1: Write the types file**

Create `src/types/goldbot.ts`:

```typescript
/**
 * gold-bot API types — maps to the Go backend REST endpoints.
 *
 * Endpoints:
 *   GET  /api/v2/analysis_payload/{account}/{symbol}  → GoldbotPayload
 *   GET  /api/pending_signal/{account}/{symbol}        → PendingSignal | null
 *   POST /api/v2/ai_result/{account}/{symbol}          → AISignalResult (see agent.ts)
 */

// --- Market data ---

export interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  time: string; // ISO 8601
}

// --- Account info ---

export interface AccountInfo {
  id: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  currency: string;
}

// --- Position ---

export interface Position {
  ticket: number;
  symbol: string;
  type: "buy" | "sell";
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  swap: number;
  commission: number;
  sl: number;
  tp: number;
  openTime: string; // ISO 8601
  comment: string;
  magic: number;
}

// --- Market status ---

export interface MarketStatus {
  tradeable: boolean;
  reason?: string; // why not tradeable, if applicable
  session?: string; // e.g., "asian", "european", "american"
  nextOpenTime?: string; // ISO 8601
}

// --- Indicator pack (per timeframe) ---

export interface IndicatorPack {
  timeframe: string; // "M15" | "M30" | "H1" | "H4"
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;

  // Moving averages
  EMA20?: number;
  EMA60?: number;
  SMA50?: number;
  SMA200?: number;

  // Oscillators
  RSI?: number;
  MACD?: number;
  MACDSignal?: number;
  MACDHist?: number;
  StochK?: number;
  StochD?: number;

  // Trend
  ADX?: number;
  DIPlus?: number;
  DIMinus?: number;

  // Volatility
  ATR?: number;
  BBUpper?: number;
  BBMiddle?: number;
  BBLower?: number;

  // Additional indicators (dynamic keys from Go backend)
  [key: string]: number | string | undefined;
}

// --- Analysis payload (main response) ---

export interface GoldbotPayload {
  market: MarketData;
  account: AccountInfo;
  positions: Position[];
  market_status: MarketStatus;
  indicators: Record<string, IndicatorPack>; // keyed by timeframe: "M15", "M30", "H1", "H4"
  analysis_context?: {
    lastAnalysisTime?: string;
    lastBias?: string;
    lastConfidence?: number;
    consecutiveErrors?: number;
  };
}

// --- Pending signal (from Go engine) ---

export interface PendingSignal {
  id: number;
  account: string;
  symbol: string;
  signal_type: string; // e.g., "ma_cross", "rsi_divergence", "breakout"
  direction: "buy" | "sell";
  confidence: number;
  price: number;
  time: string; // ISO 8601
  source: string; // which Go strategy generated this
  metadata?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run:
```bash
cd /root/gold-analysis-agent
npx tsc --noEmit src/types/goldbot.ts 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /root/gold-analysis-agent
git add src/types/goldbot.ts
git commit -m "feat: add gold-bot API types"
```

---

### Task 4: Create src/types/analysis.ts with all analysis result types

**Files:**
- Create: `src/types/analysis.ts`

- [ ] **Step 1: Write the types file**

Create `src/types/analysis.ts`:

```typescript
/**
 * Analysis result types — output of each agent in the LangGraph workflow.
 */

// --- Shared primitives ---

export type Bias = "bullish" | "bearish" | "neutral";
export type ExitSuggestion = "hold" | "tighten" | "close_partial" | "close_all";
export type RiskLevel = "low" | "medium" | "high" | "extreme";
export type Phase = "防御" | "相持" | "反攻"; // strategic defense / stalemate / counterattack
export type MaoAction = "开多" | "开空" | "观望" | "持多收紧" | "持空收紧" | "平多" | "平空";

// --- Technical Analysis (output of technical-analyst agent) ---

export interface TechnicalAnalysis {
  bias: Bias;
  confidence: number; // 0-100
  phase: Phase;
  primary_contradiction: string; // one-sentence description of the main contradiction
  m15_analysis: string;
  m30_analysis: string;
  h1_analysis: string;
  h4_analysis: string;
  exit_suggestion: ExitSuggestion;
  reasoning: string; // 2-3 sentences of core reasoning
}

// --- Support/Resistance Levels ---

export interface SLevel {
  price: number;
  strength: number; // 1-10
  source: string; // e.g., "fib_618", "prev_high", "pivot_r1", "bb_upper", "psychological"
  timeframe: string; // e.g., "H1", "H4"
}

export interface SLTPRecommendation {
  buy_sl: number; // stop-loss for buy
  buy_tp1: number; // take-profit 1 for buy
  buy_tp2?: number; // take-profit 2 for buy
  sell_sl: number; // stop-loss for sell
  sell_tp1: number; // take-profit 1 for sell
  sell_tp2?: number; // take-profit 2 for sell
  buffer_atr: number; // ATR buffer multiplier for SL placement
}

export interface SRLevels {
  support_levels: SLevel[];
  resistance_levels: SLevel[];
  recommendation: SLTPRecommendation;
  rationale: string;
}

// --- Arbitration Result (output of Mao arbitrator) ---

export interface ArbitrationResult {
  final_direction: Bias;
  confidence: number; // 50-95
  primary_contradiction: string;
  phase: Phase;
  reasoning: string; // 2-3 sentences
  action: MaoAction;
  united_front_analysis: string; // description of multi-timeframe signal alignment
}

// --- Risk Assessment (output of risk manager) ---

export interface RiskAssessment {
  riskLevel: RiskLevel;
  maxPositionSize: number; // max lot size
  suggestedSL?: SLTPRecommendation;
  warnings: string[]; // list of risk warnings
  metrics: {
    drawdown: number; // current drawdown %
    riskPerTrade: number; // risk per trade as % of equity
    correlationRisk: boolean; // whether positions are correlated
    srValidationPassed: boolean; // whether SR levels are reasonable
  };
}

// --- SR input (for risk manager / SR analyst internal use) ---

export interface SRInput {
  currentPrice: number;
  atr: number;
  swing: { high: number; low: number };
  fib: { fib236: number; fib382: number; fib500: number; fib618: number; fib786: number };
  pivot: { r2: number; r1: number; pp: number; s1: number; s2: number };
  bb: { upper: number; lower: number };
  psychological: number[];
}

// --- Arbitration input ---

export interface ArbitrationInput {
  technical: TechnicalAnalysis;
  risk: RiskAssessment;
  payload: import("./goldbot.js").GoldbotPayload;
  pendingSignal?: import("./goldbot.js").PendingSignal;
}

// --- Risk input ---

export interface RiskInput {
  technical: TechnicalAnalysis;
  sr: SRLevels;
  payload: import("./goldbot.js").GoldbotPayload;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run:
```bash
cd /root/gold-analysis-agent
npx tsc --noEmit src/types/analysis.ts 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /root/gold-analysis-agent
git add src/types/analysis.ts
git commit -m "feat: add analysis result types"
```

---

### Task 5: Create src/types/agent.ts with AnalysisState, AISignalResult, AnalysisLog

**Files:**
- Create: `src/types/agent.ts`

- [ ] **Step 1: Write the types file**

Create `src/types/agent.ts`:

```typescript
/**
 * Agent and LangGraph state types.
 * AnalysisState is the LangGraph state that flows through the workflow.
 * AISignalResult is the final output posted to gold-bot.
 * AnalysisLog tracks per-node execution logs.
 */

import type {
  TechnicalAnalysis,
  SRLevels,
  ArbitrationResult,
  RiskAssessment,
  Bias,
  ExitSuggestion,
} from "./analysis.js";
import type { GoldbotPayload, PendingSignal, SLevel, SLTPRecommendation } from "./goldbot.js";

// --- Analysis log entry ---

export interface AnalysisLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  node: string; // LangGraph node name: "fetch" | "technical" | "sr" | "risk" | "arbitration" | "compose" | "publish" | "skip" | "error"
  timestamp: number; // Date.now()
  data?: Record<string, unknown>;
}

// --- Final AI signal result (POST to gold-bot) ---

export interface AISignalResult {
  bias: Bias;
  confidence: number; // 0-100
  exit_suggestion: ExitSuggestion;
  risk_alert: boolean;
  alert_reason?: string;

  // Support/resistance levels
  sr_levels?: {
    support_levels: SLevel[];
    resistance_levels: SLevel[];
    recommendation: SLTPRecommendation;
  };

  // Arbitration details
  arbitration?: {
    phase: string;
    primary_contradiction: string;
    action: string;
  };
}

// --- LangGraph AnalysisState ---

export interface AnalysisState {
  // === Input ===
  accountId: string;
  symbol: string;
  timestamp: number;

  // === Raw data ===
  payload?: GoldbotPayload;
  pendingSignal?: PendingSignal;

  // === Agent outputs ===
  technicalAnalysis?: TechnicalAnalysis;
  srLevels?: SRLevels;
  arbitration?: ArbitrationResult;
  riskAssessment?: RiskAssessment;

  // === Final output ===
  finalSignal?: AISignalResult;

  // === Metadata ===
  logs: AnalysisLog[];
  errors: string[];
  duration: number; // total elapsed ms
}

/**
 * Create initial AnalysisState for a given account/symbol pair.
 */
export function createInitialState(accountId: string, symbol: string): AnalysisState {
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

- [ ] **Step 2: Verify TypeScript compilation**

Run:
```bash
cd /root/gold-analysis-agent
npx tsc --noEmit src/types/agent.ts 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /root/gold-analysis-agent
git add src/types/agent.ts
git commit -m "feat: add agent state types (AnalysisState, AISignalResult, AnalysisLog)"
```

---

### Task 6: Create src/utils/logger.ts with pino

**Files:**
- Create: `src/utils/logger.ts`
- Test: `tests/unit/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  let logOutput: string[];

  beforeEach(() => {
    logOutput = [];
    vi.resetModules();
  });

  it("should create a logger with json format by default", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_FORMAT", "json");
    // Provide required env vars for config import
    vi.stubEnv("GOLDBOT_API_URL", "http://localhost:8880");
    vi.stubEnv("GOLDBOT_API_TOKEN", "a".repeat(20));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("LLM_API_KEY", "sk-" + "a".repeat(10));
    vi.stubEnv("ACCOUNTS_CONFIG", '[{"id":"default","symbols":["XAUUSD"]}]');

    const { createLogger } = await import("../../src/utils/logger.js");
    const logger = createLogger("json", "info");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should create a logger with pretty format", async () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv("LOG_FORMAT", "pretty");
    vi.stubEnv("GOLDBOT_API_URL", "http://localhost:8880");
    vi.stubEnv("GOLDBOT_API_TOKEN", "a".repeat(20));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("LLM_API_KEY", "sk-" + "a".repeat(10));
    vi.stubEnv("ACCOUNTS_CONFIG", '[{"id":"default","symbols":["XAUUSD"]}]');

    const { createLogger } = await import("../../src/utils/logger.js");
    const logger = createLogger("pretty", "debug");

    expect(logger).toBeDefined();
    expect(logger.level).toBe("debug");
  });

  it("should export a default logger singleton", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    vi.stubEnv("LOG_FORMAT", "json");
    vi.stubEnv("GOLDBOT_API_URL", "http://localhost:8880");
    vi.stubEnv("GOLDBOT_API_TOKEN", "a".repeat(20));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("LLM_API_KEY", "sk-" + "a".repeat(10));
    vi.stubEnv("ACCOUNTS_CONFIG", '[{"id":"default","symbols":["XAUUSD"]}]');

    const mod = await import("../../src/utils/logger.js");
    expect(mod.logger).toBeDefined();
    expect(typeof mod.logger.info).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/logger.test.ts 2>&1 | tail -20
```

Expected: FAIL — module `../../src/utils/logger.js` not found.

- [ ] **Step 3: Write the implementation**

Create `src/utils/logger.ts`:

```typescript
import pino from "pino";

/**
 * Create a pino logger instance.
 *
 * @param format - "json" for production, "pretty" for development
 * @param level  - minimum log level
 */
export function createLogger(
  format: "json" | "pretty" = "json",
  level: string = "info",
): pino.Logger {
  const transport =
    format === "pretty"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined;

  return pino({
    level,
    transport,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    base: {
      service: "gold-analysis-agent",
      version: "2.1",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Default logger — reads LOG_LEVEL and LOG_FORMAT from environment.
 * Lazy-initialized on first access.
 */
let _logger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!_logger) {
    const level = process.env["LOG_LEVEL"] ?? "info";
    const format = (process.env["LOG_FORMAT"] ?? "json") as "json" | "pretty";
    _logger = createLogger(format, level);
  }
  return _logger;
}

/**
 * Convenience default export.
 * Uses a Proxy so the logger is lazily created on first property access.
 */
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop, receiver) {
    const real = getLogger();
    const value = Reflect.get(real, prop, receiver);
    if (typeof value === "function") {
      return value.bind(real);
    }
    return value;
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/logger.test.ts 2>&1 | tail -20
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/gold-analysis-agent
git add src/utils/logger.ts tests/unit/logger.test.ts
git commit -m "feat: add pino logger with json/pretty format support"
```

---

### Task 7: Create src/tools/goldbot-api.ts with retry/timeout

**Files:**
- Create: `src/tools/goldbot-api.ts`
- Test: `tests/unit/goldbot-api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/goldbot-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config
vi.mock("../../src/config/index.js", () => ({
  loadConfig: () => ({
    goldbotApiUrl: "http://localhost:8880",
    goldbotApiToken: "test-token-12345678",
    llmApiKey: "sk-test",
    llmBaseUrl: "https://test.com/v1",
    llmModel: "test-model",
    llmFallbackModel: "test-fallback",
    llmTimeout: 30000,
    llmMaxRetries: 3,
    logLevel: "info",
    logFormat: "json",
    accounts: [{ id: "default", symbols: ["XAUUSD"] }],
    redisUrl: "redis://localhost:6379",
    nodeEnv: "test",
    port: 3000,
    scheduleCron: "*/15 * * * *",
    dataDir: "./data",
  }),
}));

describe("GoldbotAPI", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("fetchAnalysisPayload should return parsed payload", async () => {
    const mockPayload = {
      market: { symbol: "XAUUSD", bid: 2350.5, ask: 2350.8, spread: 0.3, time: "2026-05-01T00:00:00Z" },
      account: { id: "default", balance: 10000, equity: 10050, margin: 500, freeMargin: 9550, marginLevel: 2010, currency: "USD" },
      positions: [],
      market_status: { tradeable: true },
      indicators: { H1: { timeframe: "H1", close: 2350.5, EMA20: 2348.0 } },
    };

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockPayload), { status: 200 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();
    const result = await api.fetchAnalysisPayload("default", "XAUUSD");

    expect(result.market.symbol).toBe("XAUUSD");
    expect(result.market_status.tradeable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Verify URL and headers
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:8880/api/v2/analysis_payload/default/XAUUSD");
    expect((options?.headers as Record<string, string>)["X-API-Token"]).toBe("test-token-12345678");
  });

  it("fetchPendingSignal should return null on 404", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();
    const result = await api.fetchPendingSignal("default", "XAUUSD");

    expect(result).toBeNull();
  });

  it("fetchPendingSignal should return first item when array returned", async () => {
    const mockSignal = {
      id: 1,
      account: "default",
      symbol: "XAUUSD",
      signal_type: "ma_cross",
      direction: "buy",
      confidence: 75,
      price: 2350.0,
      time: "2026-05-01T00:00:00Z",
      source: "ma_strategy",
      status: "pending",
    };

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([mockSignal]), { status: 200 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();
    const result = await api.fetchPendingSignal("default", "XAUUSD");

    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.signal_type).toBe("ma_cross");
  });

  it("fetchPendingSignal should return null when empty array returned", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();
    const result = await api.fetchPendingSignal("default", "XAUUSD");

    expect(result).toBeNull();
  });

  it("postAIResult should POST signal data", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();

    const signal = {
      bias: "bullish" as const,
      confidence: 80,
      exit_suggestion: "hold" as const,
      risk_alert: false,
    };

    await api.postAIResult("default", "XAUUSD", signal);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:8880/api/v2/ai_result/default/XAUUSD");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual(signal);
  });

  it("should throw on non-ok response for fetchAnalysisPayload", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();

    await expect(api.fetchAnalysisPayload("default", "XAUUSD")).rejects.toThrow("fetchPayload failed: 500");
  });

  it("should retry on failure with p-retry", async () => {
    // First two calls fail, third succeeds
    fetchSpy
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            market: { symbol: "XAUUSD", bid: 2350, ask: 2350.3, spread: 0.3, time: "" },
            account: { id: "d", balance: 0, equity: 0, margin: 0, freeMargin: 0, marginLevel: 0, currency: "USD" },
            positions: [],
            market_status: { tradeable: true },
            indicators: {},
          }),
          { status: 200 },
        ),
      );

    const { GoldbotAPI } = await import("../../src/tools/goldbot-api.js");
    const api = new GoldbotAPI();
    const result = await api.fetchAnalysisPayload("default", "XAUUSD");

    expect(result.market.symbol).toBe("XAUUSD");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/goldbot-api.test.ts 2>&1 | tail -20
```

Expected: FAIL — module `../../src/tools/goldbot-api.js` not found.

- [ ] **Step 3: Write the implementation**

Create `src/tools/goldbot-api.ts`:

```typescript
import pRetry from "p-retry";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { GoldbotPayload, PendingSignal } from "../types/goldbot.js";
import type { AISignalResult } from "../types/agent.js";

/**
 * HTTP client for the gold-bot Go backend.
 * All requests include:
 *   - X-API-Token header
 *   - 30s AbortController timeout
 *   - Exponential backoff retry (2 attempts by default)
 */
export class GoldbotAPI {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeout: number = 30_000;
  private readonly maxRetries: number;

  constructor() {
    const config = loadConfig();
    this.baseUrl = config.goldbotApiUrl;
    this.token = config.goldbotApiToken;
    this.maxRetries = 2;
  }

  /**
   * Create fetch options with auth header and timeout.
   * Returns options and a cleanup function to clear the timeout.
   */
  private createFetchOptions(init?: RequestInit): { options: RequestInit; cleanup: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const options: RequestInit = {
      ...init,
      signal: controller.signal,
      headers: {
        "X-API-Token": this.token,
        ...init?.headers,
      },
    };

    return {
      options,
      cleanup: () => clearTimeout(timer),
    };
  }

  /**
   * Fetch the analysis payload for a given account/symbol.
   * GET /api/v2/analysis_payload/{account}/{symbol}
   */
  async fetchAnalysisPayload(accountId: string, symbol: string): Promise<GoldbotPayload> {
    const url = `${this.baseUrl}/api/v2/analysis_payload/${accountId}/${encodeURIComponent(symbol)}`;

    return pRetry(
      async () => {
        const { options, cleanup } = this.createFetchOptions();
        try {
          const res = await fetch(url, options);
          if (!res.ok) {
            throw new Error(`fetchPayload failed: ${res.status}`);
          }
          return (await res.json()) as GoldbotPayload;
        } finally {
          cleanup();
        }
      },
      {
        retries: this.maxRetries,
        minTimeout: 1_000,
        maxTimeout: 10_000,
        factor: 2,
        onFailedAttempt: (error) => {
          logger.warn("[GoldbotAPI] fetchAnalysisPayload attempt failed", {
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: error.message,
            accountId,
            symbol,
          });
        },
      },
    );
  }

  /**
   * Fetch pending signal from Go engine.
   * GET /api/pending_signal/{account}/{symbol}
   * Returns null if 404 or empty array.
   */
  async fetchPendingSignal(accountId: string, symbol: string): Promise<PendingSignal | null> {
    const url = `${this.baseUrl}/api/pending_signal/${accountId}/${encodeURIComponent(symbol)}`;

    return pRetry(
      async () => {
        const { options, cleanup } = this.createFetchOptions();
        try {
          const res = await fetch(url, options);
          if (res.status === 404) return null;
          if (!res.ok) {
            throw new Error(`fetchPendingSignal failed: ${res.status}`);
          }
          const data = (await res.json()) as PendingSignal[] | PendingSignal;

          // Go backend may return an array or a single object
          if (Array.isArray(data)) {
            return data.length > 0 ? (data[0] ?? null) : null;
          }
          return data;
        } finally {
          cleanup();
        }
      },
      {
        retries: this.maxRetries,
        minTimeout: 1_000,
        maxTimeout: 10_000,
        factor: 2,
        onFailedAttempt: (error) => {
          logger.warn("[GoldbotAPI] fetchPendingSignal attempt failed", {
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: error.message,
            accountId,
            symbol,
          });
        },
      },
    );
  }

  /**
   * Post AI analysis result to gold-bot.
   * POST /api/v2/ai_result/{account}/{symbol}
   */
  async postAIResult(accountId: string, symbol: string, result: AISignalResult): Promise<void> {
    const url = `${this.baseUrl}/api/v2/ai_result/${accountId}/${encodeURIComponent(symbol)}`;

    return pRetry(
      async () => {
        const { options, cleanup } = this.createFetchOptions({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        try {
          const res = await fetch(url, options);
          if (!res.ok) {
            throw new Error(`postAIResult failed: ${res.status}`);
          }
        } finally {
          cleanup();
        }
      },
      {
        retries: this.maxRetries,
        minTimeout: 1_000,
        maxTimeout: 10_000,
        factor: 2,
        onFailedAttempt: (error) => {
          logger.warn("[GoldbotAPI] postAIResult attempt failed", {
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: error.message,
            accountId,
            symbol,
          });
        },
      },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/goldbot-api.test.ts 2>&1 | tail -30
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/gold-analysis-agent
git add src/tools/goldbot-api.ts tests/unit/goldbot-api.test.ts
git commit -m "feat: add goldbot-api client with 30s timeout and retry"
```

---

### Task 8: Create src/tools/llm-client.ts with LangChain ChatOpenAI wrapper

**Files:**
- Create: `src/tools/llm-client.ts`
- Test: `tests/unit/llm-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/llm-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../../src/config/index.js", () => ({
  loadConfig: () => ({
    goldbotApiUrl: "http://localhost:8880",
    goldbotApiToken: "test-token-12345678",
    llmProvider: "bailian",
    llmApiKey: "sk-test-key-12345",
    llmBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmModel: "qwen-plus",
    llmFallbackModel: "qwen-turbo",
    llmTimeout: 30000,
    llmMaxRetries: 3,
    logLevel: "info",
    logFormat: "json",
    accounts: [{ id: "default", symbols: ["XAUUSD"] }],
    redisUrl: "redis://localhost:6379",
    nodeEnv: "test",
    port: 3000,
    scheduleCron: "*/15 * * * *",
    dataDir: "./data",
  }),
}));

describe("LLMClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should create an LLMClient instance", async () => {
    const { LLMClient } = await import("../../src/tools/llm-client.js");
    const client = new LLMClient();
    expect(client).toBeDefined();
  });

  it("getModel should return a ChatOpenAI instance for the default model", async () => {
    const { LLMClient } = await import("../../src/tools/llm-client.js");
    const client = new LLMClient();
    const model = client.getModel();

    expect(model).toBeDefined();
    expect(model.lc_kwargs.model).toBe("qwen-plus");
    expect(model.lc_kwargs.configuration?.baseURL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("getModel should accept a custom model name", async () => {
    const { LLMClient } = await import("../../src/tools/llm-client.js");
    const client = new LLMClient();
    const model = client.getModel("qwen-turbo");

    expect(model.lc_kwargs.model).toBe("qwen-turbo");
  });

  it("getModel('fallback') should use the fallback model", async () => {
    const { LLMClient } = await import("../../src/tools/llm-client.js");
    const client = new LLMClient();
    const model = client.getModel("fallback");

    expect(model.lc_kwargs.model).toBe("qwen-turbo");
  });

  it("should expose timeout and maxRetries from config", async () => {
    const { LLMClient } = await import("../../src/tools/llm-client.js");
    const client = new LLMClient();

    expect(client.timeout).toBe(30000);
    expect(client.maxRetries).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/llm-client.test.ts 2>&1 | tail -20
```

Expected: FAIL — module `../../src/tools/llm-client.js` not found.

- [ ] **Step 3: Write the implementation**

Create `src/tools/llm-client.ts`:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { loadConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Unified LLM client wrapping LangChain's ChatOpenAI.
 * Configured for Bailian/DashScope (Qwen models) by default.
 * Supports model switching and fallback.
 *
 * Usage:
 *   const client = new LLMClient();
 *   const model = client.getModel();           // default model (qwen-plus)
 *   const model = client.getModel("qwen-turbo"); // specific model
 *   const model = client.getModel("fallback");   // fallback model
 */
export class LLMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fallbackModel: string;
  readonly timeout: number;
  readonly maxRetries: number;

  private modelCache: Map<string, ChatOpenAI> = new Map();

  constructor() {
    const config = loadConfig();
    this.apiKey = config.llmApiKey;
    this.baseUrl = config.llmBaseUrl;
    this.defaultModel = config.llmModel;
    this.fallbackModel = config.llmFallbackModel;
    this.timeout = config.llmTimeout;
    this.maxRetries = config.llmMaxRetries;
  }

  /**
   * Get a ChatOpenAI model instance.
   *
   * @param modelName - Model name, "fallback" for fallback model, or undefined for default
   * @returns Configured ChatOpenAI instance
   */
  getModel(modelName?: string): ChatOpenAI {
    const resolvedName =
      modelName === "fallback"
        ? this.fallbackModel
        : modelName ?? this.defaultModel;

    const cacheKey = resolvedName;
    const cached = this.modelCache.get(cacheKey);
    if (cached) return cached;

    logger.debug("[LLMClient] Creating model instance", {
      model: resolvedName,
      baseUrl: this.baseUrl,
    });

    const model = new ChatOpenAI({
      model: resolvedName,
      apiKey: this.apiKey,
      temperature: 0.1, // low temperature for deterministic analysis
      maxTokens: 4096,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      configuration: {
        baseURL: this.baseUrl,
      },
    });

    this.modelCache.set(cacheKey, model);
    return model;
  }

  /**
   * Get the default model name.
   */
  getDefaultModelName(): string {
    return this.defaultModel;
  }

  /**
   * Get the fallback model name.
   */
  getFallbackModelName(): string {
    return this.fallbackModel;
  }

  /**
   * Clear the model cache (useful for testing or config changes).
   */
  clearCache(): void {
    this.modelCache.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run tests/unit/llm-client.test.ts 2>&1 | tail -20
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /root/gold-analysis-agent
git add src/tools/llm-client.ts tests/unit/llm-client.test.ts
git commit -m "feat: add LangChain ChatOpenAI wrapper for Bailian/Qwen"
```

---

### Task 9: Create vitest.config.ts and run full test suite

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/types/**"],
    },
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
```

- [ ] **Step 2: Run the full test suite**

Run:
```bash
cd /root/gold-analysis-agent
npx vitest run 2>&1 | tail -30
```

Expected: All tests across all test files PASS.

- [ ] **Step 3: Verify full TypeScript compilation**

Run:
```bash
cd /root/gold-analysis-agent
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /root/gold-analysis-agent
git add vitest.config.ts
git commit -m "chore: add vitest config and verify full test suite"
```

---

## Self-Review

After writing this plan, here is the self-review against the SPEC:

### 1. Spec Coverage

| SPEC Section | Covered In | Status |
|---|---|---|
| §2 Project Structure — package.json | Task 1 | ✅ |
| §2 Project Structure — tsconfig.json | Task 1 | ✅ |
| §2 Project Structure — src/config/index.ts | Task 2 | ✅ |
| §2 Project Structure — src/types/goldbot.ts | Task 3 | ✅ |
| §2 Project Structure — src/types/analysis.ts | Task 4 | ✅ |
| §2 Project Structure — src/types/agent.ts | Task 5 | ✅ |
| §2 Project Structure — src/utils/logger.ts | Task 6 | ✅ |
| §2 Project Structure — src/tools/goldbot-api.ts | Task 7 | ✅ |
| §2 Project Structure — src/tools/llm-client.ts | Task 8 | ✅ |
| §3 GraphState (AnalysisState) | Task 5 (types/agent.ts) | ✅ |
| §6 API Client (GoldbotAPI) | Task 7 | ✅ |
| §6.2 AISignalResult | Task 5 (types/agent.ts) | ✅ |
| §7 .env.example | Task 1 | ✅ |
| §9 Key Decisions — zod, pino, p-retry | Tasks 2, 6, 7 | ✅ |
| §11.1 LLM retry (p-retry) | Task 8 (via LangChain maxRetries) | ✅ |
| §11.3 Timeout config (30s API, 30s LLM) | Tasks 7, 8 | ✅ |
| §12.2 Structured logging (pino) | Task 6 | ✅ |
| §14.2 Input validation (zod schemas) | Task 2 | ✅ |

### 2. Placeholder Scan

- ✅ No "TBD", "TODO", or "implement later" found
- ✅ All steps contain complete code blocks
- ✅ No "Similar to Task N" references — each task has full standalone code
- ✅ All functions/types referenced are defined within the plan

### 3. Type Consistency Check

- `GoldbotPayload` — defined in `goldbot.ts`, used consistently in `analysis.ts`, `agent.ts`, `goldbot-api.ts`
- `PendingSignal` — defined in `goldbot.ts`, used in `agent.ts`, `goldbot-api.ts`
- `TechnicalAnalysis` — defined in `analysis.ts`, used in `agent.ts`
- `SRLevels`, `SLevel`, `SLTPRecommendation` — defined in `analysis.ts`, referenced in `agent.ts` via `AISignalResult`
- `ArbitrationResult` — defined in `analysis.ts`, used in `agent.ts`
- `RiskAssessment` — defined in `analysis.ts`, used in `agent.ts`
- `AISignalResult` — defined in `agent.ts`, used in `goldbot-api.ts`
- `AnalysisState` — defined in `agent.ts`, matches SPEC §3.1 exactly
- `createInitialState` — defined in `agent.ts`, matches SPEC §3.1
- `AnalysisLog` — defined in `agent.ts`, `node` field uses string union matching SPEC §3.2 node names
- `Bias`, `ExitSuggestion`, `RiskLevel`, `Phase`, `MaoAction` — all defined in `analysis.ts`, match SPEC §6.2 and §4.4
- `loadConfig()` — returns `AppConfig` with camelCase keys, consistently used by logger, goldbot-api, llm-client
- Import paths all use `.js` extension for NodeNext module resolution ✅

### Gaps Found and Addressed

- The SPEC mentions `src/utils/formatter.ts` — not in Phase 1 scope (that's a utility for later phases)
- The SPEC mentions `prom-client` metrics — not in Phase 1 scope (monitoring is Phase 4+)
- The SPEC's config validation (§14.2) uses `ConfigSchema` — unified into Task 2's `EnvSchema` with the same field names
- The SPEC's `safeJsonParse` (§11.4) — not in Phase 1 scope (used by agents in Phase 2+)
