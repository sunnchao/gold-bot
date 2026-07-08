/**
 * Publisher Agent — publishes analysis results to Goldbot API and Feishu webhook.
 */

import { Injectable } from '@nestjs/common';
import type { AISignalResult } from '../types/agent.js';
import { GoldbotApiService } from '../tools/goldbot-api.js';
import { getLogger } from '../utils/logger.js';

const FEISHU_RATE_LIMIT_BACKOFF_MS = [2_000, 5_000, 10_000] as const;

type FeishuWebhookResponse = {
  code?: number;
  msg?: string;
  message?: string;
};

// ─── Beijing time formatter ─────────────────────────────────────────────────────

function formatBeijingTime(date: Date): string {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ─── Translation helpers ───────────────────────────────────────────────────────

function trBias(v?: string): string {
  const map: Record<string, string> = { bullish: '看涨', bearish: '看跌', neutral: '中性' };
  return map[v?.toLowerCase() ?? ''] ?? v ?? '未知';
}

function trAction(v?: string): string {
  const map: Record<string, string> = {
    open: '开仓', close: '平仓', modify: '调整', hold: '持有',
    buy: '买入', sell: '卖出',
  };
  return map[v?.toLowerCase() ?? ''] ?? v ?? 'N/A';
}

function trDirection(v?: string): string {
  const map: Record<string, string> = {
    long: '做多', short: '做空', buy: '买入', sell: '卖出', hold: '观望',
  };
  return map[v?.toLowerCase() ?? ''] ?? v ?? 'N/A';
}

function trExit(v?: string): string {
  const map: Record<string, string> = {
    hold: '持有', close: '平仓', partial_close: '部分平仓', trail_stop: '移动止损', none: '无',
  };
  return map[v?.toLowerCase() ?? ''] ?? v ?? 'N/A';
}

function trRisk(v?: string): string {
  const map: Record<string, string> = { low: '🟢 低', medium: '🟡 中', high: '🟠 高', extreme: '🔴 极高' };
  return map[v?.toLowerCase() ?? ''] ?? v ?? 'N/A';
}

function isFeishuFrequencyLimited(data: FeishuWebhookResponse): boolean {
  const message = `${data.msg ?? ''} ${data.message ?? ''}`.toLowerCase();
  return data.code === 11232 || message.includes('frequency limited');
}

function feishuMessage(data: FeishuWebhookResponse): string | undefined {
  return data.msg ?? data.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Feishu Card Builder ──────────────────────────────────────────────────────

function buildFeishuCard(
  accountId: string,
  symbol: string,
  result: AISignalResult,
): Record<string, unknown> {
  // 标题基于 action 判断（buy/sell = 开仓信号），而非 bias
  const action = result.arbitration?.action?.toLowerCase() ?? '';
  const isOpenSignal = action === 'buy' || action === 'sell' || action === 'open';
  const headerTitle = isOpenSignal ? '📈 开单信号' : '📉 持仓调整';
  // 颜色：buy=green, sell=red, 其他基于 bias
  const headerColor = action === 'buy' ? 'green' : action === 'sell' ? 'red' : result.bias === 'bullish' ? 'green' : result.bias === 'bearish' ? 'red' : 'blue';

  const supportPrices = result.sr_levels?.support?.filter((p) => p != null).map((p) => p.toFixed(2)).join(', ') || 'N/A';
  const resistancePrices = result.sr_levels?.resistance?.filter((p) => p != null).map((p) => p.toFixed(2)).join(', ') || 'N/A';

  // ── Build analysis sections ──
  const analysisSections: Record<string, unknown>[] = [];

  // 1. 核心信号 (Core Signal)
  analysisSections.push({
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**账户:**\n${accountId}` },
      },
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**品种:**\n${symbol}` },
      },
    ],
  });

  analysisSections.push({
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**信号:**\n${trBias(result.bias)}` },
      },
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**置信度:**\n${result.confidence}%` },
      },
    ],
  });

  analysisSections.push({
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**操作建议:**\n${trAction(result.arbitration?.action) ?? trExit(result.exit_suggestion)}` },
      },
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**方向:**\n${trDirection(result.arbitration?.direction) ?? trBias(result.bias)}` },
      },
    ],
  });

  // 2. 风险与价位 (Risk & Key Levels)
  const riskLine = result.risk_level ? `**风险等级:**\n${trRisk(result.risk_level)}` : '';
  const phaseLine = result.arbitration?.phase ? `**市场阶段:**\n${result.arbitration.phase}` : '';
  if (riskLine || phaseLine) {
    analysisSections.push({
      tag: 'div',
      fields: [
        ...(riskLine ? [{ is_short: true, text: { tag: 'lark_md', content: riskLine } }] : []),
        ...(phaseLine ? [{ is_short: true, text: { tag: 'lark_md', content: phaseLine } }] : []),
      ],
    });
  }

  // 3. SL / TP 价格
  const slTpFields: Record<string, unknown>[] = [];
  if (result.suggested_sl) {
    slTpFields.push({
      is_short: true,
      text: { tag: 'lark_md', content: `**建议止损:**\n${result.suggested_sl.toFixed(2)}` },
    });
  }
  if (result.suggested_tp) {
    slTpFields.push({
      is_short: true,
      text: { tag: 'lark_md', content: `**建议止盈:**\n${result.suggested_tp.toFixed(2)}` },
    });
  }
  if (slTpFields.length > 0) {
    analysisSections.push({ tag: 'div', fields: slTpFields });
  }

  // 4. 技术指标摘要
  if (result.indicators_summary && result.indicators_summary.length > 5) {
    analysisSections.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `**📊 技术指标摘要:**\n${result.indicators_summary}` },
    });
  }

  // 5. 详细分析摘要 (Reasoning)
  analysisSections.push({
    tag: 'div',
    text: {
      tag: 'lark_md',
      content: `**🔍 分析摘要:**\n${result.arbitration?.reasoning ?? '暂无分析摘要'}`,
    },
  });

  // 6. 矛盾点（如有）
  if (result.arbitration?.contradiction) {
    analysisSections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**⚡ 主要矛盾:**\n${result.arbitration.contradiction}`,
      },
    });
  }

  // 7. 支撑阻力位
  analysisSections.push({
    tag: 'div',
    fields: [
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**支撑位:**\n${supportPrices}` },
      },
      {
        is_short: true,
        text: { tag: 'lark_md', content: `**阻力位:**\n${resistancePrices}` },
      },
    ],
  });

  // 8. 风险警报
  if (result.risk_alert) {
    analysisSections.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `⚠️ 风险警报: ${result.alert_reason ?? '检测到高风险'}`,
        },
      ],
    });
  }

  // 9. 道氏理论 (Dow Theory)
  if (result.dow_theory) {
    const dt = result.dow_theory;
    const trendMap: Record<string, string> = { bullish: '🟢 看涨', bearish: '🔴 看跌', neutral: '⚪ 中性' };
    const phaseMap: Record<string, string> = { accumulation: '吸筹', markup: '拉升', distribution: '派发', markdown: '下跌' };
    analysisSections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**📘 道氏理论分析:**',
          `主趋势: ${trendMap[dt.primary_trend] ?? dt.primary_trend} | 阶段: ${phaseMap[dt.primary_phase] ?? dt.primary_phase}`,
          `次级趋势: ${trendMap[dt.secondary_trend] ?? dt.secondary_trend} | 短期: ${trendMap[dt.short_term_trend] ?? dt.short_term_trend}`,
          `多周期确认: ${dt.multi_tf_confirm ? '✅ 是' : '❌ 否'}`,
          `${dt.rationale}`,
        ].join('\n'),
      },
    });
  }

  // 10. 波浪理论 (Wave Theory)
  if (result.wave_theory) {
    const wt = result.wave_theory;
    analysisSections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**🌊 波浪理论分析:**',
          `当前波浪: ${wt.current_wave} | 方向: ${wt.wave_direction}`,
          `波浪计数: ${wt.wave_count}`,
          `下一目标: ${wt.next_target}`,
          `置信度: ${wt.confidence}%`,
          `${wt.rationale}`,
        ].join('\n'),
      },
    });
  }

  // 11. 缠论分析 (Chanlun Theory)
  if (result.chanlun_theory) {
    const ct = result.chanlun_theory;
    const trendMap: Record<string, string> = { up: '🟢 上涨', down: '🔴 下跌', range: '⚪ 盘整' };
    const biMap: Record<string, string> = { up: '↑ 上笔', down: '↓ 下笔', none: '— 无' };
    const zhongshuMap: Record<string, string> = { forming: '构建中', active: '活跃', breaking_up: '向上突破', breaking_down: '向下突破', none: '无' };
    const bspMap: Record<string, string> = { buy_1: '一买', buy_2: '二买', buy_3: '三买', sell_1: '一卖', sell_2: '二卖', sell_3: '三卖', none: '无' };
    analysisSections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**📐 缠论分析:**',
          `走势: ${trendMap[ct.trend] ?? ct.trend} | 笔: ${biMap[ct.bi_direction] ?? ct.bi_direction} | 段: ${biMap[ct.duan_direction] ?? ct.duan_direction}`,
          `中枢: ${zhongshuMap[ct.zhongshu_state] ?? ct.zhongshu_state} | 买卖点: ${bspMap[ct.buy_sell_point] ?? ct.buy_sell_point}`,
          `置信度: ${ct.confidence}%`,
          `${ct.rationale}`,
        ].join('\n'),
      },
    });
  }

  // 12. 谐波理论分析 (Harmonic Theory)
  if (result.harmonic_theory) {
    const ht = result.harmonic_theory;
    const patternMap: Record<string, string> = { gartley: 'Gartley 加特利', bat: 'Bat 蝙蝠', butterfly: 'Butterfly 蝴蝶', crab: 'Crab 螃蟹', abcd: 'AB=CD', cypher: 'Cypher 密码', shark: 'Shark 鲨鱼', none: '无形态' };
    const dirMap: Record<string, string> = { bullish: '🟢 看多', bearish: '🔴 看空', neutral: '⚪ 中性' };
    analysisSections.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: [
          '**🔁 谐波理论分析:**',
          `形态: ${patternMap[ht.pattern] ?? ht.pattern} | 方向: ${dirMap[ht.direction] ?? ht.direction}`,
          `置信度: ${ht.confidence}%`,
          `${ht.rationale}`,
        ].join('\n'),
      },
    });
  }

  // 13. 交易建议 (Trade Recommendation)
  if (result.trade_recommendation) {
    const tr = result.trade_recommendation;
    if (tr.direction !== 'hold') {
      const dirEmoji = tr.direction === 'buy' ? '🟢 做多' : '🔴 做空';
      const lines = [
        '**🎯 交易操作建议:**',
        `方向: ${dirEmoji}`,
        `入场: ${tr.entry_price.toFixed(2)}`,
        `止损: ${tr.stop_loss.toFixed(2)}`,
        `止盈1: ${tr.take_profit_1.toFixed(2)}`,
      ];
      if (tr.take_profit_2) {
        lines.push(`止盈2: ${tr.take_profit_2.toFixed(2)}`);
      }
      lines.push(`盈亏比: 1:${tr.risk_reward_ratio.toFixed(1)}`);
      lines.push(`仓位: ${tr.position_size_lots}`);
      lines.push(`${tr.rationale}`);
      analysisSections.push({
        tag: 'div',
        text: { tag: 'lark_md', content: lines.join('\n') },
      });
    } else {
      // hold with reference SL/TP levels (pending/alert)
      const lines = [
        '**🎯 交易建议:** ⏸️ 观望',
        `参考入场: ${tr.entry_price.toFixed(2)}`,
        `参考止损: ${tr.stop_loss.toFixed(2)}`,
        `参考止盈1: ${tr.take_profit_1.toFixed(2)}`,
      ];
      if (tr.take_profit_2) {
        lines.push(`参考止盈2: ${tr.take_profit_2.toFixed(2)}`);
      }
      lines.push(`盈亏比: 1:${tr.risk_reward_ratio.toFixed(1)}`);
      lines.push(`参考仓位: ${tr.position_size_lots}`);
      if (tr.rationale) lines.push(tr.rationale);
      analysisSections.push({
        tag: 'div',
        text: { tag: 'lark_md', content: lines.join('\n') },
      });
    }
  }

  // ── Assemble card ──
  analysisSections.push({ tag: 'hr' });
  analysisSections.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `生成时间 ${formatBeijingTime(new Date())}` }],
  });

  return {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: `${headerTitle} — ${symbol}` },
        template: headerColor,
      },
      elements: analysisSections,
    },
  };
}

