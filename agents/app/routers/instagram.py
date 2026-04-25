import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from instagrapi import Client

from app.db import InstagramAuthSession, SessionLocal


router = APIRouter(prefix="/integrations/instagram", tags=["instagram"])
_log = logging.getLogger(__name__)


class InstagramLoginRequest(BaseModel):
    business_id: str = Field(min_length=1)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class InstagramBusinessRequest(BaseModel):
    business_id: str = Field(min_length=1)


class InstagramStatusResponse(BaseModel):
    connected: bool
    username: str | None = None
    last_login_at: str | None = None


def _extract_settings(client: Client) -> dict:
    if hasattr(client, "get_settings"):
        settings = client.get_settings()
        if isinstance(settings, dict):
            return settings

    # Fallback for compatibility with older/newer client APIs.
    with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        client.dump_settings(tmp_path)
        with open(tmp_path, "r", encoding="utf-8") as f:
            return json.load(f)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


@router.get("/status", response_model=InstagramStatusResponse)
def instagram_status(business_id: str):
    with SessionLocal() as session:
        row = (
            session.query(InstagramAuthSession)
            .filter(InstagramAuthSession.business_id == business_id)
            .first()
        )
        if not row or not row.is_active:
            return InstagramStatusResponse(connected=False)
        return InstagramStatusResponse(
            connected=True,
            username=row.instagram_username,
            last_login_at=row.last_login_at.isoformat() if row.last_login_at else None,
        )


@router.post("/login", response_model=InstagramStatusResponse)
def instagram_login(req: InstagramLoginRequest):
    client = Client()
    try:
        login_ok = client.login(req.username, req.password)
        if not login_ok:
            raise HTTPException(status_code=401, detail="Instagram login failed")
        settings = _extract_settings(client)
    except HTTPException:
        raise
    except Exception as e:
        _log.exception("instagram login failed for business_id=%s", req.business_id)
        raise HTTPException(status_code=400, detail=f"Instagram login failed: {e}")

    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        row = (
            session.query(InstagramAuthSession)
            .filter(InstagramAuthSession.business_id == req.business_id)
            .first()
        )
        if row is None:
            row = InstagramAuthSession(
                business_id=req.business_id,
                instagram_username=req.username,
                session_settings=settings,
                is_active=True,
                last_login_at=now,
            )
            session.add(row)
        else:
            row.instagram_username = req.username
            row.session_settings = settings
            row.is_active = True
            row.last_login_at = now
            row.updated_at = now
        session.commit()

    return InstagramStatusResponse(
        connected=True,
        username=req.username,
        last_login_at=now.isoformat(),
    )


@router.post("/logout", response_model=InstagramStatusResponse)
def instagram_logout(req: InstagramBusinessRequest):
    with SessionLocal() as session:
        row = (
            session.query(InstagramAuthSession)
            .filter(InstagramAuthSession.business_id == req.business_id)
            .first()
        )
        if row:
            session.delete(row)
            session.commit()
    return InstagramStatusResponse(connected=False)
