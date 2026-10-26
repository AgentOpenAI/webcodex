#!/usr/bin/env python3
"""本机独立 systemd 部署：先验证副本，切换时仅保留一个上一版回滚点。

显式运行 sudo python3 scripts/deploy_local_runtime.py --help。不会发布安装包、
创建 Environment 或重建 Runner 身份；仅管理本机已存在的三个服务。
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import tomllib
import urllib.request

NAMES = ("webcodex", "webcodex-server", "webcodex-runner")
SERVER_ENV = Path("/etc/webcodex/webcodex.env")
INSTALLED = Path("/usr/local/lib/webcodex")
BACKUPS = Path("/var/backups/webcodex")
DATA = Path("/var/lib/webcodex")
MARKER = ".webcodex-local-deployment"


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, stdin=subprocess.DEVNULL, **kwargs)


def env_file(path):
    values = {}
    for line in path.read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        parts = shlex.split(value)
        values[key.strip()] = parts[0] if parts else ""
    return values


def status(values):
    request = urllib.request.Request(
        "http://" + values["WEBCODEX_ADDR"] + "/api/runtime/status", data=b"{}",
        headers={"Authorization": "Bearer " + values["WEBCODEX_TOKEN"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)["output"]


def systemd(user, *args, runner=False):
    prefix = []
    if runner:
        uid = pwd.getpwnam(user).pw_uid
        prefix = ["runuser", "-u", user, "--", "env", f"XDG_RUNTIME_DIR=/run/user/{uid}",
                  f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus"]
    run(prefix + ["systemctl"] + (["--user"] if runner else []) + list(args), capture_output=True)


def services(user, action):
    if action == "stop":
        systemd(user, "stop", "webcodex-openai-tunnel.service")
        systemd(user, "stop", "webcodex-runner.service", runner=True)
        systemd(user, "stop", "webcodex.service", "webcodex.socket")
    else:
        systemd(user, "start", "webcodex.socket", "webcodex.service")
        systemd(user, "start", "webcodex-runner.service", runner=True)
        systemd(user, "start", "webcodex-openai-tunnel.service")


def build_info(directory):
    result = {}
    for name in NAMES:
        value = json.loads(run([str(directory / name), "--build-info-json"], capture_output=True, text=True).stdout)
        result[name] = value
    return result


def hash_file(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def healthy_candidate(observed, commit, client_id):
    return observed.get("build", {}).get("git_commit") == commit[:12] and any(
        client.get("client_id") == client_id
        and client.get("status") == "online"
        and client.get("build", {}).get("git_commit") == commit[:12]
        and client.get("build", {}).get("git_dirty") is False
        for client in observed.get("runners", {}).get("clients", [])
    )


def private_copy(source, destination):
    if source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    else:
        shutil.copy2(source, destination)


def live_data_copy(source, destination):
    private_copy(source, destination)
    # sqlite backup reads a consistent live database; a copied WAL is not a snapshot.
    for suffix in ("-wal", "-shm"):
        (destination / ("webcodex.db" + suffix)).unlink(missing_ok=True)
    (destination / "webcodex.db").unlink(missing_ok=True)
    with sqlite3.connect(f"file:{source / 'webcodex.db'}?mode=ro", uri=True) as src:
        with sqlite3.connect(destination / "webcodex.db") as dst:
            src.backup(dst)


def probe(binary, data, values, private):
    expected_sessions = len(json.loads((data / "sessions.json").read_text()).get("sessions", [])) if (data / "sessions.json").exists() else 0
    protected_tables = ("users", "api_keys", "account_credentials", "wc_projects", "wc_agent_identities",
                        "wc_conversation_messages", "wc_agent_tasks", "wc_goals", "project_memories")
    with sqlite3.connect(data / "webcodex.db") as connection:
        available = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        counts = {table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                  for table in protected_tables if table in available}
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    child_env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(private),
                 "WEBCODEX_ENV_FILE": str(private / "empty.env"), "RUST_LOG": "warn"}
    child_env.update(values)
    child_env.update(WEBCODEX_ADDR=f"127.0.0.1:{port}", WEBCODEX_DATA=str(data))
    (private / "empty.env").touch(mode=0o600)
    with (private / "migration.log").open("ab") as log:
        process = subprocess.Popen([str(binary)], env=child_env, cwd=private,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("候选服务启动失败；检查受保护的迁移日志")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("候选服务未在期限内就绪")
            observed = status(child_env)
            restored = observed.get("session_store", {}).get("restored_sessions")
            if restored != expected_sessions:
                raise RuntimeError("候选服务未恢复全部既有 Workflow Sessions")
            print(f"恢复既有 Workflow Sessions: {restored}", flush=True)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    raise RuntimeError("候选服务未正常关闭，拒绝部署")
        if process.returncode != 0:
            raise RuntimeError("候选服务关闭异常，拒绝部署")
    with sqlite3.connect(data / "webcodex.db") as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("迁移后数据库完整性检查失败")
        for table, count in counts.items():
            if connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] < count:
                raise RuntimeError("迁移丢失既有身份、项目或持久消息，拒绝部署")


def version_tuple(value):
    return tuple(int(part) for part in value.split("-")[0].split("."))


def migrate(data, values, candidate, bridge, previous_version, private):
    if version_tuple(previous_version) < (0, 4, 6):
        if not bridge:
            raise RuntimeError("0.4.6 之前的安装必须提供已验证的过渡版本")
        bridge_info = build_info(bridge)
        if any(value["version"] != "0.4.6" for value in bridge_info.values()):
            raise RuntimeError("过渡版本必须是 0.4.6")
        probe(bridge / "webcodex-server", data, values, private)
        print("0.4.6 过渡数据启动和数据库检查通过", flush=True)
    probe(candidate / "webcodex-server", data, values, private)
    print("候选源码数据启动和数据库检查通过", flush=True)


def configure(values, runner_config, workspace):
    # This is an explicit operator opt-in for the existing loopback Tunnel credential.
    if values["WEBCODEX_ADDR"] != "127.0.0.1:18080":
        raise RuntimeError("只允许已核对的本机回环地址")
    lines = SERVER_ENV.read_text().splitlines()
    key = "WEBCODEX_MCP_TRUST_LOOPBACK_API_TOKEN_FILE_IMPORT"
    lines = [line for line in lines if not line.startswith(key + "=")]
    # Explicit local operator deployment; the worker script is embedded in the binary.
    # No credentials or image file paths are passed to the child processor.
    preview = {
        "WEBCODEX_IMAGE_PREVIEW_NODE": "/home/ubuntu/.local/bin/node",
        "WEBCODEX_IMAGE_PREVIEW_SHARP_PACKAGE": "/home/ubuntu/tools/image-tools/package.json",
    }
    if not all(Path(value).is_file() for value in preview.values()):
        raise RuntimeError("本机 Sharp/Node 不可用，拒绝启用大图预览")
    lines = [line for line in lines if not any(line.startswith(name + "=") for name in preview)]
    SERVER_ENV.write_text("\n".join(lines) + f"\n{key}=true\n" + "".join(f"{name}={value}\n" for name,value in preview.items()))
    SERVER_ENV.chmod(0o600)
    config = tomllib.loads(runner_config.read_text())
    providers = config.get("mcp", {}).get("providers", [])
    if any(p.get("id") == "managed-browser" for p in providers):
        return
    runner_config.write_text(runner_config.read_text() + "\n[[mcp.providers]]\n"
                            'id = "managed-browser"\nname = "登录浏览器管理器"\n'
                            'executable = "/home/ubuntu/.local/bin/node"\n'
                            f'args = [{json.dumps(str(workspace / "scripts" / "managed_browser_gateway.cjs"), ensure_ascii=False)}]\n'
                            f'cwd = {json.dumps(str(workspace), ensure_ascii=False)}\n'
                            'env_from_env = { HOME = "HOME", PATH = "PATH" }\ntimeout_secs = 120\n')


def replace_binary(source, destination):
    temporary = destination.with_name(destination.name + ".candidate")
    shutil.copy2(source, temporary)
    temporary.chmod(0o755)
    temporary.replace(destination)


def restore(backup, user, data, runner_config):
    if not (backup / MARKER).is_file():
        raise RuntimeError("不是本工具生成的回滚点")
    services(user, "stop")
    for name in NAMES:
        replace_binary(backup / "bin" / name, INSTALLED / name)
    shutil.rmtree(data)
    private_copy(backup / "data", data)
    shutil.copy2(backup / "webcodex.env", SERVER_ENV)
    shutil.rmtree(runner_config.parent)
    private_copy(backup / "runner", runner_config.parent)
    account = pwd.getpwnam(user)
    for root, dirs, files in os.walk(runner_config.parent):
        for path in [Path(root)] + [Path(root) / name for name in dirs + files]:
            os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
    services(user, "start")
    print("已恢复唯一上一版程序、配置和数据", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["preflight", "apply", "rollback"])
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--bridge-dir", type=Path)
    parser.add_argument("--user", default="ubuntu")
    parser.add_argument("--runner-config", type=Path, default=Path("/home/ubuntu/.config/webcodex/http_127.0.0.1_18080/ubuntu/runner.toml"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("需要通过 sudo 读取服务配置并管理现有 systemd 服务")
    os.umask(0o077)
    values = env_file(SERVER_ENV)
    data = Path(values["WEBCODEX_DATA"]).resolve()
    if data != DATA or args.runner_config.is_symlink():
        raise RuntimeError("部署目标与已核对的本机安装不一致")
    backup = BACKUPS / "previous"
    if args.action == "rollback":
        restore(backup, args.user, data, args.runner_config)
        return
    candidate = args.candidate_dir.resolve()
    identity = build_info(candidate)
    if any(value["git_commit"] != args.expected_commit[:12] or value["git_dirty"] for value in identity.values()):
        raise RuntimeError("候选程序必须来自指定的干净提交")
    previous = build_info(INSTALLED)
    with tempfile.TemporaryDirectory(prefix="webcodex-migration-") as directory:
        private = Path(directory)
        live_data_copy(data, private / "data")
        migrate(private / "data", values, candidate, args.bridge_dir,
                previous["webcodex-server"]["version"], private)
    if args.action == "preflight":
        print("隔离副本预检完成；现有服务未停止", flush=True)
        return
    before = status(values)
    if before.get("jobs", {}).get("active_count") != 0:
        raise RuntimeError("仍有活动任务，拒绝切换")
    expected_client = tomllib.loads(args.runner_config.read_text())["client_id"]
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    if backup.exists() and not (backup / MARKER).is_file():
        raise RuntimeError("已有未知备份目录，拒绝删除")
    next_backup = BACKUPS / "previous.next"
    if next_backup.exists():
        raise RuntimeError("有未完成的备份事务，需要先核对")
    backup_ready = False
    try:
        services(args.user, "stop")
        next_backup.mkdir(mode=0o700)
        (next_backup / MARKER).touch(mode=0o600)
        private_copy(INSTALLED, next_backup / "bin")
        private_copy(data, next_backup / "data")
        private_copy(SERVER_ENV, next_backup / "webcodex.env")
        private_copy(args.runner_config.parent, next_backup / "runner")
        manifest = {"previous": previous, "candidate": identity,
                    "previous_hashes": {name: hash_file(INSTALLED / name) for name in NAMES},
                    "candidate_hashes": {name: hash_file(candidate / name) for name in NAMES}}
        (next_backup / "manifest.json").write_text(json.dumps(manifest, indent=2))
        if backup.exists():
            shutil.rmtree(backup)
        next_backup.replace(backup)
        backup_ready = True
        with tempfile.TemporaryDirectory(prefix="webcodex-migration-") as directory:
            migrate(data, values, candidate, args.bridge_dir,
                    previous["webcodex-server"]["version"], Path(directory))
        workspace = Path(__file__).resolve().parent.parent
        configure(values, args.runner_config, workspace)
        for name in NAMES:
            replace_binary(candidate / name, INSTALLED / name)
        services(args.user, "start")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                after = status(values)
                if healthy_candidate(after, args.expected_commit, expected_client):
                    for unit in ("webcodex.service", "webcodex-openai-tunnel.service"):
                        systemd(args.user, "is-active", unit)
                    systemd(args.user, "is-active", "webcodex-runner.service", runner=True)
                    print("源码切换成功；Server 和 Runner 在线，上一版仅保留一份", flush=True)
                    return
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(1)
        raise RuntimeError("切换后运行状态未在期限内恢复")
    except BaseException:
        if backup_ready:
            restore(backup, args.user, data, args.runner_config)
        else:
            services(args.user, "start")
        raise


if __name__ == "__main__":
    main()
