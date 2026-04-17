#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable


SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
PROPERTY_VERSION_RE = re.compile(r'(^\s*#property version\s+")([^"]+)(")', re.MULTILINE)
EA_VERSION_RE = re.compile(r'(^\s*#define EA_VERSION\s+")([^"]+)(")', re.MULTILINE)
EA_BUILD_RE = re.compile(r'(^\s*#define EA_BUILD\s+)(\d+)', re.MULTILINE)


class ReleaseError(RuntimeError):
    pass


def repo_root_from(path: str | Path | None = None) -> Path:
    if path:
        return Path(path).resolve()
    return Path(__file__).resolve().parents[1]


def ensure_semver(version: str) -> None:
    if not SEMVER_RE.match(version):
        raise ReleaseError(f"version must be semver like 2.9.0, got: {version}")


def property_version(version: str) -> str:
    ensure_semver(version)
    major, minor, _patch = version.split(".")
    return f"{major}.{minor}"


def _single_match(text: str, pattern: re.Pattern[str], label: str) -> re.Match[str]:
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise ReleaseError(f"expected exactly one {label}, found {len(matches)}")
    return matches[0]


def _replace_once(text: str, pattern: re.Pattern[str], replacement: str, label: str) -> str:
    _single_match(text, pattern, label)
    updated, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise ReleaseError(f"failed to update {label}")
    return updated


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ReleaseError(f"failed to read {path}: {exc}") from exc


