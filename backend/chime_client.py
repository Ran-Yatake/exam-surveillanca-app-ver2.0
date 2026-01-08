import os
import uuid

import boto3
from fastapi import HTTPException


# Initialize AWS Chime SDK client
# Ensure AWS credentials are set in environment variables or .env file
try:
    chime = boto3.client(
        "chime-sdk-meetings",
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
    )
except Exception as e:
    print(f"Warning: Failed to initialize AWS Chime SDK client: {e}")
    chime = None


# In-memory store for active meetings (MVP only)
active_meetings: dict[str, dict] = {}


def get_chime_client():
    if not chime:
        raise HTTPException(status_code=500, detail="AWS Chime SDK client not initialized")
    return chime


def _generate_join_code() -> str:
    # URL-safe, human-shareable
    return f"exam-{uuid.uuid4().hex[:10]}"


def _get_or_create_chime_meeting(*, external_meeting_id: str, region: str, existing_meeting_id: str | None = None):
    client = get_chime_client()

    if existing_meeting_id:
        try:
            return client.get_meeting(MeetingId=existing_meeting_id)
        except Exception:
            # expired / not found -> recreate
            pass

    return client.create_meeting(
        ClientRequestToken=str(uuid.uuid4()),
        MediaRegion=region,
        ExternalMeetingId=external_meeting_id,
    )


# Backwards-compatible aliases for new code
generate_join_code = _generate_join_code
get_or_create_chime_meeting = _get_or_create_chime_meeting
