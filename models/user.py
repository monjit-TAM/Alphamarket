from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base
from datetime import datetime
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    avatar_url = Column(Text)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    invite_code_used = Column(String(50))
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    preferences = Column(Text, default="{}")   # JSON: theme, default_capital, etc.
