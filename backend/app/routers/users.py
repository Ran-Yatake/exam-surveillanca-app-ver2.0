from typing import Literal, Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import COGNITO_REGION, COGNITO_USER_POOL_ID, require_proctor
from ..db import get_db
from ..models import ScheduledMeeting, User

router = APIRouter(tags=["users"])


class InviteUserRequest(BaseModel):
    email: str
    role: Literal["proctor", "examinee"]


class UpdateUserRequest(BaseModel):
    role: Optional[Literal["proctor", "examinee"]] = None
    class_name: Optional[str] = None


def _normalize_email(value: str) -> str:
    s = (value or "").strip().lower()
    if not s or "@" not in s or "." not in s:
        raise HTTPException(status_code=400, detail="email is invalid")
    if len(s) > 255:
        raise HTTPException(status_code=400, detail="email is too long")
    return s


@router.get("/users")
def list_users(
    _user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.id.asc()).all()
    result = []
    for u in users:
        result.append(
            {
                "id": u.id,
                "username": u.email,
                "role": u.role,
                "display_name": u.user_name,
                "class_name": u.class_name,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "updated_at": u.updated_at.isoformat() if u.updated_at else None,
            }
        )
    return result


@router.post("/users")
def invite_user(
    request: InviteUserRequest,
    _user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    if not COGNITO_USER_POOL_ID:
        raise HTTPException(status_code=500, detail="COGNITO_USER_POOL_ID is not configured")

    email = _normalize_email(request.email)
    role = request.role

    client = boto3.client("cognito-idp", region_name=COGNITO_REGION)

    try:
        client.admin_create_user(
            UserPoolId=COGNITO_USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
    except ClientError as e:
        code = (e.response or {}).get("Error", {}).get("Code")
        if code == "UsernameExistsException":
            raise HTTPException(status_code=409, detail="User already exists")
        raise HTTPException(status_code=500, detail=f"Cognito error: {code or 'unknown'}")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to create Cognito user")

    record = db.query(User).filter(User.email == email).one_or_none()
    if record is None:
        record = User(email=email, role=role)
    else:
        record.role = role

    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "ok": True,
        "username": record.email,
        "role": record.role,
    }


@router.delete("/users/{email}")
def delete_user(
    email: str,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    if not COGNITO_USER_POOL_ID:
        raise HTTPException(status_code=500, detail="COGNITO_USER_POOL_ID is not configured")

    normalized = _normalize_email(email)
    current_email = str(user.get("username") or "").strip().lower()
    if current_email and normalized == current_email:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    record = db.query(User).filter(User.email == normalized).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Safety: don't delete users who have scheduled meetings created.
    has_meetings = (
        db.query(ScheduledMeeting.id)
        .filter(ScheduledMeeting.created_by_user_id == record.id)
        .limit(1)
        .one_or_none()
        is not None
    )
    if has_meetings:
        raise HTTPException(status_code=409, detail="User has scheduled meetings")

    client = boto3.client("cognito-idp", region_name=COGNITO_REGION)
    try:
        client.admin_delete_user(UserPoolId=COGNITO_USER_POOL_ID, Username=normalized)
    except ClientError as e:
        code = (e.response or {}).get("Error", {}).get("Code")
        if code != "UserNotFoundException":
            raise HTTPException(status_code=500, detail=f"Cognito error: {code or 'unknown'}")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete Cognito user")

    db.delete(record)
    db.commit()

    return {"ok": True}


@router.patch("/users/{email}")
def update_user(
    email: str,
    request: UpdateUserRequest,
    user=Depends(require_proctor),
    db: Session = Depends(get_db),
):
    normalized = _normalize_email(email)
    current_email = str(user.get("username") or "").strip().lower()

    record = db.query(User).filter(User.email == normalized).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="User not found")

    if request.role is not None:
        if current_email and normalized == current_email and request.role != record.role:
            raise HTTPException(status_code=400, detail="You cannot change your own role")
        record.role = request.role

    if request.class_name is not None:
        # empty string => null
        record.class_name = (request.class_name or "").strip() or None

    # Safety: proctor users should not have class_name.
    if record.role == "proctor":
        record.class_name = None

    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "username": record.email,
        "role": record.role,
        "display_name": record.user_name,
        "class_name": record.class_name,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
    }
