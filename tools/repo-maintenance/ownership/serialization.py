"""Serialization of a plan to its candidate JSON shape.

The output is a candidate, never a ready-to-apply runtime config. This module
performs no I/O; the caller decides where the JSON goes.
"""

from __future__ import annotations

from typing import Any

from .model import Evidence, Plan


def _evidence_to_dict(ev: Evidence) -> dict[str, Any]:
    out: dict[str, Any] = {
        "observed": ev.observed.value,
        "source": ev.source,
        "version": ev.version,
        "observed_at": ev.observed_at,
        "fresh": ev.fresh,
        "verified": ev.verified,
    }
    if ev.verification_note:
        out["verification_note"] = ev.verification_note
    return out


def plan_to_dict(plan_obj: Plan) -> dict[str, Any]:
    return {
        "schema": plan_obj.schema,
        "mode": plan_obj.mode,
        "apply_permitted": plan_obj.apply_permitted,
        "provenance": dict(plan_obj.provenance),
        "inputs": {
            "worker_local_writes_disabled": plan_obj.worker_local_writes_disabled,
            "owned_accounts": list(plan_obj.owned_accounts),
        },
        "counts": dict(plan_obj.counts),
        "canonical_policies": [
            {
                "canonical": cp.canonical,
                "owner_group": cp.owner_group,
                "kind": cp.kind,
                "archived": cp.archived,
                "private": cp.private,
                "members": list(cp.members),
                "fork_members": list(cp.fork_members),
                "fork_sync_owner": cp.fork_sync_owner.value,
                "fork_sync_reasons": list(cp.fork_sync_reasons),
                "cleanup_owner": cp.cleanup_owner.value,
                "cleanup_reason": cp.cleanup_reason,
                "notes": list(cp.notes),
            }
            for cp in plan_obj.canonical_policies
        ],
        "repo_plans": [
            {
                "full_name": r.full_name,
                "owner_group": r.owner_group,
                "inventory_scope": r.inventory_scope,
                "classification": r.classification,
                "canonical": r.canonical,
                "is_fork": r.is_fork,
                "parent_full_name": r.parent_full_name,
                "archived": r.archived,
                "private": r.private,
                "eligibility": r.eligibility,
                "cleanup_policy": r.cleanup_policy,
                "coverage": r.coverage,
                "local_default_writer": r.local_default_writer.value,
                "fork_sync_owner": r.fork_sync_owner.value,
                "cleanup_owner": r.cleanup_owner.value,
                "checkout_paths": list(r.checkout_paths),
                "reasons": list(r.reasons),
            }
            for r in plan_obj.repo_plans
        ],
        "checkout_decisions": [
            {
                "checkout_path": d.checkout_path,
                "canonical": d.canonical,
                "canonicals": list(d.canonicals),
                "owner_group": d.owner_group,
                "remote_url": d.remote_url,
                "remote_urls": list(d.remote_urls),
                "branch": d.branch,
                "special_class": d.special_class,
                "special_classes": list(d.special_classes),
                "exception_recorded": d.exception_recorded,
                "approved_dev_checkout": d.approved_dev_checkout,
                "evidence": _evidence_to_dict(d.evidence),
                "local_default_writer": d.local_default_writer.value,
                "reasons": list(d.reasons),
                "required_actions": list(d.required_actions),
            }
            for d in plan_obj.checkout_decisions
        ],
    }
