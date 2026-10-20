"""The planner: group records, decide every scope, and count the result.

Candidate only. This function never writes a ready-to-apply runtime config and
never touches Git, settings, WSL, tasks, services, or the network.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from .classification import decide_cleanup_owner, special_class
from .decision import _decide_checkout, decide_fork_sync
from .model import (
    ALLOWED_VERIFIED_EVIDENCE_SOURCES,
    APPLY_PERMITTED,
    MODE_CANDIDATE_ONLY,
    POLICY_SCHEMA,
    REVIEWED_CLONE_EQUIVALENCE_PROVEN,
    CanonicalPolicy,
    Checkout,
    CheckoutDecision,
    CleanupOwner,
    Entry,
    ForkSyncOwner,
    LocalWriter,
    Plan,
    PolicyConfig,
    RepoPlan,
)
from .paths import normalize_path

# Candidate policy line for every artifact. Kept here so serialization and the
# planner agree on the exact wording.
_OBSERVATIONS_ARE_ASSERTIONS = (
    "Recorded evidence is an operator assertion, not an authenticity proof. "
    "Freshness is derived from observed_at against an injected now and "
    "max_age, and a version claim must match the configured server version."
)
_CANDIDATE_NOTE = (
    "Candidate policy only. Not an apply instruction. Effective T3 autoPull is "
    "readable only from the supported Settings UI per-project override; there is "
    "no MCP/programmatic read, and no clone read can verify the running build. "
    "T3 pulls run while the truth server is running, which is independent of "
    "whether the desktop UI is open. A future apply step must validate the "
    "running server live."
)


def _aggregate_writer(
    writers: Sequence[LocalWriter],
) -> tuple[LocalWriter, tuple[str, ...]]:
    distinct = set(writers)
    if distinct == {LocalWriter.HOLD}:
        return LocalWriter.HOLD, ("all_checkouts_hold",)
    if len(distinct) == 1:
        only = next(iter(distinct))
        return only, (f"all_checkouts_{only.value}",)
    return LocalWriter.HOLD, ("mixed_checkout_writers_fail_closed",)


def _counts(
    entries: Sequence[Entry],
    repo_plans: Sequence[RepoPlan],
    canonical_policies: Sequence[CanonicalPolicy],
    decisions: Mapping[str, CheckoutDecision],
) -> dict[str, Any]:
    return {
        "repositories": len(repo_plans),
        "inventory_entries": len(entries),
        "owner_groups": dict(sorted(Counter(e.owner_group for e in entries).items())),
        "canonical_groups": len(canonical_policies),
        "checkouts": len(decisions),
        "local_default_writer": dict(
            Counter(r.local_default_writer.value for r in repo_plans)
        ),
        "fork_sync_owner": dict(
            Counter(c.fork_sync_owner.value for c in canonical_policies)
        ),
        "cleanup_owner": dict(
            Counter(c.cleanup_owner.value for c in canonical_policies)
        ),
        "special_class_holds": sum(
            1
            for d in decisions.values()
            if d.special_class is not None
            and d.local_default_writer is LocalWriter.HOLD
        ),
    }


def _canonical_policies(
    groups: Mapping[str, Sequence[Entry]],
    config: PolicyConfig,
    inventory_names: frozenset[str],
) -> tuple[list[CanonicalPolicy], dict[str, ForkSyncOwner], dict[str, CleanupOwner]]:
    policies: list[CanonicalPolicy] = []
    fork_sync_by_canonical: dict[str, ForkSyncOwner] = {}
    cleanup_by_canonical: dict[str, CleanupOwner] = {}
    for canonical in sorted(groups):
        group = sorted(groups[canonical], key=lambda e: e.full_name)
        anchor = next((e for e in group if e.full_name == canonical), group[0])
        fork_sync, fork_reasons, fork_members = decide_fork_sync(
            canonical, group, config, inventory_names
        )
        cleanup, cleanup_reason = decide_cleanup_owner(anchor)
        notes: list[str] = []
        if anchor.parent_full_name and anchor.is_fork:
            notes.append(
                f"canonical is a fork of {anchor.parent_full_name}; parent is not used "
                "as canonical and not used for any ownership inference"
            )
        policies.append(
            CanonicalPolicy(
                canonical=canonical,
                owner_group=anchor.owner_group,
                kind=anchor.classification,
                archived=any(e.archived for e in group),
                private=any(e.private for e in group),
                members=tuple(sorted(e.full_name for e in group)),
                fork_members=fork_members,
                fork_sync_owner=fork_sync,
                fork_sync_reasons=fork_reasons,
                cleanup_owner=cleanup,
                cleanup_reason=cleanup_reason,
                notes=tuple(notes),
            )
        )
        fork_sync_by_canonical[canonical] = fork_sync
        cleanup_by_canonical[canonical] = cleanup
    return policies, fork_sync_by_canonical, cleanup_by_canonical


def _repo_plans(
    entries: Sequence[Entry],
    decisions: Mapping[str, CheckoutDecision],
    fork_sync_by_canonical: Mapping[str, ForkSyncOwner],
    cleanup_by_canonical: Mapping[str, CleanupOwner],
) -> list[RepoPlan]:
    plans: list[RepoPlan] = []
    for entry in entries:
        checkout_paths = [c.path for c in entry.checkouts]
        if not entry.checkouts:
            writer = LocalWriter.HOLD
            reasons = (
                f"pinned:{special_class(entry, None)}",
                "explicit_exception_required",
            )
        else:
            writers = [
                decisions[normalize_path(c.path)].local_default_writer
                for c in entry.checkouts
            ]
            writer, reasons = _aggregate_writer(writers)
        plans.append(
            RepoPlan(
                full_name=entry.full_name,
                owner_group=entry.owner_group,
                inventory_scope=entry.inventory_scope,
                classification=entry.classification,
                canonical=entry.canonical,
                is_fork=entry.is_fork,
                parent_full_name=entry.parent_full_name,
                archived=entry.archived,
                private=entry.private,
                eligibility=entry.eligibility,
                cleanup_policy=entry.cleanup_policy,
                coverage=entry.coverage,
                local_default_writer=writer,
                fork_sync_owner=fork_sync_by_canonical[entry.canonical],
                cleanup_owner=cleanup_by_canonical[entry.canonical],
                checkout_paths=tuple(checkout_paths),
                reasons=reasons,
            )
        )
    return plans


def plan(entries: Sequence[Entry], config: PolicyConfig) -> Plan:
    inventory_names = frozenset(e.full_name for e in entries)
    groups: dict[str, list[Entry]] = {}
    for e in entries:
        groups.setdefault(e.canonical, []).append(e)

    canonical_policies, fork_sync_by_canonical, cleanup_by_canonical = (
        _canonical_policies(groups, config, inventory_names)
    )

    by_path: dict[str, list[tuple[Entry, Checkout]]] = {}
    for entry in entries:
        for checkout in entry.checkouts:
            by_path.setdefault(normalize_path(checkout.path), []).append(
                (entry, checkout)
            )

    decisions: dict[str, CheckoutDecision] = {
        key: _decide_checkout(key, by_path[key], config) for key in sorted(by_path)
    }

    repo_plans = _repo_plans(
        entries, decisions, fork_sync_by_canonical, cleanup_by_canonical
    )
    counts = _counts(entries, repo_plans, canonical_policies, decisions)
    provenance = {
        "source": config.source_label,
        "expected_running_version": config.current_server_version,
        "t3_clone_version": config.reviewed_clone_version,
        "t3_clone_commit": config.reviewed_clone_commit,
        "t3_clone_equivalence_proven": REVIEWED_CLONE_EQUIVALENCE_PROVEN,
        "verified_evidence_sources_allowed": sorted(ALLOWED_VERIFIED_EVIDENCE_SOURCES),
        "effective_value_is_not": "legacy aggregate autoPull / project row fields",
        "observations_are_assertions": _OBSERVATIONS_ARE_ASSERTIONS,
        "note": _CANDIDATE_NOTE,
    }
    return Plan(
        schema=POLICY_SCHEMA,
        mode=MODE_CANDIDATE_ONLY,
        apply_permitted=APPLY_PERMITTED,
        provenance=provenance,
        worker_local_writes_disabled=config.worker_local_writes_disabled,
        owned_accounts=tuple(sorted(config.owned_accounts)),
        canonical_policies=tuple(canonical_policies),
        repo_plans=tuple(repo_plans),
        checkout_decisions=tuple(decisions[k] for k in sorted(decisions)),
        counts=counts,
    )
