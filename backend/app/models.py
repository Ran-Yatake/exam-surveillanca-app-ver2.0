from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from .db import Base


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


class MeetingAttendanceSession(Base):
    __tablename__ = "meeting_attendance_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # External meeting join code (ScheduledMeeting.join_code) or legacy external meeting id
    join_code = Column(String(64), index=True, nullable=False)

    # Chime MeetingId (not stable across recreations; stored for reference)
    chime_meeting_id = Column(String(128), index=True, nullable=True)

    # Chime AttendeeId (unique per join)
    attendee_id = Column(String(128), index=True, nullable=False)

    # Chime ExternalUserId (contains display name token)
    external_user_id = Column(String(512), index=True, nullable=True)

    # 'examinee' | 'proctor' (MVP: record what client reports)
    role = Column(String(32), index=True, nullable=False, default="examinee")

    joined_at = Column(DateTime, nullable=False, server_default=func.now())
    left_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class MeetingChatLog(Base):
    __tablename__ = "meeting_chat_logs"

    __table_args__ = (
        UniqueConstraint("join_code", "message_id", name="uq_meeting_chat_logs_join_code_message_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    join_code = Column(String(64), index=True, nullable=False)
    message_id = Column(String(128), index=True, nullable=False)

    # Message metadata (aligned with Chime DataMessage payload)
    msg_type = Column(String(32), index=True, nullable=True)  # 'broadcast' | 'direct'
    from_role = Column(String(32), index=True, nullable=True)  # 'proctor' | 'examinee'
    from_attendee_id = Column(String(128), index=True, nullable=True)
    to_role = Column(String(32), index=True, nullable=True)  # 'all' | 'proctor' | 'examinee'
    to_attendee_id = Column(String(128), index=True, nullable=True)

    text = Column(String(4096), nullable=False)

    # Client-sent timestamp (UTC). Keep nullable and fall back to server time.
    sent_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
