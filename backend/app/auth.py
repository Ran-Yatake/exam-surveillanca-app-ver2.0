import os
from typing import Optional

import requests
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .db import get_db
from .models import User


# Cognito Configuration
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID")
COGNITO_APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID")

# NOTE:
# `AWS_DEFAULT_REGION` is used for AWS SDK clients (e.g. Chime).
# Cognito User Pools can live in a different region; infer from pool id
# (e.g. "ap-northeast-1_xxxxx") or allow explicit override.
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")


def _infer_cognito_region(user_pool_id: str | None) -> str | None:
    if not user_pool_id:
        return None
    if "_" not in user_pool_id:
        return None
    region, _ = user_pool_id.split("_", 1)
    return region or None


COGNITO_REGION = os.getenv("COGNITO_REGION") or _infer_cognito_region(COGNITO_USER_POOL_ID) or AWS_REGION
COGNITO_ISSUER = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"

# Cache JWKS
_jwks = None


def get_jwks():
    global _jwks
    if _jwks is None:
        try:
            url = f"{COGNITO_ISSUER}/.well-known/jwks.json"
            res = requests.get(url, timeout=5)
            res.raise_for_status()
            _jwks = res.json()
        except Exception:
            # Fallback for dev/offline environments.
            _jwks = {"keys": []}

    # Defensive: ensure expected shape
    if not isinstance(_jwks, dict) or not isinstance(_jwks.get("keys"), list):
        return {"keys": []}
    return _jwks


async def get_current_user(authorization: Optional[str] = Header(None)):
    if not COGNITO_USER_POOL_ID:
        # If Cognito is not configured, bypass auth for dev (Optional: remove in prod)
        return {"sub": "dev-user", "username": "dev-user"}

    if not COGNITO_APP_CLIENT_ID:
        raise HTTPException(status_code=500, detail="COGNITO_APP_CLIENT_ID is not configured")

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    token = authorization.replace("Bearer ", "")
    try:
        keys = get_jwks()["keys"]
        if not keys:
            raise HTTPException(status_code=401, detail="JWKS unavailable (check Cognito region/user pool settings)")
        header = jwt.get_unverified_header(token)
        kid = header["kid"]
        key = next((k for k in keys if k["kid"] == kid), None)
        if not key:
            raise HTTPException(status_code=401, detail="Invalid token key")

        payload = jwt.decode(token, key, algorithms=["RS256"], audience=COGNITO_APP_CLIENT_ID, issuer=COGNITO_ISSUER)
        return payload
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")


def _payload_username(payload: dict) -> str:

    email = (payload.get("email") or "").strip().lower()
    if email:
        return email

    # Cognito ID token typically contains 'cognito:username'
    value = payload.get("cognito:username") or payload.get("username") or payload.get("sub") or "unknown"
    return str(value).strip() or "unknown"


def get_current_user_record(
    user_payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = _payload_username(user_payload)

    default_proctors = {u.strip().lower() for u in os.getenv("DEFAULT_PROCTOR_USERS", "").split(",") if u.strip()}
    default_role = "proctor" if email.lower() in default_proctors else "examinee"

    record = db.query(User).filter(User.email == email).one_or_none()
    if record is None:
        record = User(email=email, role=default_role)
        db.add(record)
        db.commit()
        db.refresh(record)

    return {
        "payload": user_payload,
        "username": record.email,
        "role": record.role,
        "user": record,
    }


def require_proctor(user=Depends(get_current_user_record)):
    if user.get("role") != "proctor":
        raise HTTPException(status_code=403, detail="Proctor role required")
    return user
