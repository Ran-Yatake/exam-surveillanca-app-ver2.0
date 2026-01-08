from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_record
from db import get_db
from models import User

router = APIRouter(tags=["profile"])


class ProfileUpsertRequest(BaseModel):
    display_name: str
    class_name: Optional[str] = None


@router.get("/me")
def me(user=Depends(get_current_user_record)):
    return {"username": user["username"], "role": user["role"]}


@router.get("/profile")
def get_profile(user=Depends(get_current_user_record)):
    record: User = user["user"]
    return {
        "username": record.email,
        "role": record.role,
        # Keep API field name for compatibility; stored in DB as user_name
        "display_name": record.user_name,
        "class_name": record.class_name,
    }


@router.post("/profile")
def upsert_profile(
    request: ProfileUpsertRequest,
    user=Depends(get_current_user_record),
    db: Session = Depends(get_db),
):
    record: User = user["user"]

    display_name = (request.display_name or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")

    if record.role == "examinee":
        class_name = (request.class_name or "").strip()
        if not class_name:
            raise HTTPException(status_code=400, detail="class_name is required for examinee")
        record.class_name = class_name
    else:
        # proctor: class_name is not used
        record.class_name = None

    record.user_name = display_name
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "username": record.email,
        "role": record.role,
        "display_name": record.user_name,
        "class_name": record.class_name,
    }
