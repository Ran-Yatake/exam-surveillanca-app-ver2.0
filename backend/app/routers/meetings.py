import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user_record
from ..chime_client import (
    _get_or_create_chime_meeting,
    active_meetings,
    get_chime_client,
)
from ..db import get_db
from ..models import ScheduledMeeting, User

router = APIRouter(tags=["meetings"])


class MeetingRequest(BaseModel):
    external_meeting_id: str
    region: str = "us-east-1"


class AttendeeRequest(BaseModel):
    external_user_id: str


class GuestJoinRequest(BaseModel):
    external_meeting_id: str
    external_user_id: str
    region: str = "us-east-1"


@router.post("/guest/join")
def guest_join_meeting(
    request: GuestJoinRequest,
    db: Session = Depends(get_db),
):
    client = get_chime_client()

    external_id = (request.external_meeting_id or "").strip()
    if not external_id:
        raise HTTPException(status_code=400, detail="external_meeting_id is required")

    external_user_id = (request.external_user_id or "").strip()
    if not external_user_id:
        raise HTTPException(status_code=400, detail="external_user_id is required")

    # Scheduled meeting: allow guest to join only after started.
    scheduled = db.query(ScheduledMeeting).filter(ScheduledMeeting.join_code == external_id).one_or_none()
    if scheduled is not None:
        if scheduled.status != "started" or not scheduled.chime_meeting_id:
            raise HTTPException(status_code=403, detail="Meeting not started")

        resp = _get_or_create_chime_meeting(
            external_meeting_id=scheduled.join_code,
            region=scheduled.region,
            existing_meeting_id=scheduled.chime_meeting_id,
        )
        meeting_obj = resp.get("Meeting") or {}
        meeting_id = meeting_obj.get("MeetingId")
        if not meeting_id:
            raise HTTPException(status_code=500, detail="Failed to load meeting")

        # Keep DB meeting id in sync (best-effort)
        if meeting_id != scheduled.chime_meeting_id:
            scheduled.chime_meeting_id = meeting_id
            db.add(scheduled)
            db.commit()

        try:
            attendee_resp = client.create_attendee(MeetingId=meeting_id, ExternalUserId=external_user_id)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        return {"Meeting": meeting_obj, "Attendee": attendee_resp.get("Attendee")}

    # Legacy unscheduled meeting: only join if it already exists in cache.
    cached = active_meetings.get(external_id)
    if cached is None:
        raise HTTPException(status_code=404, detail="Meeting not found")

    cached_meeting_id = (cached.get("Meeting") or {}).get("MeetingId")
    if not cached_meeting_id:
        active_meetings.pop(external_id, None)
        raise HTTPException(status_code=404, detail="Meeting not found")

    try:
        client.get_meeting(MeetingId=cached_meeting_id)
    except Exception:
        active_meetings.pop(external_id, None)
        raise HTTPException(status_code=404, detail="Meeting not found")

    try:
        attendee_resp = client.create_attendee(MeetingId=cached_meeting_id, ExternalUserId=external_user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"Meeting": cached.get("Meeting"), "Attendee": attendee_resp.get("Attendee")}


@router.post("/meetings")
def create_meeting(
    request: MeetingRequest,
    user: dict = Depends(get_current_user_record),
    db: Session = Depends(get_db),
):
    client = get_chime_client()

    external_id = (request.external_meeting_id or "").strip()
    if not external_id:
        raise HTTPException(status_code=400, detail="external_meeting_id is required")

    # If the meeting is scheduled, enforce lifecycle via DB.
    scheduled = db.query(ScheduledMeeting).filter(ScheduledMeeting.join_code == external_id).one_or_none()
    if scheduled is not None:
        # Proctor can start (or re-use) the meeting.
        if user.get("role") == "proctor":
            if scheduled.status == "ended":
                raise HTTPException(status_code=400, detail="Meeting already ended")

            resp = _get_or_create_chime_meeting(
                external_meeting_id=scheduled.join_code,
                region=scheduled.region,
                existing_meeting_id=scheduled.chime_meeting_id,
            )
            meeting_obj = resp.get("Meeting") or {}
            if meeting_obj.get("MeetingId"):
                scheduled.chime_meeting_id = meeting_obj.get("MeetingId")
            scheduled.status = "started"
            db.add(scheduled)
            db.commit()
            return resp

        # Examinee (or other users) can join only after started.
        if scheduled.status != "started" or not scheduled.chime_meeting_id:
            raise HTTPException(status_code=403, detail="Meeting not started")

        resp = _get_or_create_chime_meeting(
            external_meeting_id=scheduled.join_code,
            region=scheduled.region,
            existing_meeting_id=scheduled.chime_meeting_id,
        )
        meeting_obj = resp.get("Meeting") or {}
        if meeting_obj.get("MeetingId") and meeting_obj.get("MeetingId") != scheduled.chime_meeting_id:
            scheduled.chime_meeting_id = meeting_obj.get("MeetingId")
            db.add(scheduled)
            db.commit()
        return resp

    # Unscheduled (legacy) behavior: in-memory cache
    if external_id in active_meetings:
        cached = active_meetings[external_id]
        try:
            cached_meeting_id = cached.get("Meeting", {}).get("MeetingId")
            if cached_meeting_id:
                client.get_meeting(MeetingId=cached_meeting_id)
                return cached
        except Exception:
            active_meetings.pop(external_id, None)

    try:
        response = client.create_meeting(
            ClientRequestToken=str(uuid.uuid4()),
            MediaRegion=request.region,
            ExternalMeetingId=external_id,
        )
        active_meetings[external_id] = response
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/meetings/{meeting_id}/attendees")
def create_attendee(
    meeting_id: str,
    request: AttendeeRequest,
    user: dict = Depends(get_current_user_record),
):
    client = get_chime_client()

    try:
        response = client.create_attendee(MeetingId=meeting_id, ExternalUserId=request.external_user_id)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
