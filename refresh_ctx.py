"""Set while the internal cache warmer asks for a rebuild (x-refresh: 1). See main._refresh_ahead."""
from contextvars import ContextVar

force_refresh = ContextVar("force_refresh", default=False)
