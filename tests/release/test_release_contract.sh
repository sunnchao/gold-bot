#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

REPO_ROOT="$repo_root" python3 - <<'PY'
import os
import subprocess
from pathlib import Path

repo = Path(os.environ['REPO_ROOT'])
release_doc = repo / 'docs' / 'RELEASE.md'
release_text = release_doc.read_text(encoding='utf-8')
deployment_text = (repo / 'docs' / 'DEPLOYMENT.md').read_text(encoding='utf-8')
readme = (repo / 'docs' / 'README.md').read_text(encoding='utf-8')
compose_text = (repo / 'docker-compose.yaml').read_text(encoding='utf-8')
app_go = (repo / 'internal' / 'app' / 'app.go').read_text(encoding='utf-8')
help_text = subprocess.check_output(['python3', 'scripts/release.py', '--help'], text=True, cwd=repo)
check_text = subprocess.check_output(['python3', 'scripts/release.py', 'check', '--skip-git'], text=True, cwd=repo)
notes_text = subprocess.check_output(
    ['python3', 'scripts/release.py', 'notes', '--current-tag', 'v9.9.9', '--repository', 'sunnchao/gold-bot'],
    text=True,
    cwd=repo,
)

assert release_doc.exists(), 'missing docs/RELEASE.md'
assert 'RELEASE.md' in readme, 'docs/README.md missing release doc link'
assert 'check' in help_text and 'prepare' in help_text and 'notes' in help_text, 'release helper missing required subcommands'
assert 'release metadata OK' in check_text, 'release check did not validate current repo metadata'
assert '# v9.9.9' in notes_text, 'release notes output missing tag header'
assert '## 功能变更' in notes_text, 'release notes output missing grouped sections'
assert 'DSN' in deployment_text and 'GB_DB_PATH' in deployment_text, 'deployment doc must cover both PostgreSQL and SQLite config'
assert 'docker compose up -d --build' in release_text, 'release doc must match checked-in local build compose flow'
assert release_text.index('### 4. 提交版本准备变更') < release_text.index('### 5. 生成 release notes 草稿'), 'release doc must commit release changes before generating notes'
assert '--workflow docker.yml' in release_text and '--workflow release.yml' in release_text, 'release doc must watch both GitHub Actions workflows explicitly'
assert '--commit "$TAG_SHA"' in release_text, 'release doc must scope workflow watches to the pushed tag SHA'
assert 'build:' in compose_text and 'image: gold-bot:local' in compose_text, 'docker-compose contract changed unexpectedly'
assert '✅ PostgreSQL 数据库已连接' in release_text, 'release doc missing PostgreSQL log check'
assert '✅ SQLite 数据库已打开' in release_text, 'release doc missing SQLite log check'
assert 'Gold Bolt Server 启动中' in app_go and 'Gold Bolt Server 启动中' in release_text, 'release doc missing actual startup log string'
print('release workflow contract ok')
PY
