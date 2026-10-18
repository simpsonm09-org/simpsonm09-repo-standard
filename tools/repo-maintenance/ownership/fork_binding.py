"""Shared exact binding check for owned personal-fork candidates."""

from __future__ import annotations

from .model import Entry


def is_owned_personal_fork_binding(
    candidate_name: str,
    canonical: str,
    member: Entry,
    owned_accounts: frozenset[str] | None,
) -> bool:
    """Prove a candidate name binds to this exact configured owned fork record."""
    owner = candidate_name.split("/", 1)[0] if "/" in candidate_name else ""
    return (
        member.full_name == candidate_name
        and member.personal_fork in (None, candidate_name)
        and member.classification == "personal_fork_of_owned_org"
        and member.is_fork
        and member.canonical == canonical
        and member.parent_full_name == canonical
        and (owned_accounts is None or owner in owned_accounts)
    )
