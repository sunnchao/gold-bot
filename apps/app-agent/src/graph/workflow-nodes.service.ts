import { Injectable } from '@nestjs/common';
import type { AnalysisGraphStateType } from './state.js';
import type { AISignalResult, AnalysisLog } from '../types/agent.js';
import type { GoldbotPayload, PendingSignal } from '../types/goldbot.js';
import type { ComprehensiveAnalysisResult } from '../types/comprehensive.js';
import type { TradeAction } from '../types/trade-action.js';
import { ComprehensiveAnalystService } from '../agents/comprehensive-analyst.js';
import { BarSourceService, atrOf } from '../config/bar-source.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { PublisherService } from '../agents/publisher.js';
import { GoldbotApiService } from '../tools/goldbot-api.js';
import { PinoLoggerService } from '../utils/logger.service.js';
import { composeFinalSignal } from './compose.js';
import { MarketInsightCacheService } from './market-insight-cache.service.js';

function createLog(
  node: string,
  message: string,
  level: AnalysisLog['level'] = 'info',
): AnalysisLog {
  return { timestamp: new Date().toISOString(), node, message, level };
}

@Injectable()
export class WorkflowNodesService {
  constructor(
    private readonly goldbotApi: GoldbotApiService,
    private readonly comprehensiveAnalyst: ComprehensiveAnalystService,
    private readonly publisher: PublisherService,
    private readonly logger: PinoLoggerService,
    private readonly config?: AppConfigService,
    private readonly barSource?: BarSourceService,
    private readonly marketInsightCache?: MarketInsightCacheService,
  ) {}

  private getSymbols(state: AnalysisGraphStateType): string[] {
    if (state.symbols !== undefined) {
      return state.symbols;
    }
    return [state.symbol];
  }

  private getPrimarySymbol(state: AnalysisGraphStateType): string {
    return this.getSymbols(state)[0] ?? state.symbol;
  }

  private selectPrimary<T>(
    values: Record<string, T> | undefined,
    state: AnalysisGraphStateType,
  ): T | undefined {
    return values?.[this.getPrimarySymbol(state)];
  }

