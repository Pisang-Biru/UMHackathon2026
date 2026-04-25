"""
SSE stream test.

TestClient (httpx ASGITransport) buffers the entire response body before
delivering it to iter_lines, so it cannot be used to test an infinite SSE
generator.  Instead we spin up a real uvicorn server in a background thread
and connect with a plain httpx streaming client.
"""
import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn

from app.main import app
from app import events as events_module


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Server(uvicorn.Server):
    """Uvicorn server that sets an event once it is ready."""

    def __init__(self, config: uvicorn.Config) -> None:
        super().__init__(config)
        self.ready = threading.Event()

    def install_signal_handlers(self) -> None:  # don't hijack SIGINT/SIGTERM
        pass

    async def startup(self, sockets=None) -> None:
        await super().startup(sockets=sockets)
        self.ready.set()


def test_sse_streams_published_frame():
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = _Server(config)

    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    # Wait for the server to be ready (max 5s)
    assert server.ready.wait(5), "uvicorn did not start in time"

    base_url = f"http://127.0.0.1:{port}"

    try:
        # Publish a frame 0.5 s after we open the SSE connection
        def publish_later() -> None:
            time.sleep(0.5)
            events_module.emit(
                agent_id="manager",
                kind="node.end",
                business_id="biz1",
                conversation_id="c-sse-test-1",
                summary="ok",
            )

        threading.Thread(target=publish_later, daemon=True).start()

        deadline = time.time() + 8
        with httpx.stream(
            "GET",
            f"{base_url}/agent/events/stream",
            params={"business_id": "biz1"},
            timeout=10,
        ) as r:
            assert r.status_code == 200
            for line in r.iter_lines():
                if line.startswith("data: "):
                    try:
                        payload = json.loads(line[len("data: "):])
                    except Exception:
                        continue
                    if payload.get("conversation_id") == "c-sse-test-1":
                        assert payload["agent_id"] == "manager"
                        # Success — stop reading
                        break
                if time.time() > deadline:
                    pytest.fail("no matching SSE frame received within 8 seconds")

    finally:
        server.should_exit = True
        t.join(timeout=5)

    # Cleanup DB row inserted by emit
    from app.db import SessionLocal, AgentEvent
    with SessionLocal() as s:
        s.query(AgentEvent).filter_by(conversation_id="c-sse-test-1").delete()
        s.commit()
