from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..auth import require_proctor
from ..db import get_db
from ..models import MeetingAttendanceSession


router = APIRouter(tags=["attendance"])


class AttendanceJoinRequest(BaseModel):
    join_code: str
    chime_meeting_id: Optional[str] = None
    attendee_id: str
    external_user_id: Optional[str] = None
    role: str = "examinee"


class AttendanceLeaveRequest(BaseModel):
    join_code: str
    attendee_id: str


@router.post("/attendance/join")
def attendance_join(request: AttendanceJoinRequest, db: Session = Depends(get_db)):
    join_code = (request.join_code or "").strip()
    attendee_id = (request.attendee_id or "").strip()
    if not join_code:
        raise HTTPException(status_code=400, detail="join_code is required")
    if not attendee_id:
        raise HTTPException(status_code=400, detail="attendee_id is required")

    # If an open session already exists for this attendee, keep it (idempotent).
    existing = (
        db.query(MeetingAttendanceSession)
        .filter(MeetingAttendanceSession.join_code == join_code)
        .filter(MeetingAttendanceSession.attendee_id == attendee_id)
        .filter(MeetingAttendanceSession.left_at.is_(None))
        .order_by(desc(MeetingAttendanceSession.joined_at))
        .one_or_none()
    )
    if existing is not None:
        return {
            "id": existing.id,
            "join_code": existing.join_code,
            "attendee_id": existing.attendee_id,
            "joined_at": existing.joined_at,
        }

    row = MeetingAttendanceSession(
        join_code=join_code,
        chime_meeting_id=(request.chime_meeting_id or "").strip() or None,
        attendee_id=attendee_id,
        external_user_id=(request.external_user_id or "").strip() or None,
        role=(request.role or "examinee").strip() or "examinee",
        joined_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "join_code": row.join_code, "attendee_id": row.attendee_id, "joined_at": row.joined_at}


@router.post("/attendance/leave")
def attendance_leave(request: AttendanceLeaveRequest, db: Session = Depends(get_db)):
    join_code = (request.join_code or "").strip()
    attendee_id = (request.attendee_id or "").strip()
    if not join_code:
        raise HTTPException(status_code=400, detail="join_code is required")
    if not attendee_id:
        raise HTTPException(status_code=400, detail="attendee_id is required")

    row = (
        db.query(MeetingAttendanceSession)
        .filter(MeetingAttendanceSession.join_code == join_code)
        .filter(MeetingAttendanceSession.attendee_id == attendee_id)
        .filter(MeetingAttendanceSession.left_at.is_(None))
        .order_by(desc(MeetingAttendanceSession.joined_at))
        .one_or_none()
    )
    if row is None:
        # Treat as idempotent: already closed or never recorded.
        return {"ok": True, "updated": False}

    now = datetime.utcnow()
    row.left_at = now
    try:
        row.duration_seconds = max(0, int((now - (row.joined_at or now)).total_seconds()))
    except Exception:
        row.duration_seconds = None

    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "updated": True,
        "id": row.id,
        "join_code": row.join_code,
        "attendee_id": row.attendee_id,
        "joined_at": row.joined_at,
        "left_at": row.left_at,
        "duration_seconds": row.duration_seconds,
    }


@router.get("/attendance/{join_code}")
def list_attendance_sessions(join_code: str, user=Depends(require_proctor), db: Session = Depends(get_db)):
    code = (join_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="join_code is required")

    rows = (
        db.query(MeetingAttendanceSession)
        .filter(MeetingAttendanceSession.join_code == code)
        .order_by(MeetingAttendanceSession.joined_at.asc())
        .all()
    )

    return [
        {
            "id": r.id,
            "join_code": r.join_code,
            "chime_meeting_id": r.chime_meeting_id,
            "attendee_id": r.attendee_id,
            "external_user_id": r.external_user_id,
            "role": r.role,
            "joined_at": r.joined_at,
            "left_at": r.left_at,
            "duration_seconds": r.duration_seconds,
        }
        for r in rows
    ]
