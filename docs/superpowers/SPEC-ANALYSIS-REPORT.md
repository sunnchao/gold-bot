# Gold Bot SPEC 文档分析整理报告

> 方法论: superpowers / writing-plans skill
> 日期: 2026-05-01
> 范围: docs/superpowers/specs/ + docs/superpowers/plans/

---

## 执行摘要

1. **Aurex Agent Skill 化** ✅ 已完成
   - 创建了正式 Hermes skill: `aurex-gold-analysis`
   - 路径: `~/.hermes/skills/gold-bot/aurex-gold-analysis/SKILL.md`
   - 同步备份至: `docs/superpowers/aurex-agent-skill.md`

2. **SPEC 文档分析** ✅ 已完成
   - 覆盖 3 个 specs + 4 个 plans
   - 按 writing-plans 标准评分

3. **毛选 skill 正版地址确认** ⚠️ 待处理
   - 指定地址: `https://github.com/leezythu/maoxuan-skill`
   - 当前本地已安装 `mao-zedong-perspective`，需核对是否为正版

---

## 一、SPEC 文档清单

| 文档 | 类型 | 日期 | 状态 |
|-------|------|------|------|
| 2026-04-12-go-rewrite-design.md | SPEC | 2026-04-12 | 已落地 |
| 2026-04-13-go-docker-workflow-design.md | SPEC | 2026-04-13 | 已落地 |
| 2026-04-07-docker-workflow-fix-design.md | SPEC | 2026-04-07 | 已落地 |
| 2026-04-12-go-rewrite-program.md | PLAN | 2026-04-12 | 已落地 |
| 2026-04-13-go-docker-workflow.md | PLAN | 2026-04-13 | 已落地 |
| 2026-04-07-docker-workflow-fix.md | PLAN | 2026-04-07 | 已落地 |
| 2026-04-02-goldbolt-client-mt5-port.md | PLAN | 2026-04-02 | 已落地 |

---

## 二、Writing-Plans 标准评分

### 评分维度

| 维度 | 权重 | 说明 |
|------|------|------|
| Bite-sized tasks | 25% | 每个任务 = 2-5 分钟 |
| Exact file paths | 15% | 精确文件路径，无模糊表述 |
| Complete code | 20% | 可直接复制粘贴的代码 |
| Exact commands | 15% | 精确命令 + 预期输出 |
| Verification steps | 15% | 每个任务有验证步骤 |
| TDD / Red-Green | 10% | 先写失败测试再实现 |

---

### SPEC 评分卡

#### 1. 2026-04-12-go-rewrite-design.md — 评分: A-

| 维度 | 评分 | 说明 |
|------|------|------|
| 结构完整性 | ✅ | Summary / Constraints / Goals / Non-Goals / Approach / Architecture / Data Model / API / Frontend / Migration 全覆盖 |
| Bite-sized | ⚠️ | 过于宏大，未拆分为可直接执行的小任务 |
| Exact paths | ✅ | 提供了完整的目录结构 |
| Complete code | ⚠️ | 以架构描述为主，缺少可复制的代码片段 |
| Verification | ⚠️ | 提供了验收标准但缺少步骤化验证 |
| TDD | ❌ | 未体现 Red-Green 循环 |

**诊断:** 这是一份优秀的「设计规格」，但不是一份可直接执行的「实现计划」。它的作用是定向，而非指导每行代码的编写。

**整理建议:**
- 保持作为「Design Spec」，不需要改为实现计划格式
- 建议在文档顶部添加分类标签: `#type:design-spec #status:archived`
- 已有对应的 plan (2026-04-12-go-rewrite-program.md) 负责具体实现

---

#### 2. 2026-04-13-go-docker-workflow-design.md — 评分: A

