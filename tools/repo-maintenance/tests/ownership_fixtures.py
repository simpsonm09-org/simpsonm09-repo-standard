"""Shared builders for the pure ownership-policy tests.

Synthetic only. The owner names, repository names, and checkout paths below are
invented, so the committed suite carries no personal account, machine path, or
private inventory. The suite reads no external input and skips nothing by
environment.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import ownership as op

NOW = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)
MAX_AGE = timedelta(days=7)
RUNNING = "9.9.9-configured"

DEV_PATH = "D:\\dev\\example\\dev"


def parse(doc=None):
    """Parse a config with an explicit injected freshness horizon."""
    return op.parse_config(doc, now=NOW, max_age=MAX_AGE)


def sctx(**over):
    """Explicit verification context for direct sanitize_evidence calls."""
    kw = {"now": NOW, "max_age": MAX_AGE, "current_server_version": RUNNING}
    kw.update(over)
    return op.VerificationContext(**kw)


def evidence(
    observed="false",
    source="operator_ui_override",
    version=RUNNING,
    observed_at="2026-10-18T06:00:00Z",
    verified=True,
):
    return {
        "observed": observed,
        "source": source,
        "version": version,
        "observed_at": observed_at,
        "verified": verified,
    }


def checkout(path=DEV_PATH, url=None, branch="main", direction="fetch"):
    return op.Checkout(path=path, url=url, branch=branch, direction=direction)


def entry(
    full_name="org-alpha/example",
    classification="canonical_owned_org",
    canonical=None,
    personal_fork=None,
    parent_full_name=None,
    is_fork=False,
    archived=False,
    private=False,
    eligibility="supported_candidate",
    cleanup_policy="review_required",
    coverage="checkout_present",
    checkouts=(),
    scope="org",
):
    return op.Entry(
        full_name=full_name,
        inventory_scope=scope,
        classification=classification,
        canonical=canonical or full_name,
        personal_fork=personal_fork,
        parent_full_name=parent_full_name,
        is_fork=is_fork,
        archived=archived,
        private=private,
        default_branch="main",
        eligibility=eligibility,
        cleanup_policy=cleanup_policy,
        coverage=coverage,
        checkouts=tuple(checkouts),
    )


def unlock_doc(path=DEV_PATH, **over):
    """Config that would unlock `maintenance` for an otherwise-unpinned path."""
    doc = {
        "approved_dev_checkouts": [path],
        "worker_local_writes_disabled": False,
        "current_server_version": RUNNING,
        "evidence": {"checkouts": {path: evidence("false")}},
    }
    evidence_over = over.pop("evidence", None)
    doc.update(over)
    if evidence_over is not None:
        doc["evidence"]["checkouts"][path].update(evidence_over)
    return doc


def synthetic_inventory():
    """A small multi-owner inventory with shared, pinned, and parented records.

    It stands in for the private inventory: several owner groups, one physical
    path named by two records, a third-party-parent canonical, and a no-checkout
    record. No real count is baked into the tests that consume it.
    """
    return {
        "repositories": [
            {
                "full_name": "org-alpha/widget",
                "inventory_scope": "org",
                "classification": "canonical_owned_org",
                "fork": False,
                "archived": False,
                "private": False,
                "checkouts": [
                    {
                        "checkout": "D:\\dev\\example\\shared",
                        "url": "https://github.com/org-alpha/widget.git",
                        "branch": "main",
                    }
                ],
            },
            {
                "full_name": "owner-beta/widget",
                "inventory_scope": "personal",
                "classification": "personal_fork_of_owned_org",
                "canonical": "org-alpha/widget",
                "personal_fork": "owner-beta/widget",
                "parent_full_name": "org-alpha/widget",
                "fork": True,
                "archived": False,
                "private": True,
                "checkouts": [
                    {
                        "checkout": "D:\\dev\\example\\shared",
                        "url": "https://github.com/owner-beta/widget.git",
                        "branch": "main",
                    }
                ],
            },
            {
                "full_name": "org-alpha/Archipelago",
                "inventory_scope": "org",
                "classification": "canonical_owned_org",
                "parent_full_name": "someone-else/bridgeipelago",
                "fork": True,
                "archived": False,
                "private": False,
                "checkouts": [
                    {"checkout": "D:\\dev\\example\\bridge", "branch": "main"}
                ],
            },
            {
                "full_name": "owner-gamma/deploy",
                "inventory_scope": "personal",
                "classification": "canonical_owned_org",
                "eligibility": "deployment_or_homelab_excluded",
                "fork": False,
                "archived": False,
                "private": False,
                "checkouts": [
                    {"checkout": "D:\\dev\\example\\deploy", "branch": "main"}
                ],
            },
            {
                "full_name": "owner-delta/legacy",
                "inventory_scope": "personal",
                "classification": "canonical_owned_org",
                "eligibility": "archived_excluded",
                "cleanup_policy": "excluded",
                "fork": False,
                "archived": True,
                "private": False,
                "checkouts": [
                    {"checkout": "D:\\dev\\example\\legacy", "branch": "main"}
                ],
            },
            {
                "full_name": "owner-delta/wsl-repo",
                "inventory_scope": "personal",
                "classification": "canonical_owned_org",
                "fork": False,
                "archived": False,
                "private": False,
                "checkouts": [{"checkout": "/home/example/wsl-repo", "branch": "main"}],
            },
            {
                "full_name": "owner-beta/no-checkout",
                "inventory_scope": "personal",
                "classification": "canonical_owned_org",
                "fork": False,
                "archived": False,
                "private": False,
                "coverage": "no_checkout",
                "eligibility": "no_checkout_excluded",
                "checkouts": [],
            },
            {
                "full_name": "owner-gamma/thirdparty",
                "inventory_scope": "personal",
                "classification": "personal_thirdparty_fork",
                "parent_full_name": "someone-else/upstream",
                "fork": True,
                "archived": False,
                "private": False,
                "checkouts": [{"checkout": "D:\\dev\\example\\tp", "branch": "main"}],
            },
        ]
    }

