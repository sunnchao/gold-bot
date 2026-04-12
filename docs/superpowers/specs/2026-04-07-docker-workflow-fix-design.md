# Docker Workflow Fix Design

Date: 2026-04-07

## Summary

Repair GitHub Actions Docker publishing by adding a valid `.github/workflows/docker.yml` to the current repository. The fixed workflow will publish GHCR images only for `v*` tag pushes, derive the image name from `${{ github.repository }}`, and generate normalized semver tags through `docker/metadata-action@v5`.

## Problem Statement

Two separate workflow issues were identified from recent GitHub Actions failures:

1. A workflow parse failure caused by unsupported GitHub Actions expression syntax:
   - `${{ github.event.repository.name.toLowerCase() }}`
   - Result: run fails before any job starts.
2. A Docker tag generation failure caused by invalid metadata configuration:
   - `ghcr.io/${{ github.repository.lower }}` produced an empty image name.
   - `type=sha,prefix={{branch}}-` ran on a tag event where `{{branch}}` was empty.
   - Result: Docker received an invalid tag like `ghcr.io/:-38b5bb4`.

## Goals

- Make the workflow valid and parseable by GitHub Actions.
- Publish Docker images to GHCR only on `v*` tag pushes.
- Generate legal, stable image tags for release tags such as `v1.0.0`.
- Keep the workflow close to official GitHub and Docker action recommendations.
- Limit changes to CI workflow behavior only.

## Non-Goals

- No changes to application code.
- No changes to Dockerfile build logic unless later validation proves they are required.
- No support for branch builds or manual dispatch in this repair.
- No extra custom scripting for tag generation.

## Chosen Approach

Use a single-job workflow built around the standard Docker GitHub Actions stack:

1. `actions/checkout`
2. `docker/setup-qemu-action`
3. `docker/setup-buildx-action`
4. `docker/login-action` with `GITHUB_TOKEN` for `ghcr.io`
5. `docker/metadata-action@v5` for image and tag generation
6. `docker/build-push-action@v6` using metadata outputs directly

This approach removes all custom string manipulation and relies on documented behavior from `docker/metadata-action@v5`, including lowercasing of image names derived from `${{ github.repository }}`.

## Workflow Design

### Trigger

The workflow will trigger only on:

```yaml
on:
  push:
    tags:
      - 'v*'
```

`workflow_dispatch` will not be included.

### Permissions

The workflow will request only the permissions needed for GHCR publishing:

```yaml
permissions:
  contents: read
  packages: write
```

### Image Naming

The workflow will define the image name via `docker/metadata-action@v5` as:

```yaml
images: |
  ghcr.io/${{ github.repository }}
```

Rationale:

- This follows common official examples.
- It avoids unsupported GitHub expression helpers.
- `metadata-action` handles normalization for image name requirements.

### Tag Strategy

The workflow will use normalized semver tags:

```yaml
tags: |
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
```

Expected result for `v1.0.0`:

- `1.0.0`
- `1.0`
- `latest` for stable releases through the action's default behavior

This intentionally avoids:

- `type=ref,event=branch`
- `type=sha,prefix={{branch}}-`
- custom raw latest logic

Those patterns are unnecessary for tag-only publishing and were part of the earlier failure mode.

## Failure Handling and Observability

- If GitHub cannot parse the workflow, the run will fail immediately before job start. This repair removes unsupported expression syntax to avoid that class of failure.
- If registry login fails, the failure will surface in the `docker/login-action` step.
- If metadata generation fails, the failure will surface in the metadata step rather than inside custom shell logic.
- If image build or push fails, the failure will surface in `docker/build-push-action` with the generated tags visible in logs.

This keeps failure points aligned with standard action steps and makes future debugging more direct.

## Validation Plan

Validation for this repair will use the following checks:

1. Confirm the workflow file contains only supported GitHub Actions expressions.
2. Confirm the workflow is syntactically valid YAML.
3. Confirm image generation uses `ghcr.io/${{ github.repository }}`.
4. Confirm tag generation uses semver rules only.
5. After deployment, verify that a `v*` tag run starts a `build` job instead of failing at `0s`.
6. Verify metadata and build logs show legal tags such as:
   - `ghcr.io/sunnchao/gold-bot:1.0.0`
   - `ghcr.io/sunnchao/gold-bot:1.0`
   - `ghcr.io/sunnchao/gold-bot:latest` for stable releases

## Risks and Mitigations

- Risk: `latest` behavior may not match future publishing preferences.
  - Mitigation: the current design intentionally keeps default stable-release behavior; if needed later, `flavor: latest=false` can disable it cleanly.
- Risk: the local repository is currently on `main` while the original failing file existed only on a remote feature branch.
  - Mitigation: this repair adds the workflow explicitly in the current repository state instead of trying to patch a missing local file.

## Acceptance Criteria

The repair is complete when all of the following are true:

- `.github/workflows/docker.yml` exists in the current repository.
- GitHub Actions can parse the workflow successfully.
- A `v*` tag run reaches the `build` job.
- Docker metadata outputs a non-empty GHCR image name.
- Generated tags are valid semver-derived GHCR tags.
- The previous invalid tag format `ghcr.io/:-<sha>` no longer appears.
