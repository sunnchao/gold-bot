# AI SL/TP Integration Spec

## Overview

将 SL/TP 决策权转移给 gold-analysis-agent AI 分析：
1. 开仓后立即触发 AI 分析获取 suggestedSL/suggestedTP
2. 每15分钟 AI 轮询所有持仓检查是否需要平仓/调整

## Architecture

```
开仓流程:
gold-bot SIGNAL → EA开仓 → ORDER_RESULT(success)
    ↓
gold-bot POST /trigger_analysis → gold-analysis-agent
    ↓
gold-analysis-agent 拉取 analysis_payload → AI分析 → POST /ai_result
    ↓
gold-bot 收到 suggestedSL/suggestedTP → MODIFY命令 → EA执行

轮询流程(每15分钟):
gold-analysis-agent cron → 遍历所有持仓 → AI分析
    ↓
exit_suggestion决定动作: hold/trail_stop/tighten/close_partial/close_all
    ↓
POST /ai_result → gold-bot → 对应命令入队
```

## gold-bot Changes (app.py)

### 1. ORDER_RESULT 触发 AI 分析

在 `/order_result` 端点，检测开仓成功后触发分析：

```python
@app.route('/order_result', methods=['POST'])
@require_token
def api_order_result():
    # 现有逻辑解析 result/ticket/error...
    
    # 新增：开仓成功触发 AI 分析
    if result.upper() == "OK" and cmd.get("action") == "SIGNAL":
        symbol = cmd.get("symbol", "XAUUSD")
        # 异步触发，不阻塞响应
        threading.Thread(
            target=_trigger_ai_analysis,
            args=(acc_id, symbol),
            daemon=True
        ).start()
        logger.info(f"[{acc_id}] 开仓成功，触发AI分析: {symbol}")

def _trigger_ai_analysis(account_id: str, symbol: str):
    """异步触发 gold-analysis-agent 分析"""
    aurex_url = os.getenv("AUREX_API_URL", "http://localhost:3100")
    try:
        resp = requests.post(
            f"{aurex_url}/api/v2/trigger_analysis/{account_id}/{symbol}",
            timeout=10
        )
        if resp.ok:
            logger.info(f"[{account_id}/{symbol}] AI分析触发成功")
        else:
            logger.warning(f"[{account_id}/{symbol}] AI分析触发失败: {resp.status_code}")
    except Exception as e:
        logger.error(f"[{account_id}/{symbol}] AI分析触发异常: {e}")
```

### 2. AI 结果处理优先级

`/api/v2/ai_result` 收到结果时：
- `suggested_sl > 0`: 优先使用 AI 建议的 SL
- `exit_suggestion = trail_stop/tighten`: MODIFY 更新止损
- `exit_suggestion = close_partial/close_all`: 平仓命令

已实现，确保 MODIFY 命令包含：
```python
cmd = {
    "action": "MODIFY",
    "ticket": ticket,
    "new_sl": suggested_sl,  # AI 建议值优先
    "new_tp": suggested_tp,
    "reason": f"AI建议: {alert_reason}",
}
```

## gold-analysis-agent Changes

### 1. 新增触发端点

新增 `/api/v2/trigger_analysis/:account/:symbol` 端点：

```typescript
// src/health/health.controller.ts 或新建 trigger.controller.ts
@Controller('api/v2')
export class TriggerController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post('trigger_analysis/:account/:symbol')
  async triggerAnalysis(
    @Param('account') account: string,
    @Param('symbol') symbol: string,
  ) {
    // 立即执行一次分析流程
    await this.workflow.runForSymbol(account, symbol);
    return { triggered: true, account, symbol, timestamp: new Date().toISOString() };
  }
}
```

### 2. 每15分钟轮询任务

```typescript
// src/scheduler/position-poll.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { WorkflowService } from '../graph/workflow.service.js';
import { GoldbotApiService } from '../tools/goldbot-api.js';
import { AppConfigService } from '../config/app-config.service.js';

@Processor('positionPoll', { concurrency: 1 })
export class PositionPollProcessor extends WorkerHost {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly goldbotApi: GoldbotApiService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  async process() {
    const accounts = this.config.monitoredAccounts || ['90011087'];
    const symbols = ['XAUUSD', 'GBPJPY'];

    for (const account of accounts) {
      for (const symbol of symbols) {
        try {
          // 拉取持仓数据
          const payload = await this.goldbotApi.fetchAnalysisPayload(account, symbol);
          
          if (!payload.positions || payload.positions.length === 0) {
            continue; // 无持仓跳过
          }

          // 执行 AI 分析
          const result = await this.workflow.runForSymbol(account, symbol);
          
          // 非 hold 状态才发送
          if (result.exit_suggestion && result.exit_suggestion !== 'hold') {
            await this.goldbotApi.postAIResult(account, symbol, result);
            this.logger.info(`[${account}/${symbol}] 发送AI建议: ${result.exit_suggestion}`);
          }
        } catch (e) {
          this.logger.error(`[${account}/${symbol}] 轮询失败: ${e}`);
        }
      }
    }
  }
}

// 在 app.module.ts 注册 BullMQ 队列
@Module({
  imports: [
    BullModule.registerQueue({ name: 'positionPoll' }),
    // ... 其他模块
  ],
  providers: [PositionPollProcessor],
})
```

### 3. 调度配置

```typescript
// src/scheduler/scheduler.service.ts
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {
  constructor(private schedulerRegistry: SchedulerRegistry) {}

  onModuleInit() {
    // 每15分钟执行一次持仓轮询
    const callback = () => this.positionPollQueue.add('poll');
    const interval = setInterval(callback, 15 * 60 * 1000);
    this.schedulerRegistry.addInterval('positionPoll', interval);
  }
}
```

## Environment Variables

gold-bot `.env`:
```
AUREX_API_URL=http://localhost:3100  # gold-analysis-agent 地址
```

gold-analysis-agent `.env`:
```
MONITORED_ACCOUNTS=90011087,81124211  # 监控的账户列表
```

## Testing

1. 模拟开仓 → 检查 `/trigger_analysis` 是否被调用
2. 检查 AI 分析结果返回 → MODIFY 命令入队
3. 检查每15分钟轮询 → 无持仓跳过，有持仓分析

## Rollback

如果 AI 分析失败或超时：
- 使用 gold-bot `_calculate_dynamic_sl_tp()` 作为 fallback
- 日志记录失败原因，不影响正常交易