from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_record, require_proctor
from chime_client import _generate_join_code, _get_or_create_chime_meeting
from db import get_db
from models import ScheduledMeeting

router = APIRouter(tags=["scheduled-meetings"])


class ScheduledMeetingCreateRequest(BaseModel):
    title: Optional[str] = None
    teacher_name: Optional[str] = None
    scheduled_start_at: Optional[datetime] = None
    scheduled_end_at: Optional[datetime] = None
    region: str = "us-east-1"


class ScheduledMeetingResponse(BaseModel):
    join_code: str
    title: Optional[str] = None
    teacher_name: Optional[str] = None
    scheduled_start_at: Optional[datetime] = None
    scheduled_end_at: Optional[datetime] = None
    region: str
    status: str


class ScheduledMeetingStartResponse(BaseModel):
    join_code: str
    meeting: dict


@router.post("/scheduled-meetings", response_model=ScheduledMeetingResponse)
def create_scheduled_meeting(
    request: ScheduledMeetingCreateRequest,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    join_code = _generate_join_code()
    title = (request.title or "").strip() or None
    teacher_name = (request.teacher_name or "").strip() or None
    if teacher_name is None:
        teacher_name = getattr(user["user"], "user_name", None) or user["user"].email

    row = ScheduledMeeting(
        join_code=join_code,
        title=title,
        teacher_name=teacher_name,
        created_by_user_id=user["user"].id,
        scheduled_start_at=request.scheduled_start_at,
        scheduled_end_at=request.scheduled_end_at,
        region=request.region or "us-east-1",
        status="scheduled",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return ScheduledMeetingResponse(
        join_code=row.join_code,
        title=row.title,
        teacher_name=row.teacher_name,
        scheduled_start_at=row.scheduled_start_at,
        scheduled_end_at=row.scheduled_end_at,
        region=row.region,
        status=row.status,
    )


@router.get("/scheduled-meetings", response_model=list[ScheduledMeetingResponse])
def list_scheduled_meetings(
    user=Depends(get_current_user_record),
    db: Session = Depends(get_db),
):
    # MVP: proctor can list their own scheduled meetings. examinee gets empty.
    if user.get("role") != "proctor":
        return []

    rows = (
        db.query(ScheduledMeeting)
        .filter(ScheduledMeeting.created_by_user_id == user["user"].id)
        .order_by(ScheduledMeeting.created_at.desc())
        .all()
    )
    return [
        ScheduledMeetingResponse(
            join_code=r.join_code,
            title=r.title,
            teacher_name=getattr(r, "teacher_name", None),
            scheduled_start_at=r.scheduled_start_at,
            scheduled_end_at=r.scheduled_end_at,
            region=r.region,
            status=r.status,
        )
        for r in rows
    ]


@router.post("/scheduled-meetings/{join_code}/start", response_model=ScheduledMeetingStartResponse)
def start_scheduled_meeting(
    join_code: str,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    row = db.query(ScheduledMeeting).filter(ScheduledMeeting.join_code == join_code).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled meeting not found")
    if row.created_by_user_id != user["user"].id:
        raise HTTPException(status_code=403, detail="Not allowed")
    if row.status == "ended":
        raise HTTPException(status_code=400, detail="Meeting already ended")

    resp = _get_or_create_chime_meeting(
        external_meeting_id=row.join_code,
        region=row.region,
        existing_meeting_id=row.chime_meeting_id,
    )

    meeting_obj = resp.get("Meeting") or {}
    if meeting_obj.get("MeetingId"):
        row.chime_meeting_id = meeting_obj.get("MeetingId")
    row.status = "started"
    db.add(row)
    db.commit()

    return ScheduledMeetingStartResponse(join_code=row.join_code, meeting=resp)


@router.delete("/scheduled-meetings/{join_code}")
def delete_scheduled_meeting(
    join_code: str,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    row = db.query(ScheduledMeeting).filter(ScheduledMeeting.join_code == join_code).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled meeting not found")
    if row.created_by_user_id != user["user"].id:
        raise HTTPException(status_code=403, detail="Not allowed")

    db.delete(row)
    db.commit()
    return {"ok": True}
