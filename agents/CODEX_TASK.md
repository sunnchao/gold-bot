# CODEX_TASK.md — Fix Zod schema for harmonic_pattern

## Mission
`/api/v2/analysis_payload/:accountId/:symbol` 返回的 `harmonic_context` 中，
`h4_patterns`/`h1_patterns`/`m30_patterns` 数组中的 pattern 对象缺少 `completion_pct` 和 `is_active` 字段。
导致 Zod 验证失败，所有品种分析都被跳过。

##rior error
```
ZodError: harmonic_context.h4_patterns[0].completion_pct: Required
         harmonic_context.h4_patterns[0].is_active: Required
```

## Files to Modify
`src/types/schemas.ts` — 修改 `HarmonicAnalysisResultSchema`，将 `completion_pct` 和新增字段设为可选。

## Changes Needed

In `src/types/schemas.ts`, find:
```typescript
export const HarmonicAnalysisResultSchema = z.object({
  detected_pattern: z.enum([...]),
  direction: z.enum([...]),
  timeframe: z.string(),
  completion_pct: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  d_zone_price: z.number(),
  entry_zone: z.string(),
  stop_loss: z.number(),
  take_profit_1: z.number(),
  take_profit_2: z.number(),
  rationale: z.string().min(1),
});
```

Replace with:
```typescript
export const HarmonicAnalysisResultSchema = z.object({
  detected_pattern: z.enum([...]),
  direction: z.enum([...]),
  timeframe: z.string(),
  completion_pct: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
  confidence: z.number().min(0).max(100),
  d_zone_price: z.number(),
  entry_zone: z.string(),
  stop_loss: z.number(),
  take_profit_1: z.number(),
  take_profit_2: z.number(),
  rationale: z.string().min(1),
});
```

Also check `src/types/analysis.ts` interface `HarmonicAnalysisResult` to add optional fields if needed.

## Success Criteria
- [ ] `npm run build` compiles
- [ ] Zod schema validation passes with missing `completion_pct` and `is_active`
- [ ] Analysis can proceed without being blocked
