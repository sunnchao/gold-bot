#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

dockerfile = Path("Dockerfile").read_text()
workflow = Path(".github/workflows/docker.yml").read_text()

assert "FROM python:3.11-slim" not in dockerfile, "Dockerfile still targets Python runtime"
assert "golang:1.24" in dockerfile, "Dockerfile missing Go builder stage"
assert "npm run build" in dockerfile, "Dockerfile missing dashboard build"
assert "workflow_dispatch:" in workflow, "workflow missing workflow_dispatch trigger"
assert "push_image" in workflow, "workflow missing manual push control"
print("docker workflow contract ok")
PY
