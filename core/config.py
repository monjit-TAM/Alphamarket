"""
AlphaForge — Configuration
All secrets come from environment variables. Never hardcode credentials.
Copy .env.example to .env and fill in your values.
"""

from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────────────────
    APP_NAME: str = "AlphaForge"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    SECRET_KEY: str                          # Generate: openssl rand -hex 32
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # ── Groww API ─────────────────────────────────────────────────────────
    # Get from: https://groww.in/trade-api/api-keys
    GROWW_API_KEY: str                       # Your API Key or TOTP Token
    GROWW_API_SECRET: str = ""              # Your API Secret (if using key/secret flow)
    GROWW_TOTP_SECRET: str = ""            # Your TOTP Secret (if using TOTP flow)
    GROWW_ACCESS_TOKEN: str = ""           # Pre-generated access token (optional)
    GROWW_AUTH_FLOW: str = "totp"          # "apikey" or "totp"

    # ── Database (PostgreSQL) ─────────────────────────────────────────────
    # Supabase: get from your project settings
    # Self-hosted: postgresql://user:password@localhost:5432/alphaforge
    DATABASE_URL: str

    # ── Redis ─────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379"

    # ── CORS ──────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:5173",     # Vite dev server
        "http://localhost:3000",
        "https://alphaforge.in",     # Your production domain
        "https://www.alphaforge.in",
    ]

    # ── Invite System ─────────────────────────────────────────────────────
    MAX_USERS: int = 100             # Hard cap for invite-only community
    INVITE_ONLY: bool = True
    ADMIN_EMAIL: str = ""           # Your admin email

    # ── Zerodha Kite Connect ───────────────────────────────────────────
    KITE_API_KEY: str = ''
    KITE_API_SECRET: str = ''
    KITE_REDIRECT_URL: str = ''

    # ── Rate Limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_PER_MINUTE: int = 60

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
