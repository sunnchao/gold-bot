import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "release.py"

spec = importlib.util.spec_from_file_location("release_tool", SCRIPT_PATH)
release_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_tool)


class ReleaseToolTests(unittest.TestCase):
    def _write_fixture_repo(self, root: Path, *, version="2.8.1", build=7, mq4_version=None, mq4_build=None, mq5_version=None, mq5_build=None):
        (root / "mt4_ea").mkdir(parents=True, exist_ok=True)
        (root / "mt5_ea").mkdir(parents=True, exist_ok=True)

        (root / "mt4_ea" / "version.json").write_text(
            json.dumps(
                {
                    "version": version,
                    "build": build,
                    "changelog": "fixture changelog",
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        mq4_text = f'''#property version   "{version.rsplit('.', 1)[0]}"
#define EA_VERSION  "{mq4_version or version}"
#define EA_BUILD    {mq4_build if mq4_build is not None else build}
'''
        mq5_text = f'''#property version   "{version.rsplit('.', 1)[0]}"
#define EA_VERSION  "{mq5_version or version}"
#define EA_BUILD    {mq5_build if mq5_build is not None else build}
'''

        (root / "mt4_ea" / "GoldBolt_Client.mq4").write_text(mq4_text, encoding="utf-8")
        (root / "mt5_ea" / "GoldBolt_Client.mq5").write_text(mq5_text, encoding="utf-8")

    def test_validate_release_tree_reports_metadata_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root, mq4_build=9)

            errors = release_tool.validate_release_tree(root)

            self.assertTrue(errors)
            self.assertTrue(any("mq4" in err.lower() and "build" in err.lower() for err in errors))

    def test_validate_release_tree_rejects_invalid_json_field_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root)
            version_path = root / "mt4_ea" / "version.json"
            version_path.write_text(
                json.dumps(
                    {
                        "version": "2.8.1",
                        "build": True,
                        "changelog": ["bad type"],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            errors = release_tool.validate_release_tree(root)

            self.assertTrue(any("build must be positive integer" in err for err in errors))
            self.assertTrue(any("changelog must be non-empty string" in err for err in errors))

    def test_validate_release_tree_rejects_duplicate_ea_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root)
            mq4_path = root / "mt4_ea" / "GoldBolt_Client.mq4"
            mq4_path.write_text(
                mq4_path.read_text(encoding="utf-8") + '#define EA_VERSION  "9.9.9"\n',
                encoding="utf-8",
            )

            errors = release_tool.validate_release_tree(root)

            self.assertTrue(any("expected exactly one" in err for err in errors))

    def test_prepare_release_files_updates_version_build_and_changelog(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root)

            release_tool.prepare_release_files(
                root=root,
                version="2.9.0",
                build=8,
                changelog="新增统一发布检查脚本",
            )

            version_json = json.loads((root / "mt4_ea" / "version.json").read_text(encoding="utf-8"))
            mq4_text = (root / "mt4_ea" / "GoldBolt_Client.mq4").read_text(encoding="utf-8")
            mq5_text = (root / "mt5_ea" / "GoldBolt_Client.mq5").read_text(encoding="utf-8")

            self.assertEqual(version_json["version"], "2.9.0")
            self.assertEqual(version_json["build"], 8)
            self.assertEqual(version_json["changelog"], "新增统一发布检查脚本")
            self.assertIn('#define EA_VERSION  "2.9.0"', mq4_text)
            self.assertIn('#define EA_BUILD    8', mq4_text)
            self.assertIn('#property version   "2.9"', mq4_text)
            self.assertIn('#define EA_VERSION  "2.9.0"', mq5_text)
            self.assertIn('#define EA_BUILD    8', mq5_text)
            self.assertIn('#property version   "2.9"', mq5_text)

    def test_prepare_release_files_rolls_back_on_write_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root)

            version_path = root / "mt4_ea" / "version.json"
            mq4_path = root / "mt4_ea" / "GoldBolt_Client.mq4"
            mq5_path = root / "mt5_ea" / "GoldBolt_Client.mq5"
            originals = {
                version_path: version_path.read_text(encoding="utf-8"),
                mq4_path: mq4_path.read_text(encoding="utf-8"),
                mq5_path: mq5_path.read_text(encoding="utf-8"),
            }
            original_write_text = release_tool._write_text

            def flaky_write(path: Path, content: str) -> None:
                if path == mq5_path and '2.9.0' in content:
                    raise release_tool.ReleaseError("simulated mq5 write failure")
                original_write_text(path, content)

            with mock.patch.object(release_tool, "_write_text", side_effect=flaky_write):
                with self.assertRaises(release_tool.ReleaseError):
                    release_tool.prepare_release_files(
                        root=root,
                        version="2.9.0",
                        build=8,
                        changelog="新增统一发布检查脚本",
                    )

            self.assertEqual(version_path.read_text(encoding="utf-8"), originals[version_path])
            self.assertEqual(mq4_path.read_text(encoding="utf-8"), originals[mq4_path])
            self.assertEqual(mq5_path.read_text(encoding="utf-8"), originals[mq5_path])

    def test_cmd_prepare_reports_missing_changelog_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_fixture_repo(root)

            args = release_tool.build_parser().parse_args(
                [
                    "--repo-root",
                    str(root),
                    "prepare",
                    "--version",
                    "2.9.0",
                    "--build",
                    "8",
                    "--changelog-file",
                    str(root / "missing-changelog.txt"),
                ]
            )

            with self.assertRaises(release_tool.ReleaseError) as ctx:
                release_tool.cmd_prepare(args)

            self.assertIn("failed to read", str(ctx.exception))
            self.assertIn("missing-changelog.txt", str(ctx.exception))

    def test_previous_semver_tag_returns_next_older_existing_tag(self):
        with mock.patch.object(
            release_tool,
            "latest_semver_tags",
            return_value=["v1.6.2", "v1.6.1", "v1.6.0"],
        ):
            previous = release_tool.previous_semver_tag(Path('.'), current_tag="v1.6.1")

        self.assertEqual(previous, "v1.6.0")

    def test_previous_semver_tag_falls_back_to_latest_when_current_tag_missing(self):
        with mock.patch.object(
            release_tool,
            "latest_semver_tags",
            return_value=["v1.6.2", "v1.6.1", "v1.6.0"],
        ):
            previous = release_tool.previous_semver_tag(Path('.'), current_tag="v9.9.9")

        self.assertEqual(previous, "v1.6.2")

    def test_resolve_notes_ref_uses_existing_current_tag_by_default(self):
        with mock.patch.object(
            release_tool,
            "latest_semver_tags",
            return_value=["v1.6.2", "v1.6.1", "v1.6.0"],
        ):
            ref = release_tool.resolve_notes_ref(Path('.'), current_tag="v1.6.1", requested_ref=None)

        self.assertEqual(ref, "v1.6.1")

    def test_resolve_notes_ref_falls_back_to_head_for_new_tag(self):
        with mock.patch.object(
            release_tool,
            "latest_semver_tags",
            return_value=["v1.6.2", "v1.6.1", "v1.6.0"],
        ):
            ref = release_tool.resolve_notes_ref(Path('.'), current_tag="v1.6.3", requested_ref=None)

        self.assertEqual(ref, "HEAD")

    def test_build_release_notes_groups_conventional_commits(self):
        notes = release_tool.build_release_notes(
            current_tag="v1.6.3",
            previous_tag="v1.6.2",
            commit_subjects=[
                "feat: add unified release check",
                "fix: sync EA metadata before tag",
                "docs: add release runbook",
            ],
            repository="sunnchao/gold-bot",
        )

        self.assertIn("# v1.6.3", notes)
        self.assertIn("## 功能变更", notes)
        self.assertIn("- feat: add unified release check", notes)
        self.assertIn("## 缺陷修复", notes)
        self.assertIn("- fix: sync EA metadata before tag", notes)
        self.assertIn("## 其他变更", notes)
        self.assertIn("- docs: add release runbook", notes)
        self.assertIn("compare/v1.6.2...v1.6.3", notes)


if __name__ == "__main__":
    unittest.main()
