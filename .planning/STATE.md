# STATE.md

**File:** `.planning/STATE.md`  
**Updated:** 2026-06-13 after multi-model analysis

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-13)

**Core value:** 在不增加系统复杂度的前提下，通过 Fibonacci 比例关系提升现有策略的盈亏比和入场精度

**Current focus:** Phase planning — Fibonacci Extension Target (方案B)

## Current Position

- **Phase:** Planning
- **Current step:** Analysis complete, requirements defined, roadmap approved
- **Next step:** Begin Phase 1 implementation

## Key Open Questions

| Question | Status | Notes |
|----------|--------|-------|
| Swing High/Low 窗口大小？ | Open | 复用现有 50-bar，per-symbol 可配置 |
| Fib 扩展位优先级（H4 vs H1）？ | Decision: H4 > H1 | H4 级别扩展位更可靠 |
| 扩展位默认启用还是关闭？ | Decision: 关闭 | 向后兼容，需配置显式开启 |
| pullback+Fib 增强默认启用？ | Decision: 关闭 | 向后兼容 |

## Active Context

**Multi-model consensus (2026-06-13):**
- DeepSeek V4 Pro: 建议 A→B→C（先入场，再扩展，C延后）
- Kimi K2.6: 建议 B→A，放弃C（B杠杆效应最大）
- GLM 5.1: Hybrid方案，B先，A融合pullback，否决C
- Qwen 3.7: 建议 B→C→改良A（增强而非替代）
- **最终决策**: B先再A，A融合到pullback，C不做，时间周期不做

## Last Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-13 | 方案B优先于方案A | 改动最小，惠及所有策略，风险最低 |
| 2026-06-13 | A不做独立策略 | 与pullback信号冗余，融合增强更优 |
| 2026-06-13 | 默认关闭 | 向后兼容，配置显式开启 |
| 2026-06-13 | H4扩展位优先于H1 | H4级别更可靠 |
| 2026-06-13 | C方案暂停 | 风险过高，3/4模型反对 |

---
*Last updated: 2026-06-13*
