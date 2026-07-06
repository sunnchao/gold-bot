# MT4/MT5 EA Assets (Read-only)

**Status:** Archived / Read-only  
**Purpose:** EA source files served via app-server download endpoints

---

## Contents

```
apps/app-mt/
└── mt4_ea/
    ├── GoldBolt_Client.mq4    # MT4 EA source code (85 KB)
    └── version.json           # EA version metadata
```

---

## Usage

These files are served by the Node.js app-server via:

- **GET /api/ea/download** - Download EA source file
- **GET /api/ea/version** - Get EA version info

```bash
# Example: Download EA
curl http://localhost:8880/api/ea/download -o GoldBolt_Client.mq4

# Example: Check version
curl http://localhost:8880/api/ea/version
```

---

## Version Info

**Current Version:** 2.8.3 (Build 9)

**Changelog:**
- AI信号挂单: 新增 ai_signal 策略支持(Magic=20250238)
- 修复未知策略拒绝问题
- 兼容 tp/tp1 字段名
- AI信号使用服务端计算手数(含减半逻辑)
- 所有品种MaxSpread=80避免挂单被点差拦截
- SQLite方言移除，仅支持PostgreSQL

---

## Development

**⚠️ This directory is read-only in the Node.js monorepo.**

EA development happens in MT4/MT5 MetaEditor:

1. Edit `GoldBolt_Client.mq4` in MetaEditor
2. Compile to `.ex4`
3. Deploy to MT4/MT5 `Experts/` directory
4. Update `version.json` metadata
5. Copy files to this directory for distribution

---

## Docker Build

The Dockerfile copies these files into the image:

```dockerfile
COPY apps/app-mt/mt4_ea ./apps/app-mt/mt4_ea
```

At runtime, app-server resolves the path as:

```typescript
join(releaseRoot, 'apps', 'app-mt', 'mt4_ea', 'GoldBolt_Client.mq4')
```

---

## Historical Note

**Previous location:** `mt4_ea/` (root level)  
**Moved to:** `apps/app-mt/mt4_ea/` (2026-07-06)  
**Reason:** Consolidate MT4/MT5 assets under `apps/app-mt` during Go → Node.js migration

The original `mt4_ea/` and `mt5_ea/` directories contained:
- EA source files (.mq4, .mq5)
- Version metadata
- Hotfix documentation
- Test scripts

After migration, only essential distribution files are kept:
- ✅ `GoldBolt_Client.mq4` - EA source
- ✅ `version.json` - Version metadata
- ❌ Documentation (moved to `docs/`)
- ❌ Test scripts (archived)

---

## Related Files

- **App Server:** `apps/app-server/src/app.ts` (download endpoints)
- **Docker:** `apps/app-server/Dockerfile` (COPY instruction)
- **Docs:** `docs/MONOREPO_STRUCTURE.md` (architecture)

---

**Last Updated:** 2026-07-06
