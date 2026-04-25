import base64
import io
import os
import re
import tempfile
from pathlib import Path


AGENT_META = {
    "id": "marketing",
    "name": "Marketing",
    "role": "Generates promo creatives and posts to Instagram",
    "icon": "megaphone",
}


# Match only explicit *commands* to post/create marketing content.
# Avoid matching ordinary buyer chatter that merely mentions "promo",
# "instagram", or "marketing" (e.g. "what's your IG handle?", "any promo?").
# A match requires an action verb (post/buat/create/etc.) paired with an
# Instagram/marketing target, or a clear "(ig|instagram) post" phrase.
_MARKETING_INTENT_RE = re.compile(
    r"\b("
    r"(?:post|posting|hantar|upload|share|publish)\s+"
    r"(?:\d+\s+\S+\s+)?(?:to\s+|ke\s+|on\s+|di\s+)?(?:ig|instagram)"
    r"|(?:ig|instagram)\s+post"
    r"|post\s+ig"
    r"|(?:buat|create|generate|jana|design|draft|make)\s+"
    r"(?:\d+\s+)?(?:ig\s+posts?|instagram\s+posts?|posters?|promo\s+posts?|marketing\s+posts?|iklan|campaign)"
    r"|marketing\s+(?:campaign|post)"
    r")\b",
    re.IGNORECASE,
)


def is_marketing_request(text: str) -> bool:
    return bool(_MARKETING_INTENT_RE.search(text or ""))


def _extract_count(text: str, default: int = 1) -> int:
    m = re.search(
        r"\b(\d{1,2})\s*(?:instagram|ig)?\s*(gambar|image|images|slides|poster|pictures)\b",
        text,
        re.IGNORECASE,
    )
    if not m:
        m = re.search(r"\bcount\s*[:=]?\s*(\d{1,2})\b", text, re.IGNORECASE)
    if not m:
        return default
    n = int(m.group(1))
    return max(1, min(n, 10))


def _generate_image_bytes(client, model: str, size: str, prompt: str) -> bytes:
    import httpx
    resp = client.images.generate(
        model=model,
        prompt=prompt,
        size=size,
    )
    item = resp.data[0]
    b64_json = getattr(item, "b64_json", None)
    if b64_json:
        return base64.b64decode(b64_json)
    url = getattr(item, "url", None)
    if url:
        with httpx.Client(timeout=120) as http:
            r = http.get(url)
            r.raise_for_status()
            return r.content
    raise RuntimeError("image response missing b64_json/url")


def _prepare_instagram_slide(image_bytes: bytes, idx: int) -> Path:
    from PIL import Image

    target_w, target_h = 1080, 1350  # 4:5 feed-safe
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    ratio = min(target_w / img.width, target_h / img.height)
    resized = img.resize((int(img.width * ratio), int(img.height * ratio)))
    canvas = Image.new("RGB", (target_w, target_h), color=(245, 246, 250))
    x = (target_w - resized.width) // 2
    y = (target_h - resized.height) // 2
    canvas.paste(resized, (x, y))
    fd, tmp_name = tempfile.mkstemp(prefix=f"ig-mkt-slide-{idx + 1}-", suffix=".jpg")
    os.close(fd)
    out = Path(tmp_name)
    canvas.save(out, format="JPEG", quality=95, optimize=True)
    return out


def run_marketing_post(*, business_id: str, user_message: str) -> dict:
    from openai import OpenAI
    from instagrapi import Client

    from app.db import SessionLocal, InstagramAuthSession

    openai_key = os.getenv("OPENAI_IMAGE_KEY")
    if not openai_key:
        raise RuntimeError("OPENAI_IMAGE_KEY not configured")

    count = _extract_count(user_message, default=1)
    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
    size = os.getenv("OPENAI_IMAGE_SIZE", "1024x1536")
    prompt = user_message.strip()
    caption = "Fresh milk promo only MYR 10"

    with SessionLocal() as s:
        ig_auth = (
            s.query(InstagramAuthSession)
            .filter(InstagramAuthSession.business_id == business_id)
            .first()
        )
    if not ig_auth:
        raise RuntimeError("Instagram is not connected for this business")

    client = Client()
    client.set_settings(ig_auth.session_settings)
    # Lightweight session validity check.
    client.get_timeline_feed()

    image_client = OpenAI(api_key=openai_key, base_url=os.getenv("OPENAI_IMAGE_API_BASE", "https://api.openai.com/v1"))

    files: list[Path] = []
    try:
        for idx in range(count):
            variant_prompt = (
                f"{prompt}\nVariation {idx + 1} of {count}. "
                "Keep product and important text inside center safe area with margins."
            )
            bytes_ = _generate_image_bytes(image_client, model, size, variant_prompt)
            files.append(_prepare_instagram_slide(bytes_, idx))

        if len(files) == 1:
            media = client.photo_upload(str(files[0]), caption)
            media_id = media.id
        else:
            media = client.album_upload([str(p) for p in files], caption)
            media_id = media.id

        return {
            "count": len(files),
            "media_id": media_id,
            "caption": caption,
        }
    finally:
        for p in files:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