@Injectable()
export class PublisherService {
  private static feishuQueue: Promise<void> = Promise.resolve();

  constructor(private readonly goldbotApi: GoldbotApiService) {}

  async postToGoldbot(
    accountId: string,
    symbol: string,
    result: AISignalResult,
  ): Promise<void> {
    const logger = getLogger();
    logger.info({ accountId, symbol }, 'Publisher: posting to Goldbot API');
    await this.goldbotApi.postAIResult(accountId, symbol, result);
    logger.info({ accountId, symbol }, 'Publisher: Goldbot API post successful');
  }

  async sendFeishuCard(
    accountId: string,
    symbol: string,
    result: AISignalResult,
  ): Promise<void> {
    const send = PublisherService.feishuQueue.then(() =>
      this.sendFeishuCardNow(accountId, symbol, result),
    );
    PublisherService.feishuQueue = send.catch(() => undefined);
    return send;
  }

  private async sendFeishuCardNow(
    accountId: string,
    symbol: string,
    result: AISignalResult,
  ): Promise<void> {
    const logger = getLogger();
    const webhookUrl = process.env.FEISHU_WEBHOOK_URL;

    if (!webhookUrl) {
      logger.warn('Publisher: FEISHU_WEBHOOK_URL not set, skipping Feishu notification');
      return;
    }

    const card = buildFeishuCard(accountId, symbol, result);

    const secret = process.env.FEISHU_WEBHOOK_SECRET;
    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const crypto = await import('node:crypto');
      const stringToSign = `${timestamp}\n${secret}`;
      const sign = crypto
        .createHmac('sha256', stringToSign)
        .update('')
        .digest('base64');
      (card as Record<string, unknown>).timestamp = timestamp;
      (card as Record<string, unknown>).sign = sign;
    }

