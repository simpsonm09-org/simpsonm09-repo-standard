"""Invariant validation for a candidate plan.

Coverage is enforced against the actual source data, never a fixed count: every
inventory entry must be planned, and every physical checkout key in the source
must appear exactly once as a decision.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from .fork_binding import is_owned_personal_fork_binding
from .model import (
    MODE_CANDIDATE_ONLY,
    Effective,
    Entry,
    ForkSyncOwner,
    LocalWriter,
    Plan,
)
from .paths import normalize_path


def validate(plan_obj: Plan, entries: Sequence[Entry]) -> tuple[str, ...]:
    """Return invariant violations. Empty tuple means the plan is fail-closed."""
    problems: list[str] = []
    if plan_obj.mode != MODE_CANDIDATE_ONLY:
        problems.append(f"mode must be {MODE_CANDIDATE_ONLY}")
    if plan_obj.apply_permitted:
        problems.append("apply_permitted must be False")

    names = [e.full_name for e in entries]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    if duplicates:
        problems.append(f"duplicate inventory full_name(s): {duplicates}")

    expected = set(names)
    got = {r.full_name for r in plan_obj.repo_plans}
    if expected != got:
        problems.append(f"repo set mismatch: {sorted(expected ^ got)}")
    if len(plan_obj.repo_plans) != len(entries):
        problems.append("repo plan count does not match inventory entry count")

    expected_keys = {
        normalize_path(c.path) for e in entries for c in e.checkouts if c.path
    }
    actual = [normalize_path(d.checkout_path) for d in plan_obj.checkout_decisions]
    actual_keys = set(actual)
    if len(actual) != len(actual_keys):
        problems.append("duplicate physical checkout decisions")
    if expected_keys != actual_keys:
        problems.append(
            f"physical checkout coverage mismatch: {sorted(expected_keys ^ actual_keys)}"
        )

    expected_counts = Counter(e.owner_group for e in entries)
    actual_counts = plan_obj.counts["owner_groups"]
    for owner in sorted(set(expected_counts) | set(actual_counts)):
        if expected_counts.get(owner, 0) != actual_counts.get(owner, 0):
            problems.append(
                f"owner group {owner} count {actual_counts.get(owner, 0)} != "
                f"inventory {expected_counts.get(owner, 0)}"
            )

    for d in plan_obj.checkout_decisions:
        if (
            d.special_class is not None
            and d.local_default_writer is not LocalWriter.HOLD
            and not d.exception_recorded
        ):
            problems.append(
                f"{d.checkout_path}: special class {d.special_class} must hold"
            )
        conflicting_identity = len(d.canonicals) > 1
        conflicting_bindings = len(set(d.remote_urls)) > 1
        if (
            conflicting_identity or conflicting_bindings
        ) and d.local_default_writer is not LocalWriter.HOLD:
            problems.append(
                f"{d.checkout_path}: conflicting identity or bindings must hold"
            )
        if (
            d.evidence.observed is Effective.UNKNOWN
            and d.local_default_writer is not LocalWriter.HOLD
        ):
            problems.append(f"{d.checkout_path}: unknown evidence must fail closed")
        if d.local_default_writer is LocalWriter.T3:
            ok = (
                d.evidence.usable_true()
                and plan_obj.worker_local_writes_disabled is True
            )
            if not ok:
                problems.append(
                    f"{d.checkout_path}: t3 writer lacks verified true evidence"
                )
        if d.local_default_writer is LocalWriter.MAINTENANCE:
            ok = (
                d.evidence.usable_false()
                and d.approved_dev_checkout
                and plan_obj.worker_local_writes_disabled is False
            )
            if not ok:
                problems.append(
                    f"{d.checkout_path}: maintenance writer lacks verified false "
                    "evidence, approval, or worker write posture"
                )

    entries_by_canonical: dict[str, dict[str, Entry]] = {}
    for entry in entries:
        entries_by_canonical.setdefault(entry.canonical, {})[entry.full_name] = entry

    for cp in plan_obj.canonical_policies:
        if cp.fork_sync_owner is ForkSyncOwner.MAINTENANCE:
            if not plan_obj.owned_accounts:
                problems.append(
                    f"{cp.canonical}: fork sync without configured accounts"
                )
            canonical_owner = (
                cp.canonical.split("/", 1)[0] if "/" in cp.canonical else ""
            )
            if canonical_owner not in plan_obj.owned_accounts:
                problems.append(
                    f"{cp.canonical}: fork sync canonical is not configured owned"
                )
            source_members = entries_by_canonical.get(cp.canonical, {})
            canonical_entry = source_members.get(cp.canonical)
            declared_name = (
                canonical_entry.personal_fork if canonical_entry is not None else None
            )
            if declared_name:
                declared_member = source_members.get(declared_name)
                if (
                    declared_member is None
                    or not is_owned_personal_fork_binding(
                        declared_name,
                        cp.canonical,
                        declared_member,
                        plan_obj.owned_accounts,
                    )
                ):
                    problems.append(
                        f"{cp.canonical}: source declared fork binding is invalid for "
                        f"{declared_name}"
                    )

            source_forks = {
                name: member
                for name, member in source_members.items()
                if name != cp.canonical
                and (
                    member.classification == "personal_fork_of_owned_org"
                    or member.is_fork
                    or member.personal_fork == member.full_name
                )
            }
            valid_source_forks = {
                name
                for name, member in source_forks.items()
                if is_owned_personal_fork_binding(
                    name, cp.canonical, member, plan_obj.owned_accounts
                )
            }
            if len(valid_source_forks) != len(source_forks):
                problems.append(f"{cp.canonical}: source fork binding is invalid")
            if not valid_source_forks:
                problems.append(
                    f"{cp.canonical}: fork sync without an inventory-present fork"
                )
            if set(cp.fork_members) != valid_source_forks:
                problems.append(
                    f"{cp.canonical}: fork members do not match source bindings"
                )
    return tuple(problems)


def validate_manifest_coverage(
    plan_obj: Plan, manifest: Mapping[str, Any]
) -> tuple[str, ...]:
    """Every runtime-manifest canonical and physical checkout must appear in the plan."""
    problems: list[str] = []
    known = {cp.canonical for cp in plan_obj.canonical_policies}
    missing_canonicals = sorted(
        {e.get("canonical") for e in manifest.get("entries", [])} - known
    )
    problems += [
        f"manifest canonical missing from plan: {c}" for c in missing_canonicals
    ]

    decision_keys = {
        normalize_path(d.checkout_path) for d in plan_obj.checkout_decisions
    }
    manifest_paths = {
        normalize_path(c["checkout"])
        for e in manifest.get("entries", [])
        for c in (e.get("checkouts") or [])
        if c.get("checkout")
    }
    problems += [
        f"manifest checkout path missing from plan: {p}"
        for p in sorted(manifest_paths - decision_keys)
    ]
    return tuple(problems)
