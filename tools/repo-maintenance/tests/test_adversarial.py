"""Adversarial, fixture-only tests for the pure cleanup planner.

Every case builds frozen dataclasses in memory and calls `plan_cleanup`. There is
no subprocess, no network, no filesystem read or write, and no credential or
maintenance-worker import inside any test.

Run from this directory:
    python -B -m unittest -v test_adversarial
"""

import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from planner import (
    ActivityBinding, ActivityFreshness, ActivitySettlement, BranchSnapshot,
    CleanupOwner, DeleteBranch, Policy, RemoveEligibleWorktree, Skip,
    SkipReason, Snapshot, T3Activity, WorktreeBinding, plan_cleanup,
)

NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=4)
FRESH = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.UNBOUND, ActivitySettlement.SETTLED
)
BINDING = WorktreeBinding(
    "C:\\worktrees\\feature", "feature", False, False, False, False, False, False, FRESH
)
BRANCH = BranchSnapshot(
    "feature", "abc123", True, False, False, True, OLD, (BINDING,), activity=FRESH
)
SNAPSHOT = Snapshot((BRANCH,), "main", True, "C:\\worktrees")


def policy(owner=CleanupOwner.MAINTENANCE, t3_disabled=True,
           now=NOW, retention=timedelta(days=3)):
    return Policy(now, retention, owner, t3_disabled)


def on_branch(branch, snapshot=SNAPSHOT):
    return replace(snapshot, branches=(branch,))


def only_actions(snapshot, policy_):
    return plan_cleanup(snapshot, policy_).actions


class MalformedBindingNotLostByFilter(unittest.TestCase):
    """The ownership filter is `b.branch == branch.name`. A malformed binding
    must not slip past the inconsistency screen and vanish from that filter,
    because a vanished binding is what turns a live checkout into an orphan
    DeleteBranch."""

    def test_none_branch_binding_is_not_dropped_into_an_orphan_delete(self):
        unreadable = replace(BINDING, branch=None)
        snapshot = on_branch(replace(BRANCH, worktree_bindings=(unreadable,)))
        action = only_actions(snapshot, policy())[0]
        self.assertIsInstance(
            action, Skip,
            f"a binding with branch=None was dropped by the filter and the "
            f"branch became {action!r}",
        )

    def test_foreign_none_binding_at_shared_path_flags_both_branches(self):
        other = replace(BRANCH, name="other", worktree_bindings=(
            replace(BINDING, branch=None, path="C:\\worktrees\\feature"),
        ))
        snapshot = replace(SNAPSHOT, branches=(BRANCH, other))
        actions = only_actions(snapshot, policy())
        self.assertEqual(actions, (
            Skip("feature", SkipReason.INCONSISTENT_BINDINGS),
            Skip("other", SkipReason.INCONSISTENT_BINDINGS),
        ))

    def test_none_binding_alongside_a_valid_binding_does_not_remove(self):
        unreadable = replace(BINDING, branch=None, path="C:\\worktrees\\other")
        snapshot = on_branch(replace(BRANCH, worktree_bindings=(BINDING, unreadable)))
        action = only_actions(snapshot, policy())[0]
        self.assertNotIsInstance(action, DeleteBranch)

    def test_empty_string_branch_field_is_already_flagged(self):
        # Documents the asymmetry the None case escapes: "" is caught, None is not.
        empty = replace(BINDING, branch="")
        snapshot = on_branch(replace(BRANCH, worktree_bindings=(empty,)))
        self.assertEqual(only_actions(snapshot, policy()),
                         (Skip("feature", SkipReason.INCONSISTENT_BINDINGS),))


class AncestryIsCallerAsserted(unittest.TestCase):
    def test_truthy_non_bool_ancestry_is_rejected(self):
        for value in (1, "yes"):
            with self.subTest(value=value):
                snapshot = on_branch(replace(BRANCH, merged_ancestry=value))
                self.assertIsInstance(
                    only_actions(snapshot, policy())[0], Skip)


class PathContainmentCharacterization(unittest.TestCase):
    def test_trailing_separator_on_binding_path_is_normalized(self):
        snapshot = on_branch(replace(BRANCH, worktree_bindings=(
            replace(BINDING, path="C:\\worktrees\\feature\\"),
        )))
        self.assertIsInstance(only_actions(snapshot, policy())[0],
                              RemoveEligibleWorktree)

    def test_case_and_slash_variant_same_path_is_flagged_across_branches(self):
        a = replace(BRANCH, name="feature", worktree_bindings=(
            replace(BINDING, branch="feature", path="C:\\WT\\Feature"),
        ))
        b = replace(BRANCH, name="other", worktree_bindings=(
            replace(BINDING, branch="other", path="c:/wt/feature"),
        ))
        snapshot = replace(SNAPSHOT, branches=(a, b))
        self.assertEqual(only_actions(snapshot, policy()), (
            Skip("feature", SkipReason.INCONSISTENT_BINDINGS),
            Skip("other", SkipReason.INCONSISTENT_BINDINGS),
        ))

    def test_posix_filesystem_root_is_rejected_as_cleanup_scope(self):
        snapshot = replace(SNAPSHOT, allowed_worktree_root="/",
                           branches=(replace(BRANCH, worktree_bindings=(
                               replace(BINDING, path="/etc/whatever"),
                           )),))
        self.assertEqual(only_actions(snapshot, policy()),
                         (Skip("feature", SkipReason.UNSAFE_PATH),))

    def test_empty_binding_path_is_unsafe(self):
        snapshot = on_branch(replace(BRANCH, worktree_bindings=(
            replace(BINDING, path=""),
        )))
        self.assertEqual(only_actions(snapshot, policy()),
                         (Skip("feature", SkipReason.UNSAFE_PATH),))


class DuplicateAndOwnershipEdges(unittest.TestCase):
    def test_duplicate_name_where_one_entry_is_default(self):
        # Both entries carry the default name, so the scope guard wins on both.
        # Fail-closed either way; documents guard precedence, not a defect.
        default_entry = replace(BRANCH, name="main", is_default=True, worktree_bindings=())
        snapshot = replace(SNAPSHOT, branches=(default_entry, replace(BRANCH, name="main")))
        self.assertEqual(only_actions(snapshot, policy()), (
            Skip("main", SkipReason.DEFAULT_BRANCH),
            Skip("main", SkipReason.DEFAULT_BRANCH),
        ))

    def test_retention_zero_boundary_is_exclusive(self):
        # activity_at > now - retention is the test, so activity == now is inside
        # by one instant. Documents the boundary; the default window is unaffected.
        snapshot = on_branch(replace(BRANCH, last_activity=NOW))
        self.assertIsInstance(only_actions(snapshot, policy(retention=timedelta(0)))[0],
                              RemoveEligibleWorktree)
        just_older = on_branch(replace(BRANCH, last_activity=NOW - timedelta(microseconds=1)))
        self.assertIsInstance(
            only_actions(just_older, policy(retention=timedelta(0)))[0],
            RemoveEligibleWorktree)

    def test_t3_owner_delete_needs_bindings_readable(self):
        orphan = on_branch(replace(BRANCH, worktree_bindings=()))
        snapshot = replace(orphan, bindings_readable=False)
        self.assertEqual(only_actions(snapshot, policy(owner=CleanupOwner.T3)),
                         (Skip("feature", SkipReason.BINDINGS_UNKNOWN),))


if __name__ == "__main__":
    unittest.main()
