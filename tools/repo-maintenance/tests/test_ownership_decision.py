"""Shared-path aggregation and fork-sync tests for the pure ownership planner.

Synthetic multi-owner, shared-path, and parent fixtures only. No file read, no
network, no Git, and no credentials.
"""

from __future__ import annotations

import unittest
from dataclasses import replace

import ownership as op

from .ownership_fixtures import (
    DEV_PATH,
    RUNNING,
    checkout,
    entry,
    evidence,
    parse,
    unlock_doc,
)


class RemoteIdentityTests(unittest.TestCase):
    def test_only_supported_github_transports_bind(self):
        for url in (
            "https://github.com/org-alpha/widget.git",
            "git@github.com:org-alpha/widget.git",
            "ssh://git@github.com:2222/org-alpha/widget.git",
        ):
            self.assertEqual(op.remote_repo(url), "org-alpha/widget")

    def test_lookalike_hosts_and_extra_url_parts_do_not_bind(self):
        for url in (
            "https://example.invalid/org-alpha/widget.git",
            "https://github.com.example.invalid/org-alpha/widget.git",
            "https://github.com@evil.invalid/org-alpha/widget.git",
            "https://github.com/extra/org-alpha/widget.git",
            "https://github.com/org-alpha/widget?secret=x",
        ):
            with self.subTest(url=url):
                self.assertIsNone(op.remote_repo(url))

    def test_non_github_checkout_holds_with_valid_evidence(self):
        source = entry(checkouts=(checkout(
            DEV_PATH, url="https://example.invalid/org-alpha/example.git"
        ),))
        result = op.plan((source,), parse(unlock_doc()))
        self.assertEqual(result.checkout_decisions[0].local_default_writer,
                         op.LocalWriter.HOLD)


class SharedPathTests(unittest.TestCase):
    def _fork_of(self, canonical, name="owner-beta/widget"):
        return entry(
            full_name=name,
            classification="personal_fork_of_owned_org",
            canonical=canonical,
            personal_fork=name,
            parent_full_name=canonical,
            is_fork=True,
            scope="personal",
            checkouts=(checkout(DEV_PATH),),
        )

    def test_f3_shared_path_is_order_independent(self):
        # Repro R5: pinned-first vs fork-first must not change the decision.
        canonical = "org-alpha/Widget"
        pinned = entry(
            full_name=canonical,
            canonical=canonical,
            archived=True,
            eligibility="archived_excluded",
            checkouts=(checkout(DEV_PATH),),
        )
        fork = self._fork_of(canonical)
        config = parse(unlock_doc())
        first = op.plan((pinned, fork), config)
        second = op.plan((fork, pinned), config)
        self.assertEqual(
            first.checkout_decisions[0].local_default_writer,
            second.checkout_decisions[0].local_default_writer,
        )
        self.assertEqual(
            first.checkout_decisions[0].local_default_writer, op.LocalWriter.HOLD
        )
        self.assertEqual(first.checkout_decisions[0].special_class, "archive")

    def test_f3_pin_from_any_member_holds_the_shared_path(self):
        canonical = "org-alpha/Widget"
        plain = entry(
            full_name=canonical, canonical=canonical, checkouts=(checkout(DEV_PATH),)
        )
        archived = self._fork_of(canonical)
        archived = replace(archived, archived=True, eligibility="archived_excluded")
        d = op.plan((plain, archived), parse(unlock_doc())).checkout_decisions[0]
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(any(r.startswith("pinned:") for r in d.reasons))

    def test_f3_conflicting_identity_holds_even_with_evidence(self):
        first = entry(
            full_name="org-alpha/Widget",
            canonical="org-alpha/Widget",
            checkouts=(checkout(DEV_PATH),),
        )
        second = entry(
            full_name="owner-gamma/Widget",
            classification="personal_fork_of_owned_org",
            canonical="owner-gamma/Widget",
            personal_fork="owner-gamma/Widget",
            checkouts=(checkout(DEV_PATH),),
        )
        d = op.plan((first, second), parse(unlock_doc())).checkout_decisions[0]
        self.assertEqual(len(d.canonicals), 2)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(
            any("conflicting_canonical_or_owner_identity" in r for r in d.reasons)
        )

    def test_f3_divergent_remotes_are_surfaced_and_held(self):
        # Repro R5-family: the other record's URL is no longer dropped.
        first = entry(
            full_name="org-alpha/Widget",
            canonical="org-alpha/Widget",
            checkouts=(
                checkout(DEV_PATH, url="https://github.com/org-alpha/Widget.git"),
            ),
        )
        second = self._fork_of("org-alpha/Widget")
        second = replace(
            second,
            checkouts=(
                checkout(DEV_PATH, url="https://github.com/owner-beta/Widget.git"),
            ),
        )
        d = op.plan((first, second), parse(unlock_doc())).checkout_decisions[0]
        self.assertEqual(len(d.remote_urls), 2)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(
            any("ambiguous_shared_path_remote_bindings" in r for r in d.reasons)
        )

    def test_f5_hostile_remote_is_flagged_and_held(self):
        # Repro R8.
        e = entry(
            full_name="org-alpha/widget",
            canonical="org-alpha/widget",
            checkouts=(
                checkout(DEV_PATH, url="https://github.com/hostile/widget.git"),
            ),
        )
        d = op.plan((e,), parse(unlock_doc())).checkout_decisions[0]
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(any("unexpected_remote_binding" in r for r in d.reasons))

    def test_f5_matching_remote_is_not_flagged(self):
        e = entry(
            full_name="org-alpha/widget",
            canonical="org-alpha/widget",
            checkouts=(
                checkout(DEV_PATH, url="git@github.com:org-alpha/widget.git"),
            ),
        )
        d = op.plan((e,), parse(None)).checkout_decisions[0]
        self.assertFalse(any("unexpected_remote_binding" in r for r in d.reasons))