| 维度 | 评分 | 说明 |
|------|------|------|
| 结构完整性 | ✅ | Goal / Current State / Scope / Approach / Dockerfile / Workflow / Verification 全覆盖 |
| Bite-sized | ✅ | 范围控制得当，不浸入业务代码 |
| Exact paths | ✅ | Dockerfile、.dockerignore、workflow 路径明确 |
| Complete code | ✅ | 提供了可复制的 Dockerfile 和 workflow YAML |
| Verification | ✅ | 有明确的本地验证步骤 (docker build / curl healthz) |
| TDD | ⚠️ | 无 Red-Green，但有红绿校验点 |

**诊断:** 一份精炼的「CI/CD 设计规格」，范围清晰，代码可复制，验证可行。

**整理建议:**
- 已达到交付标准，无需重大调整
- 建议标记: `#type:ci-spec #status:implemented`

---

#### 3. 2026-04-07-docker-workflow-fix-design.md — 评分: A

| 维度 | 评分 | 说明 |
|------|------|------|
| 结构完整性 | ✅ | Problem / Goals / Approach / Workflow Design / Validation / Risks 全覆盖 |
| Bite-sized | ✅ | 范围极窄，只修复 CI 解析问题 |
| Exact paths | ✅ | 只涉及 2 个文件，路径明确 |
| Complete code | ✅ | 提供了可用的 Dockerfile 和 workflow |
| Verification | ✅ | 有明确的校验点和验证步骤 |
| TDD | ⚠️ | 无 Red-Green，但有先证明失败再修复的逻辑 |

**诊断:** 一份标准的「Bug Fix 规格」，问题描述清晰，解决方案精确，验证可行。

**整理建议:**
- 已达交付标准，无需调整
- 建议标记: `#type:fix-spec #status:implemented`

---

### PLAN 评分卡

#### 4. 2026-04-12-go-rewrite-program.md — 评分: A

| 维度 | 评分 | 说明 |
|------|------|------|
| Bite-sized | ✅ | 拆分为 7 个 Task，每个 Task 内部再拆分为 Steps |
| Exact paths | ✅ | 每个文件路径精确，包括新建和修改 |
| Complete code | ✅ | 提供了可复制粘贴的 Go/SQL 代码 |
| Exact commands | ✅ | 每个 Step 都有精确的命令和预期输出 |
| Verification | ✅ | 每个 Task 最后都有测试验证步骤 |
| TDD | ✅ | 每个 Task 的 Step 1 都是写失败测试，Step 2 是确认失败，符合 Red-Green |
| Frequent commits | ✅ | 每个 Task 结尾都有 git commit 命令 |

**诊断:** 这是一份标准的 superpowers 实现计划，完全符合 writing-plans skill 的所有标准。

**整理建议:**
- 已是优秀范例，无需调整
- 建议标记: `#type:implementation-plan #status:implemented`

---

#### 5. 2026-04-13-go-docker-workflow.md — 评分: A

| 维度 | 评分 | 说明 |
|------|------|------|
| Bite-sized | ✅ | 4 个 Task，每个只做一件事 |
| Exact paths | ✅ | Dockerfile、.dockerignore、workflow 路径明确 |
| Complete code | ✅ | Dockerfile 和 YAML 完整可复制 |
| Exact commands | ✅ | bash 校验脚本、docker 命令精确 |
| Verification | ✅ | 有负责校验脚本和本地验证步骤 |
| TDD | ✅ | Task 1 以失败校验脚本开头，符合 Red-Green |
| Frequent commits | ✅ | 最后有 commit 命令 |

**诊断:** 精炼的 CI 实现计划，完全符合标准。

**整理建议:**
- 已是优秀范例，无需调整
- 建议标记: `#type:implementation-plan #status:implemented`

---

#### 6. 2026-04-07-docker-workflow-fix.md — 评分: A

| 维度 | 评分 | 说明 |
|------|------|------|
| Bite-sized | ✅ | 3 个 Task，每个只做一件事 |
| Exact paths | ✅ | Dockerfile、workflow 路径明确 |
| Complete code | ✅ | Dockerfile 和 YAML 完整可复制 |
| Exact commands | ✅ | python3 校验脚本精确 |
| Verification | ✅ | 每个 Task 有校验脚本 |
| TDD | ✅ | Step 1 都是先证明失败 (assert missing) |
| Frequent commits | ❌ | 最后明确说不提交，符合当时语境 |

