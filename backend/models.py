from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    role = Column(String(32), nullable=False, default="examinee")  # 'proctor' | 'examinee'
    # Display profile fields (used for UI/tile labels)
    user_name = Column(String(255), nullable=True)
    class_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class ScheduledMeeting(Base):
    __tablename__ = "scheduled_meetings"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Student join code (also used as ExternalMeetingId)
    join_code = Column(String(64), unique=True, index=True, nullable=False)
    title = Column(String(255), nullable=True)

    # Display-only metadata (editable by proctor)
    teacher_name = Column(String(255), nullable=True)

    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    scheduled_start_at = Column(DateTime, nullable=True)
    scheduled_end_at = Column(DateTime, nullable=True)

    region = Column(String(32), nullable=False, default="us-east-1")
    chime_meeting_id = Column(String(128), nullable=True)

    # scheduled | started | ended
    status = Column(String(32), nullable=False, default="scheduled")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
