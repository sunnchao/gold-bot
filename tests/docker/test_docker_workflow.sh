#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
from pathlib import Path

dockerfile = Path("Dockerfile").read_text()
workflow = Path(".github/workflows/docker.yml").read_text()

builder_line = next(
    (line for line in dockerfile.splitlines() if line.startswith("FROM node:") and "AS dashboard-builder" in line),
    None,
)

assert builder_line, "Dockerfile missing dashboard Node builder stage"

version_spec = builder_line.split("FROM node:", 1)[1].split(" ", 1)[0].removesuffix("-bookworm-slim")

if "." in version_spec:
    major_str, minor_str, *_ = version_spec.split(".")
    major = int(major_str)
    minor = int(minor_str)
else:
    major = int(version_spec)
    minor = 0

assert (
    major > 22
    or major == 22
    or (major == 20 and minor >= 19)
), "Dockerfile Node base image is below the Vite 8 engine floor"

assert "FROM python:3.11-slim" not in dockerfile, "Dockerfile still targets Python runtime"
assert "golang:1.24" in dockerfile, "Dockerfile missing Go builder stage"
assert "npm run build" in dockerfile, "Dockerfile missing dashboard build"
assert "workflow_dispatch:" in workflow, "workflow missing workflow_dispatch trigger"
assert "push_image" in workflow, "workflow missing manual push control"
print("docker workflow contract ok")
PY
