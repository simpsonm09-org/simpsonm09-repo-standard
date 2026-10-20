"""Boundary parsing for the inventory document and the operator config.

Callers hand plain decoded JSON here. Booleans must be real JSON booleans, and a
duplicated ``full_name`` is rejected: a second record with the same name would
otherwise plan twice and slip past set-based coverage checks. ``now`` and
``max_age`` are injected, never implied.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any

from .evidence import sanitize_evidence
from .model import (
    DEFAULT_SOURCE_LABEL,
    Checkout,
    Entry,
    Exception_,
    PolicyConfig,
    VerificationContext,
)
from .paths import normalize_path


def _strict_bool(
    raw: Mapping[str, Any], key: str, *, where: str, default: bool
) -> bool:
    """Return a JSON boolean, or reject a string/number/null at the boundary.

    A missing key takes the fail-closed default. A present value that is not an
    actual JSON boolean is rejected rather than coerced, so ``"false"`` can never
    silently become ``True``.
    """
    if key not in raw:
        return default
    value = raw[key]
    if isinstance(value, bool):
        return value
    raise ValueError(
        f"{where}.{key} must be a JSON boolean (true/false); got {type(value).__name__}"
    )


def _optional_bool(raw: Mapping[str, Any], key: str, *, where: str) -> bool | None:
    if key not in raw or raw[key] is None:
        return None
    value = raw[key]
    if isinstance(value, bool):
        return value
    raise ValueError(
        f"{where}.{key} must be a JSON boolean (true/false) or null; "
        f"got {type(value).__name__}"
    )


def _optional_str(raw: Mapping[str, Any], key: str, *, where: str) -> str | None:
    """A string or null, and nothing else. The fail-closed default is null."""
    value = raw.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    raise ValueError(
        f"{where}.{key} must be a string or null; got {type(value).__name__}"
    )


def parse_inventory(doc: Mapping[str, Any]) -> tuple[Entry, ...]:
    """Parse the inventory boundary strictly.

    Booleans must be real JSON booleans, and a duplicated ``full_name`` is
    rejected.
    """
    entries: list[Entry] = []
    seen: set[str] = set()
    for raw in doc["repositories"]:
        full_name = raw["full_name"]
        if full_name in seen:
            raise ValueError(f"duplicate inventory full_name: {full_name}")
        seen.add(full_name)
        checkouts = tuple(
            Checkout(
                path=c.get("checkout") or "",
                url=c.get("url"),
                branch=c.get("branch"),
                direction=c.get("direction"),
            )
            for c in raw.get("checkouts") or []
            if c.get("checkout")
        )
        entries.append(
            Entry(
                full_name=full_name,
                inventory_scope=raw.get("inventory_scope", ""),
                classification=raw.get("classification", ""),
                canonical=raw.get("canonical") or full_name,
                personal_fork=raw.get("personal_fork"),
                parent_full_name=raw.get("parent_full_name"),
                is_fork=_strict_bool(raw, "fork", where=full_name, default=False),
                archived=_strict_bool(raw, "archived", where=full_name, default=False),
                private=_strict_bool(raw, "private", where=full_name, default=False),
                default_branch=raw.get("default_branch"),
                eligibility=raw.get("eligibility", ""),
                cleanup_policy=raw.get("cleanup_policy", ""),
                coverage=raw.get("coverage", ""),
                checkouts=checkouts,
            )
        )
    return tuple(entries)


def _parse_exception(value: Any) -> Exception_:
    value = value or {}
    return Exception_(
        reason=str(value.get("reason", "unspecified")),
        lift_pin=value.get("lift_pin") is True,
    )


def parse_config(
    doc: Mapping[str, Any] | None,
    *,
    now: datetime | None = None,
    max_age: timedelta | None = None,
) -> PolicyConfig:
    """Parse operator config. ``now``/``max_age`` are injected, never implied."""
    doc = doc or {}
    evidence = doc.get("evidence") or {}
    exceptions = doc.get("exceptions") or {}
    version = _optional_str(doc, "current_server_version", where="config")
    ctx = VerificationContext(now=now, max_age=max_age, current_server_version=version)
    source_label = (
        _optional_str(doc, "source_label", where="config") or DEFAULT_SOURCE_LABEL
    )
    return PolicyConfig(
        owned_accounts=frozenset(doc.get("owned_accounts") or ()),
        approved_dev_checkouts=frozenset(
            normalize_path(p) for p in (doc.get("approved_dev_checkouts") or ())
        ),
        worker_local_writes_disabled=_optional_bool(
            doc, "worker_local_writes_disabled", where="config"
        ),
        current_server_version=version,
        source_label=source_label,
        reviewed_clone_version=_optional_str(
            doc, "reviewed_clone_version", where="config"
        ),
        reviewed_clone_commit=_optional_str(
            doc, "reviewed_clone_commit", where="config"
        ),
        evidence_by_checkout={
            normalize_path(k): sanitize_evidence(v, ctx)
            for k, v in (evidence.get("checkouts") or {}).items()
        },
        evidence_by_canonical={
            k: sanitize_evidence(v, ctx)
            for k, v in (evidence.get("canonicals") or {}).items()
        },
        exceptions_by_checkout={
            normalize_path(k): _parse_exception(v)
            for k, v in (exceptions.get("checkouts") or {}).items()
        },
        exceptions_by_canonical={
            k: _parse_exception(v)
            for k, v in (exceptions.get("canonicals") or {}).items()
        },
    )