def _write_text(path: Path, content: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    except OSError as exc:
        raise ReleaseError(f"failed to write {path}: {exc}") from exc


def parse_ea_metadata(path: Path) -> dict[str, str | int]:
    text = _read_text(path)
    version_match = _single_match(text, EA_VERSION_RE, f"{path} EA_VERSION")
    build_match = _single_match(text, EA_BUILD_RE, f"{path} EA_BUILD")
    property_match = _single_match(text, PROPERTY_VERSION_RE, f"{path} property version")
    return {
        "ea_version": version_match.group(2),
        "ea_build": int(build_match.group(2)),
        "property_version": property_match.group(2),
    }


def build_updated_ea_metadata(path: Path, *, version: str, build: int) -> str:
    text = _read_text(path)
    text = _replace_once(
        text,
        PROPERTY_VERSION_RE,
        rf'\g<1>{property_version(version)}\g<3>',
        f"{path} property version",
    )
    text = _replace_once(
        text,
        EA_VERSION_RE,
        rf'\g<1>{version}\g<3>',
        f"{path} EA_VERSION",
    )
    text = _replace_once(
        text,
        EA_BUILD_RE,
        rf'\g<1>{build}',
        f"{path} EA_BUILD",
    )
    return text


def _restore_files(originals: dict[Path, str]) -> None:
    restore_errors: list[str] = []
    for path, content in originals.items():
        try:
            _write_text(path, content)
        except ReleaseError as exc:
            restore_errors.append(str(exc))
    if restore_errors:
        raise ReleaseError("failed to restore release files: " + "; ".join(restore_errors))


def validate_release_tree(root: str | Path) -> list[str]:
    root = repo_root_from(root)
    errors: list[str] = []
    version_path = root / "mt4_ea" / "version.json"
    mq4_path = root / "mt4_ea" / "GoldBolt_Client.mq4"
    mq5_path = root / "mt5_ea" / "GoldBolt_Client.mq5"

    for required in (version_path, mq4_path, mq5_path):
        if not required.exists():
            errors.append(f"missing required release file: {required.relative_to(root)}")
    if errors:
        return errors

    try:
        version_data = json.loads(_read_text(version_path))
    except json.JSONDecodeError as exc:
        return [f"invalid JSON in {version_path.relative_to(root)}: {exc}"]

    version_raw = version_data.get("version")
    build = version_data.get("build")
    changelog_raw = version_data.get("changelog")

    version = version_raw if isinstance(version_raw, str) else ""
    changelog = changelog_raw.strip() if isinstance(changelog_raw, str) else ""

    if not isinstance(version_raw, str) or not SEMVER_RE.match(version_raw):
        errors.append(f"mt4_ea/version.json version is not semver string: {version_raw!r}")
    if isinstance(build, bool) or not isinstance(build, int) or build <= 0:
        errors.append(f"mt4_ea/version.json build must be positive integer, got: {build!r}")
    if not isinstance(changelog_raw, str) or not changelog:
        errors.append(f"mt4_ea/version.json changelog must be non-empty string, got: {changelog_raw!r}")

    try:
        mq4 = parse_ea_metadata(mq4_path)
        mq5 = parse_ea_metadata(mq5_path)
    except ReleaseError as exc:
        errors.append(str(exc))
        return errors

    expected_property = property_version(version) if SEMVER_RE.match(version) else None
    for label, meta in (("mq4", mq4), ("mq5", mq5)):
        if meta["ea_version"] != version:
            errors.append(f"{label} EA_VERSION mismatch: {meta['ea_version']} != {version}")
        if meta["ea_build"] != build:
            errors.append(f"{label} EA_BUILD mismatch: {meta['ea_build']} != {build}")
        if expected_property and meta["property_version"] != expected_property:
            errors.append(
                f"{label} #property version mismatch: {meta['property_version']} != {expected_property}"
            )

    return errors


def prepare_release_files(*, root: str | Path, version: str, build: int, changelog: str) -> None:
    root = repo_root_from(root)
    ensure_semver(version)
    if build <= 0:
        raise ReleaseError(f"build must be > 0, got: {build}")
    changelog = changelog.strip()
    if not changelog:
        raise ReleaseError("changelog must not be empty")

    version_path = root / "mt4_ea" / "version.json"
    mq4_path = root / "mt4_ea" / "GoldBolt_Client.mq4"
    mq5_path = root / "mt5_ea" / "GoldBolt_Client.mq5"

    if not version_path.exists() or not mq4_path.exists() or not mq5_path.exists():
        raise ReleaseError("release files missing; expected mt4_ea/version.json and both EA sources")

    originals = {
        version_path: _read_text(version_path),
        mq4_path: _read_text(mq4_path),
        mq5_path: _read_text(mq5_path),
    }
    version_payload = {
        "version": version,
        "build": build,
        "changelog": changelog,
    }
    updates = {
        version_path: json.dumps(version_payload, ensure_ascii=False, indent=2) + "\n",
        mq4_path: build_updated_ea_metadata(mq4_path, version=version, build=build),
        mq5_path: build_updated_ea_metadata(mq5_path, version=version, build=build),
    }

    try:
        for path, content in updates.items():
            _write_text(path, content)

        errors = validate_release_tree(root)
        if errors:
            raise ReleaseError("post-update validation failed: " + "; ".join(errors))
    except ReleaseError:
        _restore_files(originals)
        raise


def build_release_notes(
    *,
    current_tag: str,
    previous_tag: str | None,
    commit_subjects: Iterable[str],
    repository: str,
) -> str:
    features: list[str] = []
    fixes: list[str] = []
    others: list[str] = []

    for subject in commit_subjects:
        subject = subject.strip()
        if not subject:
            continue
        lowered = subject.lower()
        if lowered.startswith("feat"):
            features.append(f"- {subject}")
        elif lowered.startswith("fix"):
            fixes.append(f"- {subject}")
        else:
            others.append(f"- {subject}")

    lines = [f"# {current_tag}", ""]
    if previous_tag:
        lines.extend(
            [
                f"比较: [`{previous_tag} → {current_tag}`](https://github.com/{repository}/compare/{previous_tag}...{current_tag})",
                "",
            ]
        )

    sections = [
        ("功能变更", features),
        ("缺陷修复", fixes),
        ("其他变更", others),
    ]
    for title, items in sections:
        lines.append(f"## {title}")
        lines.append("")
        lines.extend(items or ["- 无"])
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def git(args: list[str], *, cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise ReleaseError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def git_branch(root: Path) -> str:
    return git(["branch", "--show-current"], cwd=root)


def git_is_dirty(root: Path) -> bool:
    return bool(git(["status", "--short"], cwd=root))


def latest_semver_tags(root: Path) -> list[str]:
    output = git(["tag", "--sort=-v:refname"], cwd=root)
    return [tag for tag in output.splitlines() if re.match(r"^v\d+\.\d+\.\d+$", tag)]


def previous_semver_tag(root: Path, *, current_tag: str | None = None) -> str | None:
    tags = latest_semver_tags(root)
    if not tags:
        return None
    if current_tag and current_tag in tags:
        index = tags.index(current_tag)
        return tags[index + 1] if index + 1 < len(tags) else None
    return tags[0]


def git_commit_subjects(root: Path, *, previous_tag: str | None, ref: str = "HEAD") -> list[str]:
    revision = f"{previous_tag}..{ref}" if previous_tag else ref
    output = git(["log", revision, "--pretty=format:%s"], cwd=root)
    return [line.strip() for line in output.splitlines() if line.strip()]


def cmd_check(args: argparse.Namespace) -> int:
    root = repo_root_from(args.repo_root)
    errors = validate_release_tree(root)
    if not args.skip_git:
        branch = git_branch(root)
        if branch != "main":
            errors.append(f"release should be cut from main, current branch is {branch}")
        if git_is_dirty(root) and not args.allow_dirty:
            errors.append("working tree is dirty; commit or stash changes before release")

    if errors:
        print("release check failed:", file=sys.stderr)
        for err in errors:
            print(f"- {err}", file=sys.stderr)
        return 1

    current = json.loads(_read_text(root / "mt4_ea" / "version.json"))
    previous = previous_semver_tag(root, current_tag=None) if not args.skip_git else None
    print("release metadata OK")
    print(f"version: {current['version']}")
    print(f"build: {current['build']}")
    if previous:
        print(f"latest tag: {previous}")
    return 0


def cmd_prepare(args: argparse.Namespace) -> int:
    root = repo_root_from(args.repo_root)
    changelog = args.changelog
    if args.changelog_file:
        changelog = _read_text(Path(args.changelog_file)).strip()
    if changelog is None:
        raise ReleaseError("provide --changelog or --changelog-file")

    prepare_release_files(root=root, version=args.version, build=args.build, changelog=changelog)
    print(f"prepared release metadata for {args.version} (build {args.build})")
    print("updated files:")
    print("- mt4_ea/version.json")
    print("- mt4_ea/GoldBolt_Client.mq4")
    print("- mt5_ea/GoldBolt_Client.mq5")
    return 0


def resolve_notes_ref(root: Path, *, current_tag: str, requested_ref: str | None) -> str:
    if requested_ref:
        return requested_ref
    if current_tag in latest_semver_tags(root):
        return current_tag
    return "HEAD"


def cmd_notes(args: argparse.Namespace) -> int:
    root = repo_root_from(args.repo_root)
    repository = args.repository or git(["config", "--get", "remote.origin.url"], cwd=root)
    repository = re.sub(r"^.*github\.com[:/]", "", repository).removesuffix(".git")
    previous = args.previous_tag or previous_semver_tag(root, current_tag=args.current_tag)
    ref = resolve_notes_ref(root, current_tag=args.current_tag, requested_ref=args.ref)
    subjects = git_commit_subjects(root, previous_tag=previous, ref=ref)
    notes = build_release_notes(
        current_tag=args.current_tag,
        previous_tag=previous,
        commit_subjects=subjects,
        repository=repository,
    )
    print(notes, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="gold-bot release helper")
    parser.add_argument("--repo-root", default=None, help="repository root, defaults to script parent")
    subparsers = parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check", help="validate EA release metadata and git preflight")
    check.add_argument("--skip-git", action="store_true", help="skip branch/dirty checks")
    check.add_argument("--allow-dirty", action="store_true", help="allow dirty git tree")
    check.set_defaults(func=cmd_check)

    prepare = subparsers.add_parser("prepare", help="update EA version/build metadata for next release")
    prepare.add_argument("--version", required=True, help="EA version, e.g. 2.9.0")
    prepare.add_argument("--build", required=True, type=int, help="EA build number")
    prepare.add_argument("--changelog", help="single-line EA changelog summary")
    prepare.add_argument("--changelog-file", help="path to changelog text file")
    prepare.set_defaults(func=cmd_prepare)

    notes = subparsers.add_parser("notes", help="generate release notes draft from git history")
    notes.add_argument("--current-tag", required=True, help="target git tag, e.g. v1.6.3")
    notes.add_argument("--previous-tag", help="override previous tag")
    notes.add_argument(
        "--ref",
        default=None,
        help="git ref to diff against previous tag; defaults to current tag if it exists, otherwise HEAD",
    )
    notes.add_argument("--repository", help="owner/repo override for compare URL")
    notes.set_defaults(func=cmd_notes)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except ReleaseError as exc:
        print(f"release helper error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
