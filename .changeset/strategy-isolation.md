---
"@gold-bot/trading-core": minor
---

feat(trading-core): 实现技术策略持仓隔离

每个技术策略（pullback, breakout_retest, divergence 等）现在只检查自己策略的持仓，不再受其他策略持仓影响。

**核心改动**:
- replay 引擎按策略过滤持仓，实现策略间隔离
- pullback 信号不会被 breakout_retest 持仓阻止
- 技术策略与 AI 信号完全隔离

**测试覆盖**:
- 跨策略允许信号
- 同策略阻止重复信号
- 向后兼容缺少策略标签的持仓

**影响范围**: 
- 仅影响技术策略信号生成逻辑
- AI 信号和 Risk Gate 保持不变
