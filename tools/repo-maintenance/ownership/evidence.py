"""Evidence parsing and fail-closed sanitization.

An operator's recorded observation is an assertion, not a verified fact. Freshness
is derived from a timezone-aware ``observed_at`` against an explicitly injected
``now`` and ``max_age``, and a running-version claim is only accepted when it
matches the explicitly configured current server version. This module reads no
clock and parses no file.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .model import (
    ALLOWED_VERIFIED_EVIDENCE_SOURCES,
    Effective,
    Evidence,
    VerificationContext,
)


def _parse_observed(value: Any) -> Effective:
    """Only a JSON string naming a known value is accepted; anything else is unknown."""
    if not isinstance(value, str):
        return Effective.UNKNOWN
    try:
        return Effective(value.strip().lower())
    except ValueError:
        return Effective.UNKNOWN


def _parse_observed_at(value: Any) -> tuple[datetime | None, str | None]:
    """Parse a timezone-aware ISO-8601 timestamp, or explain why it cannot be."""
    if value is None:
        return None, "observed_at missing"
    if not isinstance(value, str) or not value.strip():
        return None, "observed_at is not a non-empty string"
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None, "observed_at is not ISO-8601"
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None, "observed_at lacks a timezone offset"
    return parsed, None


def _derive_freshness(
    observed_at: Any, ctx: VerificationContext | None
) -> tuple[bool, str | None]:
    """Freshness is derived, never self-attested by the input document."""
    parsed, parse_error = _parse_observed_at(observed_at)
    if parse_error:
        return False, parse_error
    if ctx is None or ctx.now is None or ctx.max_age is None:
        return False, "freshness horizon (now/max_age) not configured"
    now = ctx.now
    if now.tzinfo is None or now.utcoffset() is None:
        return False, "verification now lacks a timezone offset"
    if parsed > now:
        return False, "observed_at is in the future"
    if now - parsed > ctx.max_age:
        return False, "observed_at is stale for the configured max_age"
    return True, None


def sanitize_evidence(
    raw: Mapping[str, Any] | None, ctx: VerificationContext | None = None
) -> Evidence:
    """Parse evidence and force fail-closed fields.

    A source outside the allow-list is downgraded to unverified, a version that
    does not match the configured running version cannot verify the running build,
    and freshness is derived from ``observed_at`` rather than accepted from the
    input. An unknown observation can never be verified or fresh. This is where the
    "a clone read is never verified" rule is enforced structurally.
    """
    if not raw:
        return Evidence()
    notes: list[str] = []
    observed = _parse_observed(raw.get("observed", "unknown"))

    source = raw.get("source")
    if not isinstance(source, str) or not source:
        source = "none"

    version = raw.get("version")
    if version is not None and not isinstance(version, str):
        notes.append("version must be a string or null; ignored")
        version = None

    stored_at = raw.get("observed_at")
    observed_at = stored_at if isinstance(stored_at, str) else None

    verified = False
    if "verified" in raw:
        raw_verified = raw["verified"]
        if isinstance(raw_verified, bool):
            verified = raw_verified
        else:
            notes.append("verified must be a JSON boolean; treated as false")

    fresh, fresh_note = _derive_freshness(stored_at, ctx)
    if fresh_note:
        notes.append(fresh_note)

    if verified and source not in ALLOWED_VERIFIED_EVIDENCE_SOURCES:
        verified = False
        notes.append(f"source {source!r} cannot verify the running build; downgraded")
    if verified:
        configured = ctx.current_server_version if ctx is not None else None
        if not configured:
            verified = False
            notes.append(
                "no configured current server version; evidence cannot verify the "
                "running build"
            )
        elif version != configured:
            verified = False
            notes.append(
                f"observed version {version!r} does not match configured running "
                f"version {configured!r}; downgraded"
            )

    if observed is Effective.UNKNOWN:
        verified = False
        fresh = False

    return Evidence(
        observed=observed,
        source=source,
        version=version,
        observed_at=observed_at,
        fresh=fresh,
        verified=verified,
        verification_note="; ".join(notes) or None,
    )
