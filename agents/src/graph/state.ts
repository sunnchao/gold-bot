/**
 * LangGraph state definition using Annotation API.
 */

import { Annotation } from "@langchain/langgraph";
import type { GoldbotPayload, PendingSignal } from "../types/goldbot.js";
import type {
  TechnicalAnalysis,
  ArbitrationResult,
  RiskAssessment,
  WaveAnalystResult,
  ChanlunAnalystResult,
} from "../types/analysis.js";
import type { ComprehensiveAnalysisResult } from '../types/comprehensive.js';
import type { AISignalResult, AnalysisLog } from "../types/agent.js";
import type { TradeAction } from '../types/trade-action.js';

type SymbolMap<T> = Record<string, T>;

export const AnalysisGraphState = Annotation.Root({
  /** Account ID */
  accountId: Annotation<string>(),

  /** Symbol (e.g. XAUUSD) */
  symbol: Annotation<string>(),

  /** Symbols in the current workflow run */
  symbols: Annotation<string[]>(),

  /** ISO timestamp when analysis started */
  timestamp: Annotation<string>(),

  /** Full payload from Goldbot API */
  payload: Annotation<GoldbotPayload | undefined>(),

  /** Full payloads from Goldbot API keyed by symbol */
  payloads: Annotation<SymbolMap<GoldbotPayload> | undefined>(),

  /** Pending signal from Goldbot */
  pendingSignal: Annotation<PendingSignal | undefined>(),

  /** Pending signals from Goldbot keyed by symbol */
  pendingSignals: Annotation<SymbolMap<PendingSignal | undefined> | undefined>(),

  /** Comprehensive analyst output */
  comprehensiveAnalysis: Annotation<ComprehensiveAnalysisResult | undefined>(),

  /** Comprehensive analyst output keyed by symbol */
  comprehensiveAnalyses: Annotation<SymbolMap<ComprehensiveAnalysisResult> | undefined>(),

  /** Technical analyst output */
  technicalAnalysis: Annotation<TechnicalAnalysis | undefined>(),

  /** Technical analyst output keyed by symbol */
  technicalAnalyses: Annotation<SymbolMap<TechnicalAnalysis> | undefined>(),

  /** Wave analyst output */
  waveAnalysis: Annotation<WaveAnalystResult | undefined>(),

  /** Wave analyst output keyed by symbol */
  waveAnalyses: Annotation<SymbolMap<WaveAnalystResult> | undefined>(),

  /** Chanlun analyst output */
  chanlunAnalysis: Annotation<ChanlunAnalystResult | undefined>(),

  /** Chanlun analyst output keyed by symbol */
  chanlunAnalyses: Annotation<SymbolMap<ChanlunAnalystResult> | undefined>(),

  /** Risk manager output */
  riskAssessment: Annotation<RiskAssessment | undefined>(),

  /** Risk manager output keyed by symbol */
  riskAssessments: Annotation<SymbolMap<RiskAssessment> | undefined>(),

  /** MAO arbitrator output */
  arbitration: Annotation<ArbitrationResult | undefined>(),

  /** MAO arbitrator output keyed by symbol */
  arbitrations: Annotation<SymbolMap<ArbitrationResult> | undefined>(),

  /** Final composed signal */
  finalSignal: Annotation<AISignalResult | undefined>(),

  /** Final composed signals keyed by symbol */
  finalSignals: Annotation<SymbolMap<AISignalResult> | undefined>(),

  /** Accumulated logs (reducer: append) */
  logs: Annotation<AnalysisLog[]>({
    reducer: (existing: AnalysisLog[], update: AnalysisLog[]) => [
      ...existing,
      ...update,
    ],
    default: () => [],
  }),

  /** Accumulated errors (reducer: append) */
  errors: Annotation<string[]>({
    reducer: (existing: string[], update: string[]) => [
      ...existing,
      ...update,
    ],
    default: () => [],
  }),

  /** Skip reason — if set, workflow skips analysis */
  skipReason: Annotation<string | undefined>(),

  /** Trade action from comprehensive analyst (function calling) */
  tradeAction: Annotation<TradeAction | undefined>(),

  /** Per-symbol trade actions */
  tradeActions: Annotation<SymbolMap<TradeAction> | undefined>(),

  /** Total analysis duration in ms */
  duration: Annotation<number | undefined>(),

  /** Per-symbol durations in ms */
  durations: Annotation<SymbolMap<number> | undefined>(),

  /** If true, skip publishing Feishu card (used by position-poll to avoid duplicates) */
  skipFeishu: Annotation<boolean | undefined>(),

  /** If true, analyze even when market is closed (force mode from trigger API) */
  forceAnalyze: Annotation<boolean | undefined>(),
});

export type AnalysisGraphStateType = typeof AnalysisGraphState.State;
