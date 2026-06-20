# pullback_fib 策略名映射回 pullback

## 动机
当前 `pullback_fib` 作为独立策略名发给 EA，但 EA 端 `GetStrategyMagic("pullback_fib")` 返回 0 → 报 `❌ 未知策略`，信号被丢弃。
`pullback_fib` 只是 pullback 的 Fib 增强版，不是独立策略——为它独立注册 Magic 号会引入仓位管理分裂、EA 端重复注册等复杂度。
正确做法：映射回 `"pullback"`，用 Magic 20250231 下单。这是同一条交易逻辑，不是新策略。

## 改动范围
| 文件 | 改动 | 理由 |
|------|------|------|
| engine.go L865 | `"pullback_fib"` → `"pullback"` | BUY 侧 Fib 增强信号映射回 pullback |
| engine.go L994 | `"pullback_fib"` → `"pullback"` | SELL 侧 Fib 增强信号映射回 pullback |
| fibonacci_test.go L152-153 | 断言 `"pullback_fib"` → `"pullback"` | 测试跟随 |
| paylaod 可选 | 在 `buildSignalCommand` 的 paylaod 加 `"fib_enhanced": true` | 日志/审计追踪，EA 不消费 |

## 不改的范围
- EA 端零改动 — `GetStrategyMagic("pullback")` 已注册返回 20250231
- `Signal` struct 不需要新字段 — paylaod 里传标记即可，不污染域模型
- `buildStrategyCommandID` 自动变化（strategy 字段参与 hash），旧 pullback_fib 命令不会与新 pullback 命令碰撞

## 风险
- 零风险。这是把无效策略名改为有效策略名。