    logger.info({ accountId, symbol, webhookUrl }, 'Publisher: sending Feishu card');

    for (let attempt = 0; attempt <= FEISHU_RATE_LIMIT_BACKOFF_MS.length; attempt += 1) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text().catch(() => '');
      let data: FeishuWebhookResponse | undefined;

      if (body) {
        try {
          data = JSON.parse(body) as FeishuWebhookResponse;
        } catch {
          data = undefined;
        }
      }

      if (
        data &&
        isFeishuFrequencyLimited(data) &&
        attempt < FEISHU_RATE_LIMIT_BACKOFF_MS.length
      ) {
        const backoffMs = FEISHU_RATE_LIMIT_BACKOFF_MS[attempt];
        logger.warn(
          {
            accountId,
            symbol,
            attempt: attempt + 1,
            backoffMs,
            code: data.code,
            msg: feishuMessage(data),
          },
          'Publisher: Feishu frequency limited, retrying',
        );
        await sleep(backoffMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Feishu webhook failed: ${response.status} ${body || 'no body'}`);
      }

      if (!data) {
        throw new Error(`Feishu webhook returned invalid JSON: ${body || 'empty body'}`);
      }

      if (data.code !== 0) {
        throw new Error(`Feishu webhook error: code=${data.code}, msg=${feishuMessage(data)}`);
      }

      logger.info({ accountId, symbol }, 'Publisher: Feishu card sent successfully');
      return;
    }

    throw new Error('Feishu webhook error: exhausted rate-limit retries');
  }

  async publish(
    accountId: string,
    symbol: string,
    result: AISignalResult,
    skipFeishu?: boolean,
  ): Promise<void> {
    const logger = getLogger();
    logger.info({ accountId, symbol, bias: result.bias }, 'Publisher: publishing result');

    const operations: Promise<void>[] = [this.postToGoldbot(accountId, symbol, result)];

    if (!skipFeishu) {
      logger.info({ accountId, symbol }, 'Publisher: sending Feishu card');
      operations.push(this.sendFeishuCard(accountId, symbol, result));
    }

    const outcomes = await Promise.allSettled(operations);

    const [goldbotOutcome, feishuOutcome] = outcomes;

    if (goldbotOutcome.status === 'rejected') {
      logger.error(
        { err: goldbotOutcome.reason, accountId, symbol },
        'Publisher: Goldbot API post failed',
      );
    }

    if (feishuOutcome?.status === 'rejected') {
      logger.error(
        { err: feishuOutcome.reason, accountId, symbol },
        'Publisher: Feishu card send failed',
      );
    }

    if (outcomes.every((o) => o.status === 'rejected')) {
      const feishuReason =
        feishuOutcome?.status === 'rejected'
          ? (feishuOutcome as PromiseRejectedResult).reason
          : 'skipped';
      throw new Error(
        `Publisher: all publish targets failed — goldbot: ${(goldbotOutcome as PromiseRejectedResult).reason}, feishu: ${feishuReason}`,
      );
    }
  }
}
