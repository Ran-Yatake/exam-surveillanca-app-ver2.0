from datetime import datetime
import os
import re
import uuid
from typing import Optional

import boto3
from botocore.config import Config
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


class ScheduledMeetingUpdateRequest(BaseModel):
    title: Optional[str] = None
    teacher_name: Optional[str] = None
    scheduled_start_at: Optional[datetime] = None
    scheduled_end_at: Optional[datetime] = None


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


class PresignRecordingUploadRequest(BaseModel):
    file_name: Optional[str] = None
    # Keep this stable to avoid signature mismatch in browsers.
    content_type: Optional[str] = "video/webm"


class PresignRecordingUploadResponse(BaseModel):
    bucket: str
    key: str
    url: str
    expires_in: int


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    value = _SAFE_FILENAME_RE.sub("_", (name or "").strip())
    value = value.strip("._")
    return value[:120] or "recording.webm"


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


@router.patch("/scheduled-meetings/{join_code}", response_model=ScheduledMeetingResponse)
def update_scheduled_meeting(
    join_code: str,
    request: ScheduledMeetingUpdateRequest,
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

    fields_set = getattr(request, "__fields_set__", None)
    if fields_set is None:
        fields_set = getattr(request, "model_fields_set", set())

    # Update only provided fields. Empty strings are treated as null.
    if "title" in fields_set:
        row.title = (request.title or "").strip() or None
    if "teacher_name" in fields_set:
        row.teacher_name = (request.teacher_name or "").strip() or None
    if "scheduled_start_at" in fields_set:
        row.scheduled_start_at = request.scheduled_start_at
    if "scheduled_end_at" in fields_set:
        row.scheduled_end_at = request.scheduled_end_at

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


@router.post(
    "/scheduled-meetings/{join_code}/recordings/presign",
    response_model=PresignRecordingUploadResponse,
)
def presign_proctor_recording_upload(
    join_code: str,
    request: PresignRecordingUploadRequest,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    row = db.query(ScheduledMeeting).filter(ScheduledMeeting.join_code == join_code).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled meeting not found")
    if row.created_by_user_id != user["user"].id:
        raise HTTPException(status_code=403, detail="Not allowed")

    bucket = (os.getenv("RECORDINGS_S3_BUCKET") or "").strip()
    if not bucket:
        raise HTTPException(status_code=500, detail="RECORDINGS_S3_BUCKET is not configured")

    content_type = (request.content_type or "video/webm").strip() or "video/webm"
    safe_name = _safe_filename(request.file_name or "")
    key = f"proctor-recordings/{join_code}/{uuid.uuid4().hex}-{safe_name}"

    s3 = boto3.client(
        "s3",
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
        config=Config(signature_version="s3v4"),
    )
    expires_in = 15 * 60
    try:
        url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to presign upload url: {e}")

    return PresignRecordingUploadResponse(
        bucket=bucket,
        key=key,
        url=url,
        expires_in=expires_in,
    )
