#!/usr/bin/env python3
"""Smoke test marketing flow through Manager via /agent/support/chat.

This verifies:
1) request enters manager path,
2) manager routes to marketing specialist,
3) response returns sent/auto-send with media_id text,
4) an AgentAction row is persisted.
"""

from __future__ import annotations

import argparse
import os
import sys

import requests

from app.db import SessionLocal, AgentAction


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test manager->marketing flow")
    parser.add_argument("--api-base", default=os.getenv("AGENTS_API_URL", "http://localhost:8000"))
    parser.add_argument("--business-id", required=True)
    parser.add_argument("--customer-id", default="marketing-smoke-user")
    parser.add_argument("--customer-phone", default="+60123456789")
    parser.add_argument(
        "--message",
        default="please create 3 instagram slides for fresh milk promo MYR 10 and post it",
    )
    args = parser.parse_args()

    payload = {
        "business_id": args.business_id,
        "customer_id": args.customer_id,
        "customer_phone": args.customer_phone,
        "message": args.message,
    }
    print("[1/3] POST /agent/support/chat ...")
    r = requests.post(f"{args.api_base}/agent/support/chat", json=payload, timeout=600)
    print(f"status_code={r.status_code}")
    if r.status_code != 200:
        print(r.text)
        return 1
    data = r.json()
    print(data)

    print("[2/3] Validating manager response ...")
    if data.get("status") not in {"sent", "auto_send", "pending_approval"}:
        print("[error] expected status sent/auto_send/pending_approval")
        return 1

    print("[3/3] Checking action row persisted ...")
    action_id = data.get("action_id")
    if not action_id:
        print("[error] action_id missing in response")
        return 1
    with SessionLocal() as s:
        row = s.query(AgentAction).filter(AgentAction.id == action_id).first()
        if not row:
            print(f"[error] action {action_id} not found in DB")
            return 1
        if not row.iterations:
            print("[error] action iterations missing")
            return 1
        if row.iterations[0].get("stage") != "marketing_v1":
            print(f"[error] expected first stage marketing_v1, got {row.iterations[0].get('stage')}")
            return 1

        if data.get("status") in {"sent", "auto_send"}:
            reply = (data.get("reply") or "").lower()
            if "media_id=" not in reply:
                print("[error] expected media_id in sent reply")
                return 1
            print(f"[ok] action stored: id={row.id} status={row.status.value} (posted)")
        else:
            print(f"[ok] action stored: id={row.id} status={row.status.value} (pending due to IG checkpoint/challenge)")

    print("[ok] manager marketing smoke test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
