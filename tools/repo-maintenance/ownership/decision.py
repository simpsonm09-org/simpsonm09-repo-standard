"""Checkout and fork-sync decisions.

Fork sync is independent of the local writer and never inferred from a parent. The
checkout decision aggregates every inventory record that names a physical path, so
it is order-independent and never first-entry-wins.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from .classification import special_classes
from .fork_binding import is_owned_personal_fork_binding
from .model import (
    Checkout,
    CheckoutDecision,
    Effective,
    Entry,
    Evidence,
    ForkSyncOwner,
    LocalWriter,
    PolicyConfig,
)


def remote_repo(url: Any) -> str | None:
    """Return ``owner/name`` only for supported, exact GitHub remote URLs."""
    if not isinstance(url, str) or not url.strip():
        return None
    text = url.strip().rstrip("/").removesuffix(".git")
    match = re.fullmatch(
        r"(?:https://github\.com/|git@github\.com:|"
        r"ssh://git@github\.com(?::[0-9]+)?/)"
        r"([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)",
        text,
    )
    return f"{match[1]}/{match[2]}" if match else None


def _owned(full_name: str | None, owned_accounts: frozenset[str]) -> bool:
    return bool(full_name) and full_name.split("/", 1)[0] in owned_accounts


def decide_fork_sync(
    canonical: str,
    group: Sequence[Entry],
    config: PolicyConfig,
    inventory_names: frozenset[str],
) -> tuple[ForkSyncOwner, tuple[str, ...], tuple[str, ...]]:
    """Fork sync is independent of the local writer and never inferred from a parent.

    Eligible only when an exact owned canonical and personal fork are in inventory,
    their parent relationship agrees, and an owned account is configured. A
    third-party parent never grants a sync claim; an absent declared fork is held.

    Returns ``(owner, reasons, fork_members)``.
    """
    members = tuple(sorted(group, key=lambda e: e.full_name))
    members_by_name = {e.full_name: e for e in members}

    if any(
        e.classification == "personal_thirdparty_fork"
        or e.eligibility == "thirdparty_personal_fork_excluded"
        for e in members
    ):
        return ForkSyncOwner.HOLD, ("thirdparty:no_parent_inference",), ()

    problems: list[str] = []
    fork_names: set[str] = set()
    for member in members:
        if member.full_name == canonical:
            declared = member.personal_fork
            if declared:
                candidate = members_by_name.get(declared)
                if (
                    declared in inventory_names
                    and candidate is not None
                    and is_owned_personal_fork_binding(
                        declared,
                        canonical,
                        candidate,
                        config.owned_accounts or None,
                    )
                ):
                    fork_names.add(declared)
                elif candidate is None or declared not in inventory_names:
                    problems.append(f"declared_fork_not_in_inventory:{declared}")
                else:
                    problems.append(f"declared_fork_invalid_binding:{declared}")
            continue
        if (
            member.classification == "personal_fork_of_owned_org"
            or member.is_fork
            or member.personal_fork == member.full_name
        ):
            if member.full_name not in inventory_names or not is_owned_personal_fork_binding(
                member.full_name,
                canonical,
                member,
                config.owned_accounts or None,
            ):
                problems.append(f"fork_invalid_binding:{member.full_name}")
                continue
            fork_names.add(member.full_name)

    if problems:
        return ForkSyncOwner.HOLD, tuple(sorted(set(problems))), ()

    ordered = tuple(sorted(fork_names))
    if not ordered:
        return ForkSyncOwner.NONE, ("not_a_fork",), ()

    if not config.owned_accounts:
        return ForkSyncOwner.HOLD, ("configured_account_required",), ordered
    if not _owned(canonical, config.owned_accounts):
        return ForkSyncOwner.HOLD, ("canonical_not_configured_owned",), ordered
    if not all(_owned(f, config.owned_accounts) for f in ordered):
        return ForkSyncOwner.HOLD, ("fork_not_configured_owned",), ordered
    return (
        ForkSyncOwner.MAINTENANCE,
        ("owned_canonical_and_owned_fork",),
        ordered,
    )


def _decide_checkout(
    key: str,
    members: Sequence[tuple[Entry, Checkout]],
    config: PolicyConfig,
) -> CheckoutDecision:
    """Decide one physical checkout from ALL inventory records that name it.

    Never first-entry-wins: every member contributes its pin, its identity, and its
    remote binding before the decision is made, so the result is independent of
    input order. A path recorded under conflicting canonicals/owners or with
    conflicting remote bindings fails closed.
    """
    ordered_members = sorted(members, key=lambda pair: (pair[0].full_name, pair[1].path))
    entries = tuple(m for m, _ in ordered_members)
    checkouts = tuple(c for _, c in ordered_members)

    canonicals = tuple(sorted({e.canonical for e in entries}))
    owner_groups = tuple(sorted({e.owner_group for e in entries}))
    classes = tuple(sorted({c for m in ordered_members for c in special_classes(*m)}))
    urls = tuple(sorted({c.url for c in checkouts if c.url}))
    branches = tuple(sorted({c.branch for c in checkouts if c.branch}))
    display_path = min(c.path for c in checkouts)

    pin = "|".join(classes) if classes else None
    exception_recorded, reasons, writer = _pin_decision(
        key, classes, pin, canonicals, config
    )
    evidence = config.checkout_evidence(key)
    approved = key in config.approved_dev_checkouts
    canonical_evidence = (
        config.canonical_evidence(canonicals[0]) if len(canonicals) == 1 else Evidence()
    )
    if (
        evidence.observed is Effective.UNKNOWN
        and canonical_evidence.observed is not Effective.UNKNOWN
    ):
        reasons.append("canonical_evidence_does_not_unlock_physical_checkout")

    actions: list[str] = []
    if writer is None:
        writer, evidence_reasons, actions = _writer_from_evidence(
            evidence, approved, config
        )
        reasons.extend(evidence_reasons)
    writer, identity_problems = _shared_identity_problems(
        canonicals, owner_groups, urls, writer
    )
    reasons.extend(identity_problems)
    writer, remote_problems = _remote_binding_problems(
        canonicals, entries, checkouts, writer
    )
    reasons.extend(remote_problems)

    reasons.append("shared_path_identity:" + ",".join(canonicals))
    if urls:
        reasons.append("shared_path_remotes:" + ",".join(urls))

    return CheckoutDecision(
        checkout_path=display_path,
        canonical=canonicals[0] if canonicals else "",
        canonicals=canonicals,
        owner_group=owner_groups[0] if owner_groups else "",
        remote_url=urls[0] if urls else None,
        remote_urls=urls,
        branch=branches[0] if branches else None,
        special_class=pin,
        special_classes=classes,
        exception_recorded=exception_recorded,
        approved_dev_checkout=approved,
        evidence=evidence,
        local_default_writer=writer,
        reasons=tuple(reasons),
        required_actions=tuple(actions),
    )


def _pin_decision(
    key: str,
    classes: tuple[str, ...],
    pin: str | None,
    canonicals: tuple[str, ...],
    config: PolicyConfig,
) -> tuple[bool, list[str], LocalWriter | None]:
    reasons: list[str] = []
    if not classes:
        return False, reasons, None
    exception = config.checkout_exception(key)
    if exception is None:
        canonical_exception = (
            config.canonical_exception(canonicals[0]) if len(canonicals) == 1 else None
        )
        if canonical_exception is not None:
            reasons.append(
                f"explicit_exception:{pin}:{canonical_exception.reason}:"
                "canonical_scope_does_not_lift_pin"
            )
        reasons.extend((f"pinned:{pin}", "explicit_exception_required"))
        return canonical_exception is not None, reasons, LocalWriter.HOLD
    suffix = ":pin_retained" if not exception.lift_pin else ""
    reasons.append(f"explicit_exception:{pin}:{exception.reason}{suffix}")
    writer = LocalWriter.HOLD if not exception.lift_pin else None
    return True, reasons, writer


def _writer_from_evidence(
    evidence: Evidence, approved: bool, config: PolicyConfig
) -> tuple[LocalWriter, list[str], list[str]]:
    reasons: list[str] = []
    actions: list[str] = []
    if evidence.usable_false():
        reasons.append("effective_autoPull_false_verified_fresh")
        if config.worker_local_writes_disabled is False and approved:
            reasons.extend(("approved_dev_checkout", "worker_local_writes_enabled"))
            return LocalWriter.MAINTENANCE, reasons, actions
        if not approved:
            reasons.append("not_approved_dev_checkout")
            actions.append(
                "classify this checkout as an approved dev checkout after the "
                "supported-UI defaultAutoPull=false override is verified and fresh"
            )
        else:
            reasons.append("worker_local_writes_not_enabled")
            actions.append(
                "enable worker local writes to take ownership, or keep T3 as "
                "the local writer"
            )
        return LocalWriter.HOLD, reasons, actions
    if evidence.usable_true():
        reasons.append("effective_autoPull_true_verified")
        if config.worker_local_writes_disabled is True:
            reasons.append("worker_local_writes_disabled")
            return LocalWriter.T3, reasons, actions
        reasons.append("worker_local_writes_not_disabled")
        actions.append(
            "disable worker local writes before letting T3 own this checkout, "
            "or flip the override off and take maintenance ownership"
        )
        return LocalWriter.HOLD, reasons, actions
    reasons.extend((f"evidence_{evidence.observed.value}", "fail_closed"))
    actions.append(
        "obtain verified fresh effective autoPull evidence from the supported "
        "Settings UI per-project override; a clean branch or clone read is not enough"
    )
    return LocalWriter.HOLD, reasons, actions


def _shared_identity_problems(
    canonicals: tuple[str, ...],
    owner_groups: tuple[str, ...],
    urls: tuple[str, ...],
    writer: LocalWriter | None,
) -> tuple[LocalWriter, list[str]]:
    problems: list[str] = []
    if len(canonicals) > 1 or len(owner_groups) > 1:
        problems.append("conflicting_canonical_or_owner_identity_fail_closed")
        writer = LocalWriter.HOLD
    if len(urls) > 1:
        problems.append("ambiguous_shared_path_remote_bindings_fail_closed")
        writer = LocalWriter.HOLD
    return writer or LocalWriter.HOLD, problems


def _remote_binding_problems(
    canonicals: tuple[str, ...],
    entries: tuple[Entry, ...],
    checkouts: tuple[Checkout, ...],
    writer: LocalWriter | None,
) -> tuple[LocalWriter, list[str]]:
    identities = {name.lower() for name in canonicals}
    identities.update(entry.full_name.lower() for entry in entries)
    identities.update(
        entry.personal_fork.lower() for entry in entries if entry.personal_fork
    )
    unexpected = tuple(
        sorted(
            {
                checkout.url
                for checkout in checkouts
                if checkout.url
                and (remote_repo(checkout.url) or "").lower() not in identities
            }
        )
    )
    if unexpected:
        return LocalWriter.HOLD, [
            "unexpected_remote_binding_fail_closed:" + ",".join(unexpected)
        ]
    return writer or LocalWriter.HOLD, []