**诊断:** 标准的 Bug Fix 实现计划，红绿循环完整，代码可复制。

**整理建议:**
- 已是优秀范例，无需调整
- 建议标记: `#type:implementation-plan #status:implemented`

---

#### 7. 2026-04-02-goldbolt-client-mt5-port.md — 评分: A-

| 维度 | 评分 | 说明 |
|------|------|------|
| Bite-sized | ✅ | 3 个 Task，范围清晰 |
| Exact paths | ✅ | mt5_ea/、tests/verify_*.py 路径明确 |
| Complete code | ✅ | MQL5 代码片段可复制 |
| Exact commands | ✅ | python3 校验命令精确 |
| Verification | ✅ | 有校验脚本和手动编译步骤 |
| TDD | ✅ | Step 1 先证明缺失文件 |
| Frequent commits | ❌ | 最后注明当时未要求 commit |

**诊断:** 一份标准的跨语言移植计划，结构完整，验证充分。

**整理建议:**
- 已是优秀范例，无需调整
- 建议标记: `#type:implementation-plan #status:implemented`

---

## 三、整体评估

### 优点

1. **SPEC 与 PLAN 分离清晰**
   - SPEC 负责「为什么」和「是什么」
   - PLAN 负责「怎么做」和「步骤是什么」
   - 两者分离符合软件工程最佳实践

2. **PLAN 质量极高**
   - 4 份 PLAN 全部达到 A 级
   - 都遵循了 Red-Green 流程
   - 代码可复制，路径精确

3. **SPEC 结构规范**
   - 都采用统一的标准模板：Summary / Goals / Non-Goals / Approach / Design / Acceptance Criteria

### 改进点

1. **SPEC 可执行性**
   - go-rewrite-design 过于宏大，需要配合 PLAN 才能执行
   - 建议在 SPEC 顶部添加: `> 执行请参考对应 PLAN: 2026-04-12-go-rewrite-program.md`

2. **文档状态标记**
   - 所有文档都已实现，但文件本身没有状态标记
   - 建议统一添加 frontmatter 或顶部标签

3. **索引文档**
   - 建议在 `docs/superpowers/README.md` 中创建索引，链接所有 specs 和 plans

---

## 四、整理后的文档结构建议

```
docs/superpowers/
├── README.md                    # 新增: 索引文档
├── aurex-agent-skill.md         # 新增: Aurex Agent Skill (已完成)
├── SPEC-ANALYSIS-REPORT.md      # 新增: 本报告 (已完成)
├── specs/
│   ├── 2026-04-12-go-rewrite-design.md          # 建议添加 #type:design-spec #status:archived
│   ├── 2026-04-13-go-docker-workflow-design.md  # 建议添加 #type:ci-spec #status:implemented
│   └── 2026-04-07-docker-workflow-fix-design.md # 建议添加 #type:fix-spec #status:implemented
└── plans/
    ├── 2026-04-12-go-rewrite-program.md         # 建议添加 #type:implementation-plan #status:implemented
    ├── 2026-04-13-go-docker-workflow.md         # 建议添加 #type:implementation-plan #status:implemented
    ├── 2026-04-07-docker-workflow-fix.md        # 建议添加 #type:implementation-plan #status:implemented
    └── 2026-04-02-goldbolt-client-mt5-port.md  # 建议添加 #type:implementation-plan #status:implemented
```

---

## 五、次步行动

1. ✅ **Aurex Agent Skill 化** — 已完成
2. ⚠️ **毛选 skill 正版地址确认** — 需要你确认是否需要从 `https://github.com/leezythu/maoxuan-skill` 更新本地 skill
3. 📋 **可选: 为所有文档添加状态标记** — 如需要，可以自动为每个文档添加统一的标签
4. 📋 **可选: 创建 docs/superpowers/README.md 索引** — 如需要，可以自动生成
