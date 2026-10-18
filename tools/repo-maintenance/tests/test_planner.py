"""Negative-heavy suite for the pure cleanup planner. No I/O beyond reading this
module's own source in the structural guard."""

import ast
import pathlib
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import planner
from planner import (
    ActivityBinding, ActivityFreshness, ActivitySettlement, BranchSnapshot,
    CleanupOwner, DeleteBranch, Policy, RemoveEligibleWorktree, Skip,
    SkipReason, Snapshot, T3Activity, WorktreeBinding, plan_cleanup,
)

NOW = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=4)
NAIVE = datetime(2026, 10, 10, 12)

FRESH = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.UNBOUND, ActivitySettlement.SETTLED
)
STALE = T3Activity(
    ActivityFreshness.STALE, ActivityBinding.UNBOUND, ActivitySettlement.SETTLED
)
UNKNOWN_BINDING = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.UNKNOWN, ActivitySettlement.SETTLED
)
UNKNOWN_SETTLEMENT = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.UNBOUND, ActivitySettlement.UNKNOWN
)
BOUND = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.BOUND, ActivitySettlement.SETTLED
)
RUNNING = T3Activity(
    ActivityFreshness.FRESH, ActivityBinding.UNBOUND, ActivitySettlement.RUNNING
)

BINDING = WorktreeBinding(
    "C:\\worktrees\\feature", "feature", False, False, False, False, False, False, FRESH
)
BRANCH = BranchSnapshot(
    "feature", "abc123", True, False, False, True, OLD, (BINDING,), activity=FRESH
)
SNAPSHOT = Snapshot((BRANCH,), "main", True, "C:\\worktrees")


def policy(owner=CleanupOwner.MAINTENANCE, t3_disabled=True, now=NOW,
           retention=timedelta(days=3)):
    return Policy(now, retention, owner, t3_disabled)


def one(snapshot, policy_):
    """Single-branch plan helper. Asserts exactly one action so nothing is hidden."""
    actions = plan_cleanup(snapshot, policy_).actions
    assert len(actions) == 1, actions
    return actions[0]


def on_branch(branch, snapshot=SNAPSHOT):
    return replace(snapshot, branches=(branch,))


def on_binding(binding, snapshot=SNAPSHOT):
    return on_branch(replace(BRANCH, worktree_bindings=(binding,)), snapshot)


def named(branch, name, path=None):
    """Rename a branch and keep its own binding's branch field in sync."""
    return replace(branch, name=name,
                   worktree_bindings=tuple(
                       replace(b, branch=name, path=path if path is not None else b.path)
                       for b in branch.worktree_bindings))