class CanonicalTests(unittest.TestCase):
    def _org_and_fork(self, canonical="org-alpha/widget", personal="owner-beta/widget"):
        org = entry(full_name=canonical, canonical=canonical)
        fork = entry(
            full_name=personal,
            classification="personal_fork_of_owned_org",
            canonical=canonical,
            personal_fork=personal,
            parent_full_name=canonical,
            is_fork=True,
            scope="personal",
        )
        return org, fork

    def test_fork_sync_separate_from_local_writer(self):
        org, fork = self._org_and_fork()
        org = replace(org, checkouts=(checkout(DEV_PATH),))
        fork = replace(fork, checkouts=(checkout(DEV_PATH),))
        config = parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        result = op.plan((org, fork), config)
        cp = result.canonical_policies[0]
        self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.MAINTENANCE)
        self.assertEqual(cp.fork_members, ("owner-beta/widget",))
        self.assertEqual(
            result.checkout_decisions[0].local_default_writer, op.LocalWriter.HOLD
        )

    def test_fork_sync_requires_configured_account(self):
        org, fork = self._org_and_fork()
        cp = op.plan((org, fork), parse(None)).canonical_policies[0]
        self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.HOLD)
        self.assertIn("configured_account_required", cp.fork_sync_reasons)

    def test_f5_fork_must_exist_in_inventory(self):
        # Repro R7a: a declared fork absent from the inventory must not sync.
        org = entry(
            full_name="org-alpha/widget",
            canonical="org-alpha/widget",
            personal_fork="owner-beta/widget",
        )
        cp = op.plan(
            (org,), parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        ).canonical_policies[0]
        self.assertNotEqual(cp.fork_sync_owner, op.ForkSyncOwner.MAINTENANCE)
        self.assertTrue(
            any("declared_fork_not_in_inventory" in r for r in cp.fork_sync_reasons)
        )

    def test_declared_member_with_wrong_classification_does_not_sync(self):
        org = entry(
            full_name="org-alpha/widget",
            canonical="org-alpha/widget",
            personal_fork="owner-beta/widget",
        )
        member = entry(
            full_name="owner-beta/widget",
            classification="canonical_owned_org",
            canonical="org-alpha/widget",
            personal_fork="owner-beta/widget",
            parent_full_name="org-alpha/widget",
            is_fork=True,
            scope="personal",
        )
        cp = op.plan(
            (org, member), parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        ).canonical_policies[0]
        self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.HOLD)

    def test_fork_requires_exact_nonmissing_parent_and_fork_flag(self):
        org, fork = self._org_and_fork()
        config = parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        for changes in (
            {"parent_full_name": None},
            {"parent_full_name": "unrelated/upstream"},
            {"is_fork": False},
        ):
            with self.subTest(changes=changes):
                bad = replace(fork, **changes)
                cp = op.plan((org, bad), config).canonical_policies[0]
                self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.HOLD)

    def test_f5_fork_parent_must_agree(self):
        # Repro R7b: a member whose parent is not the canonical must not count.
        org = entry(full_name="org-alpha/widget", canonical="org-alpha/widget")
        bad = entry(
            full_name="owner-beta/widget",
            classification="personal_fork_of_owned_org",
            canonical="org-alpha/widget",
            personal_fork="owner-beta/widget",
            parent_full_name="unrelated/upstream",
            is_fork=True,
            scope="personal",
        )
        cp = op.plan(
            (org, bad), parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        ).canonical_policies[0]
        self.assertNotEqual(cp.fork_sync_owner, op.ForkSyncOwner.MAINTENANCE)
        self.assertTrue(any("fork_invalid_binding" in r for r in cp.fork_sync_reasons))

    def test_thirdparty_parent_is_never_inferred_as_canonical(self):
        e = entry(
            full_name="owner-beta/widget",
            classification="personal_thirdparty_fork",
            canonical="owner-beta/widget",
            parent_full_name="someone-else/widget",
            is_fork=True,
            scope="personal",
        )
        result = op.plan(
            (e,), parse({"owned_accounts": ["owner-beta", "someone-else"]})
        )
        cp = result.canonical_policies[0]
        self.assertEqual(cp.canonical, "owner-beta/widget")
        self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.HOLD)
        self.assertIn("thirdparty:no_parent_inference", cp.fork_sync_reasons)
        self.assertNotIn(
            "someone-else/widget", [c.canonical for c in result.canonical_policies]
        )

    def test_non_fork_canonical_has_no_fork_sync(self):
        e = entry(full_name="owner-delta/thing", canonical="owner-delta/thing")
        cp = op.plan((e,), parse(None)).canonical_policies[0]
        self.assertEqual(cp.fork_sync_owner, op.ForkSyncOwner.NONE)

    def test_canonical_policy_differs_from_checkout_policy(self):
        canonical = "org-alpha/Archipelago"
        org = entry(
            full_name=canonical, canonical=canonical, checkouts=(checkout(DEV_PATH),)
        )
        fork = entry(
            full_name="owner-beta/Archipelago",
            classification="personal_fork_of_owned_org",
            canonical=canonical,
            personal_fork="owner-beta/Archipelago",
            parent_full_name=canonical,
            is_fork=True,
            scope="personal",
            checkouts=(checkout(DEV_PATH),),
        )
        result = op.plan((org, fork), parse(None))
        self.assertEqual(len(result.canonical_policies), 1)
        self.assertEqual(len(result.repo_plans), 2)
        self.assertEqual(len(result.checkout_decisions), 1)
        config2 = parse(
            {
                "current_server_version": RUNNING,
                "evidence": {"checkouts": {DEV_PATH: evidence("true")}},
            }
        )
        result2 = op.plan((org, fork), config2)
        self.assertEqual(
            result.canonical_policies[0].fork_sync_owner,
            result2.canonical_policies[0].fork_sync_owner,
        )
        self.assertEqual(
            result.canonical_policies[0].cleanup_owner,
            result2.canonical_policies[0].cleanup_owner,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
