from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import require_proctor
from ..db import get_db
from ..models import MeetingChatLog


router = APIRouter(tags=["chat-logs"])


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        # Support common UTC formats.
        s = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        # Store as naive UTC for MySQL DateTime consistency.
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


class ChatLogCreateRequest(BaseModel):
    join_code: str
    message_id: str
    ts: Optional[str] = None

    type: Optional[str] = None
    fromRole: Optional[str] = None
    fromAttendeeId: Optional[str] = None
    toRole: Optional[str] = None
    toAttendeeId: Optional[str] = None

    text: str


@router.post("/chat-logs")
def create_chat_log(request: ChatLogCreateRequest, db: Session = Depends(get_db)):
    join_code = (request.join_code or "").strip()
    message_id = (request.message_id or "").strip()
    text = (request.text or "").strip()

    if not join_code:
        raise HTTPException(status_code=400, detail="join_code is required")
    if not message_id:
        raise HTTPException(status_code=400, detail="message_id is required")
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="text is too long")

    sent_at = _parse_iso_datetime(request.ts)

    row = MeetingChatLog(
        join_code=join_code,
        message_id=message_id,
        msg_type=(request.type or "").strip() or None,
        from_role=(request.fromRole or "").strip() or None,
        from_attendee_id=(request.fromAttendeeId or "").strip() or None,
        to_role=(request.toRole or "").strip() or None,
        to_attendee_id=(request.toAttendeeId or "").strip() or None,
        text=text,
        sent_at=sent_at,
    )

    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        # Idempotent on (join_code, message_id)
        db.rollback()
        existing = (
            db.query(MeetingChatLog)
            .filter(MeetingChatLog.join_code == join_code)
            .filter(MeetingChatLog.message_id == message_id)
            .one_or_none()
        )
        if existing is None:
            raise
        row = existing

    return {
        "id": row.id,
        "join_code": row.join_code,
        "message_id": row.message_id,
        "ts": row.sent_at,
        "type": row.msg_type,
        "from_role": row.from_role,
        "from_attendee_id": row.from_attendee_id,
        "to_role": row.to_role,
        "to_attendee_id": row.to_attendee_id,
        "text": row.text,
        "created_at": row.created_at,
    }


@router.get("/chat-logs/{join_code}")
def list_chat_logs(
    join_code: str,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    code = (join_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="join_code is required")

    rows = (
        db.query(MeetingChatLog)
        .filter(MeetingChatLog.join_code == code)
        .order_by(
            MeetingChatLog.sent_at.is_(None).asc(),
            MeetingChatLog.sent_at.asc(),
            MeetingChatLog.created_at.asc(),
            MeetingChatLog.id.asc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )

    return [
        {
            "id": r.id,
            "join_code": r.join_code,
            "message_id": r.message_id,
            "ts": r.sent_at,
            "type": r.msg_type,
            "from_role": r.from_role,
            "from_attendee_id": r.from_attendee_id,
            "to_role": r.to_role,
            "to_attendee_id": r.to_attendee_id,
            "text": r.text,
            "created_at": r.created_at,
        }
        for r in rows
    ]