class PlannerTests(unittest.TestCase):
    def test_eligible_idle_merged_clean_unbound(self):
        self.assertEqual(
            one(SNAPSHOT, policy()),
            RemoveEligibleWorktree("C:\\worktrees\\feature", "feature", "abc123"),
        )

    def test_t3_owner_never_removes_worktree_but_can_delete_verified_orphan(self):
        self.assertEqual(one(SNAPSHOT, policy(owner=CleanupOwner.T3)),
                         Skip("feature", SkipReason.T3_OWNS_WORKTREE))
        # Explicit disable does not hand a T3-owned worktree to the T3 owner.
        self.assertEqual(one(SNAPSHOT, policy(owner=CleanupOwner.T3, t3_disabled=True)),
                         Skip("feature", SkipReason.T3_OWNS_WORKTREE))
        orphan = on_branch(replace(BRANCH, worktree_bindings=()))
        self.assertEqual(one(orphan, policy(owner=CleanupOwner.T3)),
                         DeleteBranch("feature", "abc123"))

    def test_t3_owner_delete_still_needs_activity_evidence(self):
        orphan = on_branch(replace(BRANCH, worktree_bindings=(), activity=None))
        self.assertEqual(one(orphan, policy(owner=CleanupOwner.T3)),
                         Skip("feature", SkipReason.MISSING_ACTIVITY))
        orphan = on_branch(replace(BRANCH, worktree_bindings=(), activity=BOUND))
        self.assertEqual(one(orphan, policy(owner=CleanupOwner.T3)),
                         Skip("feature", SkipReason.ACTIVITY_BOUND))

    def test_maintenance_requires_explicit_t3_disabled(self):
        self.assertEqual(one(SNAPSHOT, policy(t3_disabled=False)),
                         Skip("feature", SkipReason.T3_CLEANUP_NOT_DISABLED))
        self.assertIsInstance(one(SNAPSHOT, policy(t3_disabled=True)),
                              RemoveEligibleWorktree)

    def test_all_negative_guards(self):
        with_binding = lambda **kw: on_binding(replace(BINDING, **kw))
        cases = (
            (on_branch(replace(BRANCH, is_default=True)), SkipReason.DEFAULT_BRANCH),
            (on_branch(replace(BRANCH, name="main")), SkipReason.DEFAULT_BRANCH),
            (on_branch(replace(BRANCH, protected=True)), SkipReason.PROTECTED),
            (on_branch(replace(BRANCH, detached=True)), SkipReason.DETACHED),
            (on_branch(replace(BRANCH, deployment=True)), SkipReason.DEPLOYMENT),
            (replace(SNAPSHOT, is_deployment=True), SkipReason.DEPLOYMENT),
            (replace(SNAPSHOT, is_archived=True), SkipReason.ARCHIVED),
            (on_branch(replace(BRANCH, merged_ancestry=False)), SkipReason.NOT_ANCESTOR),
            (on_branch(replace(BRANCH, merged_ancestry=None)), SkipReason.UNKNOWN_ANCESTRY),
            (on_branch(replace(BRANCH, last_activity=NOW)), SkipReason.TOO_RECENT),
            (replace(SNAPSHOT, bindings_readable=False), SkipReason.BINDINGS_UNKNOWN),
            (on_branch(replace(BRANCH, activity=None)), SkipReason.MISSING_ACTIVITY),
            (on_branch(replace(BRANCH, activity=STALE)), SkipReason.ACTIVITY_UNKNOWN),
            (on_branch(replace(BRANCH, activity=UNKNOWN_BINDING)), SkipReason.ACTIVITY_UNKNOWN),
            (on_branch(replace(BRANCH, activity=UNKNOWN_SETTLEMENT)), SkipReason.ACTIVITY_UNKNOWN),
            (on_branch(replace(BRANCH, activity=BOUND)), SkipReason.ACTIVITY_BOUND),
            (on_branch(replace(BRANCH, activity=RUNNING)), SkipReason.ACTIVITY_BOUND),
            (on_binding(replace(BINDING, activity=None)), SkipReason.MISSING_ACTIVITY),
            (on_binding(replace(BINDING, activity=STALE)), SkipReason.ACTIVITY_UNKNOWN),
            (on_binding(replace(BINDING, activity=BOUND)), SkipReason.ACTIVITY_BOUND),
            (with_binding(dirty_tracked=True), SkipReason.DIRTY_TRACKED),
            (with_binding(has_untracked=True), SkipReason.UNTRACKED),
            (with_binding(has_ignored=True), SkipReason.IGNORED),
            (with_binding(locked=True), SkipReason.LOCKED),
            (with_binding(is_main=True), SkipReason.MAIN_WORKTREE),
            (with_binding(detached=True), SkipReason.DETACHED),
        )
        for snapshot, expected in cases:
            with self.subTest(expected=expected):
                action = one(snapshot, policy())
                self.assertIsInstance(action, Skip)
                self.assertEqual(action.reason, expected)

    def test_main_worktree_is_not_reported_as_detached(self):
        self.assertEqual(one(on_binding(replace(BINDING, is_main=True)), policy()),
                         Skip("feature", SkipReason.MAIN_WORKTREE))

    def test_stale_or_unknown_activity_fails_closed(self):
        for activity in (STALE, UNKNOWN_BINDING, UNKNOWN_SETTLEMENT):
            with self.subTest(activity=activity):
                self.assertEqual(one(on_branch(replace(BRANCH, activity=activity)), policy()),
                                 Skip("feature", SkipReason.ACTIVITY_UNKNOWN))

    def test_bound_running_or_other_checkout_preserves_branch(self):
        self.assertEqual(one(on_binding(replace(BINDING, activity=BOUND)), policy()),
                         Skip("feature", SkipReason.ACTIVITY_BOUND))
        self.assertEqual(one(on_binding(replace(BINDING, activity=RUNNING)), policy()),
                         Skip("feature", SkipReason.ACTIVITY_BOUND))
        elsewhere = on_branch(replace(BRANCH, worktree_bindings=(BINDING, BINDING)))
        self.assertEqual(one(elsewhere, policy()),
                         Skip("feature", SkipReason.CHECKED_OUT_ELSEWHERE))

    def test_idempotent_when_branch_already_gone(self):
        gone = on_branch(replace(BRANCH, exists=False))
        self.assertEqual(one(gone, policy()), Skip("feature", SkipReason.ALREADY_GONE))
        self.assertEqual(plan_cleanup(gone, policy()), plan_cleanup(gone, policy()))

    def test_plan_order_follows_branch_order_and_is_stable(self):
        gone = named(replace(BRANCH, exists=False), "gone", "C:\\worktrees\\gone")
        clean = named(BRANCH, "clean", "C:\\worktrees\\clean")
        snapshot = replace(SNAPSHOT, branches=(gone, clean))
        expected = (Skip("gone", SkipReason.ALREADY_GONE),
                    RemoveEligibleWorktree("C:\\worktrees\\clean", "clean", "abc123"))
        self.assertEqual(plan_cleanup(snapshot, policy()).actions, expected)
        self.assertEqual(plan_cleanup(snapshot, policy()), plan_cleanup(snapshot, policy()))

    # --- retention clock -------------------------------------------------

    def test_retention_boundary_is_three_days(self):
        at_boundary = on_branch(replace(BRANCH, last_activity=NOW - timedelta(days=3)))
        self.assertIsInstance(one(at_boundary, policy()), RemoveEligibleWorktree)
        just_inside = on_branch(replace(
            BRANCH, last_activity=NOW - timedelta(days=3) + timedelta(seconds=1)))
        self.assertEqual(one(just_inside, policy()), Skip("feature", SkipReason.TOO_RECENT))
        recent = on_branch(replace(BRANCH, last_activity=NOW - timedelta(days=2)))
        self.assertEqual(one(recent, policy()), Skip("feature", SkipReason.TOO_RECENT))

    def test_retention_window_is_configurable(self):
        week_old = on_branch(replace(BRANCH, last_activity=NOW - timedelta(days=5)))
        self.assertEqual(one(week_old, policy(retention=timedelta(days=7))),
                         Skip("feature", SkipReason.TOO_RECENT))
        self.assertIsInstance(one(week_old, policy(retention=timedelta(days=3))),
                              RemoveEligibleWorktree)

    def test_merge_ancestry_does_not_replace_time_evidence(self):
        # Merged, but the branch was touched inside the window: still preserved.
        recent_merged = on_branch(replace(BRANCH, merged_ancestry=True,
                                          last_activity=NOW - timedelta(hours=1)))
        self.assertEqual(one(recent_merged, policy()), Skip("feature", SkipReason.TOO_RECENT))
        # Merged, but no activity time at all: fail closed instead of assuming idle.
        timeless = on_branch(replace(BRANCH, merged_ancestry=True, last_activity=None))
        self.assertEqual(one(timeless, policy()),
                         Skip("feature", SkipReason.INVALID_ACTIVITY_TIME))

    def test_future_and_naive_activity_times_fail_closed(self):
        future = on_branch(replace(BRANCH, last_activity=NOW + timedelta(seconds=1)))
        self.assertEqual(one(future, policy()), Skip("feature", SkipReason.INVALID_ACTIVITY_TIME))
        naive = on_branch(replace(BRANCH, last_activity=NAIVE))
        self.assertEqual(one(naive, policy()), Skip("feature", SkipReason.INVALID_ACTIVITY_TIME))
        self.assertEqual(one(SNAPSHOT, policy(now=NAIVE)),
                         Skip("feature", SkipReason.INVALID_ACTIVITY_TIME))
        self.assertEqual(one(on_branch(replace(BRANCH, last_activity=None)), policy()),
                         Skip("feature", SkipReason.INVALID_ACTIVITY_TIME))

    def test_negative_retention_is_rejected(self):
        with self.assertRaises(ValueError):
            plan_cleanup(SNAPSHOT, policy(retention=timedelta(days=-1)))

    # --- ancestry --------------------------------------------------------

    def test_squash_or_rebase_tip_is_not_an_ancestor_so_it_is_skipped(self):
        # A squash/rebase merge leaves the tip outside the default branch history.
        squashed = on_branch(replace(BRANCH, merged_ancestry=False))
        self.assertEqual(one(squashed, policy()), Skip("feature", SkipReason.NOT_ANCESTOR))
        unknown = on_branch(replace(BRANCH, merged_ancestry=None))
        self.assertEqual(one(unknown, policy()), Skip("feature", SkipReason.UNKNOWN_ANCESTRY))

    # --- tip identity ----------------------------------------------------

    def test_missing_tip_blocks_both_remove_and_delete(self):
        for tip in (None, ""):
            with self.subTest(tip=tip):
                self.assertEqual(one(on_branch(replace(BRANCH, tip=tip)), policy()),
                                 Skip("feature", SkipReason.MISSING_TIP))
                orphan = on_branch(replace(BRANCH, tip=tip, worktree_bindings=()))
                self.assertEqual(one(orphan, policy()),
                                 Skip("feature", SkipReason.MISSING_TIP))

    def test_planned_actions_carry_the_expected_tip(self):
        self.assertEqual(one(SNAPSHOT, policy()).expected_tip, "abc123")
        self.assertEqual(one(on_branch(replace(BRANCH, worktree_bindings=())),
                             policy()).expected_tip, "abc123")

    # --- binding consistency ---------------------------------------------

    def test_duplicate_branch_entries_fail_closed(self):
        snapshot = replace(SNAPSHOT, branches=(BRANCH, BRANCH))
        actions = plan_cleanup(snapshot, policy()).actions
        self.assertEqual(actions, (Skip("feature", SkipReason.INCONSISTENT_BINDINGS),
                                   Skip("feature", SkipReason.INCONSISTENT_BINDINGS)))

    def test_same_path_bound_to_two_branches_fails_closed(self):
        other = replace(BRANCH, name="other",
                        worktree_bindings=(replace(BINDING, branch="other"),))
        snapshot = replace(SNAPSHOT, branches=(BRANCH, other))
        actions = plan_cleanup(snapshot, policy()).actions
        self.assertEqual(actions, (Skip("feature", SkipReason.INCONSISTENT_BINDINGS),
                                   Skip("other", SkipReason.INCONSISTENT_BINDINGS)))

    def test_foreign_branch_binding_fails_closed(self):
        foreign = on_branch(replace(BRANCH,
                                    worktree_bindings=(replace(BINDING, branch="other"),)))
        self.assertEqual(one(foreign, policy()),
                         Skip("feature", SkipReason.INCONSISTENT_BINDINGS))

    def test_unreadable_bindings_fail_closed_even_with_no_bindings(self):
        snapshot = on_branch(replace(BRANCH, worktree_bindings=()))
        snapshot = replace(snapshot, bindings_readable=False)
        self.assertEqual(one(snapshot, policy()), Skip("feature", SkipReason.BINDINGS_UNKNOWN))

    # --- path containment -------------------------------------------------

    def test_path_normalization_case_and_dot_segments(self):
        for path in ("c:\\WORKTREES\\.\\feature", "C:/worktrees/feature"):
            with self.subTest(path=path):
                action = one(on_binding(replace(BINDING, path=path)), policy())
                self.assertIsInstance(action, RemoveEligibleWorktree)
                self.assertEqual(action.path, path)  # emitted verbatim, not rewritten

    def test_path_rejects_windows_traversal_and_sibling_prefixes(self):
        bad = ("C:\\worktrees-old\\feature", "C:\\worktrees\\..\\outside",
               "C:\\worktrees\\feature\\..\\..\\outside", "C:\\worktrees")
        for path in bad:
            with self.subTest(path=path):
                self.assertEqual(one(on_binding(replace(BINDING, path=path)), policy()),
                                 Skip("feature", SkipReason.UNSAFE_PATH))

    def test_path_rejects_posix_traversal_sibling_and_root(self):
        posix_snapshot = replace(SNAPSHOT, allowed_worktree_root="/srv/worktrees")
        good = on_binding(replace(BINDING, path="/srv/worktrees/feature"), posix_snapshot)
        self.assertEqual(one(good, policy()),
                         RemoveEligibleWorktree("/srv/worktrees/feature", "feature", "abc123"))
        for path in ("/srv/worktrees/../outside", "/srv/worktrees-old/feature",
                     "/srv/worktrees", "/srv/worktrees/feature/../.."):
            with self.subTest(path=path):
                snapshot = on_binding(replace(BINDING, path=path), posix_snapshot)
                self.assertEqual(one(snapshot, policy()),
                                 Skip("feature", SkipReason.UNSAFE_PATH))

    def test_path_rejects_relative_drive_relative_and_cross_flavor(self):
        cases = ("worktrees\\feature", "C:feature", "worktrees/feature", "feature")
        for path in cases:
            with self.subTest(path=path):
                self.assertEqual(one(on_binding(replace(BINDING, path=path)), policy()),
                                 Skip("feature", SkipReason.UNSAFE_PATH))
        cross = on_binding(replace(BINDING, path="/srv/worktrees/feature"))
        self.assertEqual(one(cross, policy()), Skip("feature", SkipReason.UNSAFE_PATH))
        posix_snapshot = replace(SNAPSHOT, allowed_worktree_root="/srv/worktrees")
        cross = on_binding(replace(BINDING, path="C:\\worktrees\\feature"), posix_snapshot)
        self.assertEqual(one(cross, policy()), Skip("feature", SkipReason.UNSAFE_PATH))

    def test_path_accepts_trailing_separator_on_root(self):
        snapshot = replace(SNAPSHOT, allowed_worktree_root="C:\\worktrees\\")
        self.assertIsInstance(one(SNAPSHOT, policy()), RemoveEligibleWorktree)
        self.assertEqual(one(on_binding(BINDING, snapshot), policy()),
                         RemoveEligibleWorktree("C:\\worktrees\\feature", "feature", "abc123"))

    def test_empty_root_rejects_everything(self):
        snapshot = replace(SNAPSHOT, allowed_worktree_root="")
        self.assertEqual(one(snapshot, policy()), Skip("feature", SkipReason.UNSAFE_PATH))

    # --- structural guards ------------------------------------------------

    def test_module_imports_only_pure_stdlib(self):
        source = pathlib.Path(planner.__file__).read_text(encoding="utf-8")
        roots = set()
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Import):
                roots.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
        self.assertEqual(roots, {"__future__", "dataclasses", "datetime", "enum", "pathlib"})

    def test_module_has_no_io_or_execution_calls(self):
        """Inspect the code, not the prose, so docstrings cannot mask a real call."""
        tree = ast.parse(pathlib.Path(planner.__file__).read_text(encoding="utf-8"))
        names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
            elif isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module)
        forbidden = {
            "open", "exec", "eval", "__import__", "compile", "input",
            "system", "popen", "Popen", "check_output", "call", "run",
            "rmtree", "unlink", "remove", "rmdir", "mkdir", "rename",
            "urlopen", "socket", "connect", "getenv", "environ",
            "subprocess", "shutil", "requests", "urllib", "os", "sys",
        }
        self.assertEqual(names & forbidden, set())


if __name__ == "__main__":
    unittest.main()
