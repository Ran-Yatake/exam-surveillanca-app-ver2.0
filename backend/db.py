import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker


# --- MySQL (User role store) ---
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = os.getenv("MYSQL_PORT", "3306")
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "exam_surveillance")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}",
)

Base = declarative_base()

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and apply minimal schema evolution.

    Note: this is intentionally lightweight (MVP). It should not block app startup.
    """
    # Import models so Base.metadata is populated
    from models import ScheduledMeeting, User  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # SQLAlchemy's create_all does NOT add columns to existing tables.
    try:
        with engine.begin() as conn:
            cols = conn.execute(
                text(
                    """
                    SELECT COLUMN_NAME
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = :db
                      AND TABLE_NAME = 'users'
                    """
                ),
                {"db": MYSQL_DATABASE},
            ).fetchall()
            existing = {row[0] for row in cols}

            # If schema was renamed manually, ensure the new columns exist.
            # If old columns still exist, try to rename them to the new names.
            if "email" not in existing:
                if "username" in existing:
                    try:
                        conn.execute(text("ALTER TABLE users RENAME COLUMN username TO email"))
                        existing.add("email")
                    except Exception:
                        # Fallback: add as new column
                        conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL"))
                        existing.add("email")
                else:
                    conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL"))
                    existing.add("email")

            if "user_name" not in existing:
                if "display_name" in existing:
                    try:
                        conn.execute(text("ALTER TABLE users RENAME COLUMN display_name TO user_name"))
                        existing.add("user_name")
                    except Exception:
                        conn.execute(text("ALTER TABLE users ADD COLUMN user_name VARCHAR(255) NULL"))
                        existing.add("user_name")
                else:
                    conn.execute(text("ALTER TABLE users ADD COLUMN user_name VARCHAR(255) NULL"))
                    existing.add("user_name")

            if "class_name" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN class_name VARCHAR(255) NULL"))
    except Exception as e:
        # Don't block startup; DB could be unavailable during boot.
        print(f"Warning: failed to ensure users columns: {e}")

    try:
        with engine.begin() as conn:
            cols = conn.execute(
                text(
                    """
                    SELECT COLUMN_NAME
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = :db
                      AND TABLE_NAME = 'scheduled_meetings'
                    """
                ),
                {"db": MYSQL_DATABASE},
            ).fetchall()
            existing = {row[0] for row in cols}

            if "teacher_name" not in existing:
                conn.execute(text("ALTER TABLE scheduled_meetings ADD COLUMN teacher_name VARCHAR(255) NULL"))
    except Exception as e:
        print(f"Warning: failed to ensure scheduled_meetings columns: {e}")
