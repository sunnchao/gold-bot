# Docker Workflow Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub Actions publish a working GHCR image for `v*` tags by adding a valid Docker publish workflow and a Dockerfile that matches the repository’s existing Python package assumptions.

**Architecture:** Keep application code unchanged. Fix the CI path by creating a root `Dockerfile` and a `.github/workflows/docker.yml` that uses the standard Docker GitHub Actions stack. The Docker image will copy the repo into `/app/gold_bolt_server` so existing `gold_bolt_server.*` imports resolve without a packaging refactor.

**Tech Stack:** GitHub Actions, Docker, GHCR, Python 3.11, docker/metadata-action@v5, docker/build-push-action@v6

---

### Task 1: Add a Dockerfile that satisfies current imports

**Files:**
- Create: `Dockerfile`
- Verify against: `__main__.py`, `app.py`, `requirements.txt`

- [ ] **Step 1: Prove the current repository cannot build the publish path yet**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
assert Path('Dockerfile').exists(), 'Dockerfile missing'
PY
```

Expected: FAIL with `AssertionError: Dockerfile missing`

- [ ] **Step 2: Create `Dockerfile`**

```Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/gold_bolt_server

EXPOSE 8880

CMD ["python3", "-m", "gold_bolt_server.app"]
```

- [ ] **Step 3: Verify the Dockerfile contains the required layout and entrypoint**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('Dockerfile').read_text()
assert 'FROM python:3.11-slim' in text
assert 'WORKDIR /app' in text
assert 'COPY requirements.txt .' in text
assert 'COPY . /app/gold_bolt_server' in text
assert 'CMD ["python3", "-m", "gold_bolt_server.app"]' in text
print('dockerfile ok')
PY
```

Expected: PASS with `dockerfile ok`

- [ ] **Step 4: Build the image locally**

Run:

```bash
docker build -t gold-bot:test .
```

Expected: PASS and finish with a successfully built local image tagged `gold-bot:test`

- [ ] **Step 5: Verify imports resolve inside the container**

Run:

```bash
docker run --rm --entrypoint python3 gold-bot:test -c "import gold_bolt_server.app; print('import ok')"
```

Expected: PASS with `import ok`

### Task 2: Add the tag-driven Docker publish workflow

**Files:**
- Create: `.github/workflows/docker.yml`
- Verify against: `Dockerfile`

- [ ] **Step 1: Prove the workflow does not exist yet**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
assert Path('.github/workflows/docker.yml').exists(), 'workflow missing'
PY
```

Expected: FAIL with `AssertionError: workflow missing`

- [ ] **Step 2: Create `.github/workflows/docker.yml`**

```yaml
name: Docker Publish

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: |
            ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

- [ ] **Step 3: Verify the workflow uses only safe image and tag generation rules**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('.github/workflows/docker.yml').read_text()
assert "- 'v*'" in text
assert 'ghcr.io/${{ github.repository }}' in text
assert 'type=semver,pattern={{version}}' in text
assert 'type=semver,pattern={{major}}.{{minor}}' in text
assert 'toLowerCase()' not in text
assert 'github.repository.lower' not in text
assert 'type=sha,prefix={{branch}}-' not in text
assert 'type=raw,value=latest,enable={{is_default_branch}}' not in text
print('workflow ok')
PY
```

Expected: PASS with `workflow ok`

- [ ] **Step 4: Review the final diff for only the intended files**

Run:

```bash
git diff -- Dockerfile .github/workflows/docker.yml docs/superpowers/plans/2026-04-07-docker-workflow-fix.md
```

Expected: PASS and show only the new Dockerfile, the new workflow, and the saved implementation plan

### Task 3: Perform the final local verification pass

**Files:**
- Verify: `Dockerfile`
- Verify: `.github/workflows/docker.yml`

- [ ] **Step 1: Re-run the Dockerfile content assertions**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('Dockerfile').read_text()
required = [
    'FROM python:3.11-slim',
    'WORKDIR /app',
    'COPY requirements.txt .',
    'COPY . /app/gold_bolt_server',
    'CMD ["python3", "-m", "gold_bolt_server.app"]',
]
for item in required:
    assert item in text, item
print('dockerfile recheck ok')
PY
```

Expected: PASS with `dockerfile recheck ok`

- [ ] **Step 2: Re-run the workflow content assertions**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
text = Path('.github/workflows/docker.yml').read_text()
required = [
    "- 'v*'",
    'contents: read',
    'packages: write',
    'ghcr.io/${{ github.repository }}',
    'type=semver,pattern={{version}}',
    'type=semver,pattern={{major}}.{{minor}}',
    'file: ./Dockerfile',
]
for item in required:
    assert item in text, item
print('workflow recheck ok')
PY
```

Expected: PASS with `workflow recheck ok`

- [ ] **Step 3: Re-run the container import check**

Run:

```bash
docker run --rm --entrypoint python3 gold-bot:test -c "import gold_bolt_server.app; print('import ok')"
```

Expected: PASS with `import ok`

- [ ] **Step 4: Stop and ask before any git commit or push**

Run:

```bash
git status --short
```

Expected: PASS and show the new files ready for review; do not commit or push unless the user explicitly asks
