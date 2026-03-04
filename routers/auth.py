"""
AlphaForge — Auth Router
Handles: Register (invite-only), Login, Token refresh, Invite management
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List
import uuid

from core.database import get_db
from core.auth import (hash_password, verify_password, create_access_token,
                       get_current_user, get_admin_user, generate_invite_code)
from core.config import settings
from models.user import User
from models.invite_code import InviteCode

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: str
    invite_code: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class CreateInviteRequest(BaseModel):
    count: int = 1
    notes: Optional[str] = None


# ── Routes ─────────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check invite code
    result = await db.execute(
        select(InviteCode).where(
            InviteCode.code == req.invite_code.upper().strip(),
            InviteCode.is_used == False,
            InviteCode.is_active == True,
        )
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid or already-used invite code")

    # Check user cap
    user_count = await db.execute(select(func.count(User.id)))
    if user_count.scalar() >= settings.MAX_USERS:
        raise HTTPException(status_code=400, detail="Community is currently full")

    # Check duplicate email / username
    existing = await db.execute(
        select(User).where((User.email == req.email) | (User.username == req.username))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email or username already taken")

    # Create user
    user = User(
        id=uuid.uuid4(),
        email=req.email,
        username=req.username,
        hashed_password=hash_password(req.password),
        full_name=req.full_name,
        invite_code_used=req.invite_code.upper(),
        is_admin=False,
    )
    db.add(user)

    # Mark invite used
    invite.is_used = True
    invite.used_by = user.id
    invite.used_at = datetime.utcnow()

    await db.flush()
    token = create_access_token({"sub": str(user.id), "email": user.email})
    return TokenResponse(
        access_token=token,
        user={"id": str(user.id), "email": user.email, "username": user.username,
              "full_name": user.full_name, "is_admin": user.is_admin}
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    user.last_login = datetime.utcnow()
    token = create_access_token({"sub": str(user.id), "email": user.email})
    return TokenResponse(
        access_token=token,
        user={"id": str(user.id), "email": user.email, "username": user.username,
              "full_name": user.full_name, "is_admin": user.is_admin}
    )


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "is_admin": current_user.is_admin,
        "created_at": current_user.created_at.isoformat(),
    }


# ── Admin: Invite Management ───────────────────────────────────────────────
@router.post("/invites/create")
async def create_invites(
    req: CreateInviteRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate invite codes (admin only)"""
    codes = []
    for _ in range(min(req.count, 50)):  # Max 50 at once
        code = generate_invite_code()
        invite = InviteCode(
            id=uuid.uuid4(),
            code=code,
            created_by=admin.id,
            notes=req.notes,
        )
        db.add(invite)
        codes.append(code)
    return {"codes": codes, "count": len(codes)}


@router.get("/invites")
async def list_invites(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all invite codes (admin only)"""
    result = await db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))
    invites = result.scalars().all()
    return [
        {
            "code": i.code,
            "is_used": i.is_used,
            "is_active": i.is_active,
            "notes": i.notes,
            "created_at": i.created_at.isoformat(),
            "used_at": i.used_at.isoformat() if i.used_at else None,
        }
        for i in invites
    ]


@router.get("/users")
async def list_users(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """List all users (admin only)"""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "username": u.username,
            "full_name": u.full_name,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
            "last_login": u.last_login.isoformat() if u.last_login else None,
        }
        for u in users
    ]
