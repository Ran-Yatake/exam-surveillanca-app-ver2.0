import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_record
from chime_client import _get_or_create_chime_meeting, active_meetings, get_chime_client
from db import get_db
from models import ScheduledMeeting

router = APIRouter(tags=["meetings"])


class MeetingRequest(BaseModel):
    external_meeting_id: str
    region: str = "us-east-1"


class AttendeeRequest(BaseModel):
    external_user_id: str


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
        # Creator proctor can start (or re-use) the meeting.
        if user.get("role") == "proctor" and scheduled.created_by_user_id == user["user"].id:
            if scheduled.status != "ended":
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

            raise HTTPException(status_code=400, detail="Meeting already ended")

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
