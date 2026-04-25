#!/usr/bin/env python3
"""Quick smoke test for instagrapi login + session persistence.

Usage:
  python agents/scripts/instagram_session_test.py \
    --username <instagram_username> \
    --password <instagram_password>
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from instagrapi import Client


def _require(value: str | None, flag_name: str) -> str:
    if value:
        return value
    raise ValueError(f"missing {flag_name}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Test instagrapi session persistence")
    parser.add_argument("--username", default=os.getenv("INSTAGRAM_USERNAME"))
    parser.add_argument("--password", default=os.getenv("INSTAGRAM_PASSWORD"))
    parser.add_argument(
        "--session-file",
        default=str(Path(".instagram-test-session.json")),
        help="Path for temporary session settings JSON",
    )
    args = parser.parse_args()

    try:
        username = _require(args.username, "--username or INSTAGRAM_USERNAME")
        password = _require(args.password, "--password or INSTAGRAM_PASSWORD")
    except ValueError as e:
        print(f"[error] {e}")
        return 2

    session_path = Path(args.session_file)
    session_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Logging in as @{username} ...")
    cl = Client()
    if not cl.login(username, password):
        print("[error] login() returned false")
        return 1

    print(f"[2/3] Saving session to {session_path} ...")
    cl.dump_settings(str(session_path))

    print("[3/3] Reloading session and validating account info ...")
    cl2 = Client()
    cl2.load_settings(str(session_path))
    if not cl2.login(username, password):
        print("[error] login() with loaded settings returned false")
        return 1

    account = cl2.account_info()
    print(f"[ok] Session reload works for @{account.username} (pk={account.pk})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