  async fetchData(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    const { accountId } = state;
    const symbols = this.getSymbols(state);
    this.logger.instance.info({ accountId, symbols }, 'fetchData: fetching payloads + pending signals');

    try {
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          const [payload, pendingSignal] = await Promise.all([
            this.goldbotApi.fetchAnalysisPayload(accountId, symbol),
            this.goldbotApi.fetchPendingSignal(accountId, symbol),
          ]);

          return [symbol, { payload, pendingSignal: pendingSignal ?? undefined }] as const;
        }),
      );

      const payloads = Object.fromEntries(
        entries.map(([symbol, value]) => [symbol, value.payload]),
      ) as Record<string, GoldbotPayload>;
      const pendingSignals = Object.fromEntries(
        entries.map(([symbol, value]) => [symbol, value.pendingSignal]),
      ) as Record<string, PendingSignal | undefined>;
      const primarySymbol = symbols[0];

      if (this.config?.marketFirstEnabled === true && this.barSource) {
        const viewEntries = await Promise.all(
          symbols.map(async (symbol) => {
            const accountPayload = payloads[symbol];
            const resolution = await this.barSource!.barSourceFor(accountId, symbol);
            let barPayload = accountPayload;
            let sourceAccount = resolution.sourceAccount;
            let sourceSymbol = resolution.sourceSymbol;
            let useShared = resolution.useShared;

            if (resolution.useShared) {
              try {
                barPayload = await this.goldbotApi.fetchAnalysisPayload(
                  resolution.sourceAccount,
                  resolution.sourceSymbol,
                );
              } catch (err) {
                this.logger.instance.warn(
                  {
                    accountId,
                    symbol,
                    sourceAccount: resolution.sourceAccount,
                    sourceSymbol: resolution.sourceSymbol,
                    err: err instanceof Error ? err.message : String(err),
                  },
                  'fetchData: shared BAR payload failed, falling back to account payload',
                );
                sourceAccount = accountId;
                sourceSymbol = symbol;
                useShared = false;
                barPayload = accountPayload;
              }
            }

            const accountSymbols = await this.barSource!.accountSymbols(accountId);
            return [symbol, {
              barView: {
                canonicalSymbol: resolution.canonicalSymbol,
                sourceAccount,
                sourceSymbol,
                useShared,
                payload: barPayload,
                benchmarkPrice: currentPrice(barPayload),
                atr: atrOf(barPayload),
              },
              accountView: {
                accountId,
                symbol,
                payload: accountPayload,
                pendingSignal: pendingSignals[symbol],
                aiSymbols: accountSymbols,
                realtimePrice: currentPrice(accountPayload),
                atr: atrOf(accountPayload),
              },
            }] as const;
          }),
        );

        return {
          payload: payloads[primarySymbol],
          payloads,
          barViews: Object.fromEntries(viewEntries.map(([symbol, value]) => [symbol, value.barView])),
          accountViews: Object.fromEntries(viewEntries.map(([symbol, value]) => [symbol, value.accountView])),
          pendingSignal: pendingSignals[primarySymbol],
          pendingSignals,
          logs: [
            createLog(
              'fetchData',
              `Fetched market/account views for ${symbols.join(', ')}`,
            ),
          ],
        };
      }

      return {
        payload: payloads[primarySymbol],
        payloads,
        pendingSignal: pendingSignals[primarySymbol],
        pendingSignals,
        logs: [
          createLog(
            'fetchData',
            `Fetched payloads for ${symbols.join(', ')}`,
          ),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.instance.error({ err, accountId, symbols }, 'fetchData failed');
      return {
        errors: [`fetchData: ${msg}`],
        logs: [createLog('fetchData', `Error: ${msg}`, 'error')],
      };
    }
  }

  async dispatchAnalysis(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    const symbols = this.getSymbols(state);

    // Force mode: analyze all symbols regardless of market status
    if (state.forceAnalyze) {
      this.logger.instance.info(
        { symbols },
        'dispatchAnalysis: force mode — analyzing all symbols despite market closed',
      );
      return {
        symbols,
        logs: [
          createLog(
            'dispatchAnalysis',
            `Force mode: dispatched analysis for ${symbols.join(', ')} (market closed override)`,
          ),
        ],
      };
    }

    const openSymbols = symbols.filter(
      (s) => state.payloads?.[s]?.market_status?.market_open !== false,
    );
    const closedSymbols = symbols.filter(
      (s) => state.payloads?.[s]?.market_status?.market_open === false,
    );

    if (closedSymbols.length > 0) {
      this.logger.instance.info(
        { closedSymbols, openSymbols },
        'dispatchAnalysis: skipping closed-market symbols',
      );
    }

    if (openSymbols.length === 0) {
      return {
        skipReason: 'All markets closed',
        logs: [
          createLog(
            'dispatchAnalysis',
            `All markets closed — skipping analysis for ${symbols.join(', ')}`,
            'warn',
          ),
        ],
      };
    }

    return {
      symbols: openSymbols,
      logs: [
        createLog(
          'dispatchAnalysis',
          `Dispatched analysis for ${openSymbols.join(', ')}`,
        ),
      ],
    };
  }

  async comprehensiveAnalysis(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    if (!state.payloads || Object.keys(state.payloads).length === 0) {
      return {
        errors: ['comprehensiveAnalysis: No payload available'],
        logs: [createLog('comprehensiveAnalysis', 'No payload - skipping', 'warn')],
      };
    }

    try {
      // Build allCurrentPrices map from all payloads for cross-instrument collision detection
      const allCurrentPrices: Record<string, number> = {};
      for (const [sym, pl] of Object.entries(state.payloads)) {
        const bid = pl.market?.bid || pl.market?.ask || 0;
        if (bid > 0) allCurrentPrices[sym] = bid;
      }

      if (this.config?.marketFirstEnabled === true && this.marketInsightCache) {
        const entries = await Promise.all(
          this.getSymbols(state)
            .filter((symbol) => state.payloads?.[symbol] && state.barViews?.[symbol] && state.accountViews?.[symbol])
            .map(async (symbol) => {
              const barView = state.barViews![symbol];
              const accountView = state.accountViews![symbol];
              const cached = barView.useShared
                ? await this.marketInsightCache!.getOrBuild(
                  barView.canonicalSymbol,
                  async () => ({
                    insight: await this.comprehensiveAnalyst.runMarketInsight(
                      barView,
                      barView.sourceSymbol,
                      allCurrentPrices,
                    ),
                    benchmarkPrice: barView.benchmarkPrice,
                    computedAt: Date.now(),
                    sourceAccount: barView.sourceAccount,
                  }),
                )
                : {
                  insight: await this.comprehensiveAnalyst.runMarketInsight(
                    barView,
                    barView.sourceSymbol,
                    allCurrentPrices,
                  ),
                  benchmarkPrice: barView.benchmarkPrice,
                  computedAt: Date.now(),
                  sourceAccount: barView.sourceAccount,
                };
              const actions = await this.comprehensiveAnalyst.decideAccountActions(
                cached.insight,
                [accountView],
                cached.benchmarkPrice,
                barView.atr,
                this.config!.priceDeviationToleranceAtr,
              );
              const result = {
                ...cached.insight,
                tradeAction: actions[symbol],
              } satisfies ComprehensiveAnalysisResult;
              return [symbol, {
                result,
                insight: cached.insight,
                action: actions[symbol],
              }] as const;
            }),
        );

        const results = Object.fromEntries(
          entries.map(([symbol, value]) => [symbol, value.result]),
        ) as Record<string, ComprehensiveAnalysisResult>;

        return {
          comprehensiveAnalysis: this.selectPrimary(results, state),
          comprehensiveAnalyses: results,
          marketInsights: Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.insight])),
          accountActions: Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.action])),
          technicalAnalysis: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.result.technical])),
            state,
          ),
          technicalAnalyses: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.result.technical]),
          ),
          waveAnalysis: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.result.wave])),
            state,
          ),
          waveAnalyses: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.result.wave]),
          ),
          chanlunAnalysis: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.result.chanlun])),
            state,
          ),
          chanlunAnalyses: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.result.chanlun]),
          ),
          riskAssessment: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.result.risk])),
            state,
          ),
          riskAssessments: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.result.risk]),
          ),
          arbitration: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.result.arbitration])),
            state,
          ),
          arbitrations: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.result.arbitration]),
          ),
          tradeAction: this.selectPrimary(
            Object.fromEntries(entries.map(([symbol, value]) => [symbol, value.action])),
            state,
          ),
          tradeActions: Object.fromEntries(
            entries.map(([symbol, value]) => [symbol, value.action]).filter(([, action]) => action !== undefined),
          ) as Record<string, TradeAction>,
          logs: [
            createLog(
              'comprehensiveAnalysis',
              `Completed market-first analysis for ${Object.keys(results).join(', ')}`,
            ),
          ],
        };
      }

      const entries = await Promise.all(
        this.getSymbols(state)
          .filter((symbol) => state.payloads?.[symbol])
          .map(async (symbol) => {
            const payload = state.payloads![symbol];
            const result = await this.comprehensiveAnalyst.run(
              payload,
              symbol,
              state.pendingSignals?.[symbol],
              allCurrentPrices,
            );
            return [symbol, result] as const;
          }),
      );

      const results = Object.fromEntries(entries) as Record<string, ComprehensiveAnalysisResult>;

      return {
        comprehensiveAnalysis: this.selectPrimary(results, state),
        comprehensiveAnalyses: results,
        technicalAnalysis: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.technical])),
          state,
        ),
        technicalAnalyses: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.technical]),
        ),
        waveAnalysis: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.wave])),
          state,
        ),
        waveAnalyses: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.wave]),
        ),
        chanlunAnalysis: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.chanlun])),
          state,
        ),
        chanlunAnalyses: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.chanlun]),
        ),
        riskAssessment: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.risk])),
          state,
        ),
        riskAssessments: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.risk]),
        ),
        arbitration: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.arbitration])),
          state,
        ),
        arbitrations: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.arbitration]),
        ),
        tradeAction: this.selectPrimary(
          Object.fromEntries(entries.map(([symbol, result]) => [symbol, result.tradeAction])),
          state,
        ),
        tradeActions: Object.fromEntries(
          entries.map(([symbol, result]) => [symbol, result.tradeAction]).filter(([, ta]) => ta !== undefined),
        ) as Record<string, TradeAction>,
        logs: [
          createLog(
            'comprehensiveAnalysis',
            `Completed comprehensive analysis for ${Object.keys(results).join(', ')}`,
          ),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.instance.error({ err }, 'comprehensiveAnalysis failed');
      return {
        errors: [`comprehensiveAnalysis: ${msg}`],
        logs: [createLog('comprehensiveAnalysis', `Error: ${msg}`, 'error')],
      };
    }
  }

  async composeSignal(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    try {
      const entries: [string, AISignalResult][] = [];
      this.getSymbols(state)
        .filter((symbol) => state.payloads?.[symbol])
        .forEach((symbol) => {
          const signal = composeFinalSignal({
            ...state,
            symbol,
            payload: state.payloads?.[symbol],
            pendingSignal: state.pendingSignals?.[symbol],
            comprehensiveAnalysis: state.comprehensiveAnalyses?.[symbol],
            technicalAnalysis: state.technicalAnalyses?.[symbol],
            waveAnalysis: state.waveAnalyses?.[symbol],
            chanlunAnalysis: state.chanlunAnalyses?.[symbol],
            riskAssessment: state.riskAssessments?.[symbol],
            arbitration: state.arbitrations?.[symbol],
            tradeAction: state.tradeActions?.[symbol],
          } as AnalysisGraphStateType);
          if (signal) {
            entries.push([symbol, signal]);
          }
        });
      const finalSignals = Object.fromEntries(entries) as Record<string, AISignalResult>;
      const primarySymbol = this.getPrimarySymbol(state);
      return {
        finalSignal: finalSignals[primarySymbol],
        finalSignals,
        logs: [
          createLog(
            'composeSignal',
            `Composed signals for ${Object.keys(finalSignals).join(', ')}${entries.length === 0 ? ' — all dropped (no arbitration)' : ''}`,
          ),
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.instance.error({ err }, 'composeSignal failed');
      return {
        errors: [`composeSignal: ${msg}`],
        logs: [createLog('composeSignal', `Error: ${msg}`, 'error')],
      };
    }
  }

  async publishResult(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    const { accountId } = state;
    const symbols = this.getSymbols(state);
    const finalSignals = state.finalSignals ?? {};

    if (Object.keys(finalSignals).length === 0 && !state.finalSignal) {
      return {
        logs: [createLog('publishResult', 'No final signal to publish', 'warn')],
      };
    }

    try {
      const durations = Object.fromEntries(
        symbols.map((symbol) => [
          symbol,
          state.duration && symbols.length === 1 ? state.duration : 0,
        ]),
      ) as Record<string, number>;

      await Promise.all(
        symbols.map(async (symbol) => {
          const finalSignal =
            finalSignals[symbol] ?? (symbols.length === 1 ? state.finalSignal : undefined);
          if (!finalSignal) {
            return;
          }

          const startedAt = Date.now();
          await this.publisher.publish(accountId, symbol, finalSignal, state.skipFeishu);
          durations[symbol] = Date.now() - startedAt;
        }),
      );
      return {
        durations,
        logs: [createLog('publishResult', `Published results for ${symbols.join(', ')}`)],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.instance.error({ err }, 'publishResult failed');
      return {
        errors: [`publishResult: ${msg}`],
        logs: [createLog('publishResult', `Error: ${msg}`, 'error')],
      };
    }
  }

  async skipNode(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    const reason = state.skipReason ?? 'unknown';
    this.logger.instance.info({ reason, symbols: this.getSymbols(state) }, 'Workflow skipped');
    return {
      logs: [createLog('skipNode', `Skipped: ${reason}`)],
    };
  }

  async errorNode(
    state: AnalysisGraphStateType,
  ): Promise<Partial<AnalysisGraphStateType>> {
    const errors = state.errors;
    this.logger.instance.error({ errors }, 'Workflow ended in error state');
    return {
      logs: [
        createLog(
          'errorNode',
          `Error state: ${errors.join('; ') || 'unknown error'}`,
          'error',
        ),
      ],
    };
  }
}

function currentPrice(payload: GoldbotPayload): number {
  const bid = payload.market?.bid;
  const ask = payload.market?.ask;
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return (bid + ask) / 2;
  }
  return Number.isFinite(bid) ? bid : Number.isFinite(ask) ? ask : 0;
}
