"""仅临时文件与模拟服务；验证单备份轮换及失败回滚，不操作宿主服务。"""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("local_deploy", Path(__file__).parents[1] / "deploy_local_runtime.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def execute(self, fail_migration=False, fail_backup=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "data"; data.mkdir()
            with sqlite3.connect(data / "webcodex.db") as db:
                db.execute("CREATE TABLE preserved(value)"); db.execute("INSERT INTO preserved VALUES ('original')")
            env = root / "webcodex.env"; env.write_text(f"WEBCODEX_DATA={data}\nWEBCODEX_ADDR=127.0.0.1:18080\nWEBCODEX_TOKEN=fixture\n")
            runner = root / "runner" / "runner.toml"; runner.parent.mkdir(); runner.write_text("client_id='unchanged'\n")
            binaries = root / "bin"; binaries.mkdir()
            candidate = root / "candidate"; candidate.mkdir()
            for name in deploy.NAMES:
                (binaries / name).write_bytes(b"old"); (candidate / name).write_bytes(b"new")
            backups = root / "backups"; previous = backups / "previous"; previous.mkdir(parents=True)
            (previous / deploy.MARKER).touch(); (previous / "obsolete").write_text("older backup")
            old = {name: {"version":"0.5.0", "git_commit":"old", "git_dirty":False} for name in deploy.NAMES}
            new = {name: {"version":"0.5.0", "git_commit":"a"*12, "git_dirty":False} for name in deploy.NAMES}
            calls = []
            def migration(*args):
                calls.append(args)
                if fail_migration and len(calls) == 2:
                    (data / "post-migration").write_text("partial")
                    raise RuntimeError("fixture migration failed")
            copy = deploy.private_copy
            def copying(source, destination):
                if fail_backup and source == binaries:
                    raise RuntimeError("fixture snapshot failed")
                copy(source, destination)
            argv = ["deploy", "apply", "--candidate-dir", str(candidate), "--expected-commit", "a"*40, "--runner-config", str(runner)]
            with patch.multiple(deploy, SERVER_ENV=env, DATA=data, INSTALLED=binaries, BACKUPS=backups), \
                 patch("sys.argv", argv), patch.object(deploy.os,"geteuid",return_value=0), \
                 patch.object(deploy,"build_info",side_effect=lambda p: new if p==candidate else old), \
                 patch.object(deploy,"services") as services, patch.object(deploy,"systemd"), \
                 patch.object(deploy,"configure"), patch.object(deploy,"migrate",side_effect=migration), \
                 patch.object(deploy,"private_copy",side_effect=copying), \
                 patch.object(deploy,"status",return_value={"jobs":{"active_count":0},"build":{"git_commit":"a"*12},"runners":{"clients":[{"client_id":"unchanged","status":"online","build":{"git_commit":"a"*12,"git_dirty":False}}]}}):
                if fail_migration or fail_backup:
                    with self.assertRaisesRegex(RuntimeError,"fixture"):
                        deploy.main()
                    self.assertEqual((binaries/"webcodex-server").read_bytes(),b"old")
                    self.assertFalse((data/"post-migration").exists())
                    if fail_backup:
                        self.assertTrue((previous/"obsolete").exists(),"An incomplete new backup must not replace the previous rollback point")
                else:
                    deploy.main()
                    self.assertEqual((binaries/"webcodex-server").read_bytes(),b"new")
                    self.assertEqual(list(backups.iterdir()),[previous])
                    self.assertFalse((previous/"obsolete").exists())
                    self.assertEqual((previous/"bin"/"webcodex-server").read_bytes(),b"old")
                    self.assertIn("candidate_hashes",json.loads((previous/"manifest.json").read_text()))
                self.assertTrue(services.called)

    def test_one_previous_backup_replaces_only_the_older_backup(self):
        self.execute()

    def test_failed_migration_restores_current_program_and_data(self):
        self.execute(fail_migration=True)

    def test_failed_backup_does_not_restore_a_stale_previous_deployment(self):
        self.execute(fail_backup=True)

    def test_health_requires_the_exact_runner_and_matching_clean_build(self):
        # /api/runtime/status uses runtime_status_client_summary's nested build;
        # the separate health/alignment projection has flattened build fields.
        status={"build":{"git_commit":"a"*12},"runners":{"clients":[{"client_id":"expected","status":"online","build":{"git_commit":"a"*12,"git_dirty":False}}]}}
        self.assertTrue(deploy.healthy_candidate(status,"a"*40,"expected"))
        self.assertFalse(deploy.healthy_candidate(status,"a"*40,"another"))
        self.assertFalse(deploy.healthy_candidate(status,"b"*40,"expected"))
        status["runners"]["clients"][0]["build"]["git_dirty"]=True
        self.assertFalse(deploy.healthy_candidate(status,"a"*40,"expected"))


if __name__ == "__main__":
    unittest.main()
