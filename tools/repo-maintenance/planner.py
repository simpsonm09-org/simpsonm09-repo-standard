"""Pure, fail-closed cleanup eligibility planner. This module performs no I/O.

The planner turns an immutable `Snapshot` plus a `Policy` into typed eligibility
actions. It holds no executor: no subprocess, no network, no Git, no credential
handling, and no filesystem reads or writes. An action records a claim the
snapshot supported; it is not an authorization to delete anything, and a future
executor must re-observe live state before it acts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import PurePosixPath, PureWindowsPath


class CleanupOwner(str, Enum):
    T3 = "t3"
    MAINTENANCE = "maintenance"


class ActivityFreshness(str, Enum):
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"


class ActivityBinding(str, Enum):
    UNBOUND = "unbound"
    BOUND = "bound"
    UNKNOWN = "unknown"


class ActivitySettlement(str, Enum):
    SETTLED = "settled"
    RUNNING = "running"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class T3Activity:
    """T3 session evidence. Only explicit fresh/unbound/settled clears the gate.

    Callers with timestamp evidence should build this value with
    :func:`evaluate_t3_activity`. Direct construction remains supported for
    existing snapshot producers and still represents producer-supplied claims.
    """

    freshness: ActivityFreshness
    binding: ActivityBinding
    settlement: ActivitySettlement


def _parse_activity_time(observed_at: datetime | str | None) -> datetime | None:
    if isinstance(observed_at, datetime):
        return observed_at
    if not isinstance(observed_at, str):
        return None
    try:
        value = observed_at[:-1] + "+00:00" if observed_at.endswith(("Z", "z")) else observed_at
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _is_aware(value: datetime) -> bool:
    try:
        return value.tzinfo is not None and value.utcoffset() is not None
    except (OverflowError, TypeError, ValueError):
        return False


def _activity_enum(value: object, enum_type: type[ActivityBinding | ActivitySettlement]):
    if isinstance(value, enum_type):
        return value
    if isinstance(value, str):
        try:
            return enum_type(value)
        except ValueError:
            return enum_type.UNKNOWN
    return enum_type.UNKNOWN


def evaluate_t3_activity(
    observed_at: datetime | str | None,
    now: datetime,
    max_age: timedelta,
    binding: ActivityBinding | str | None,
    settlement: ActivitySettlement | str | None,
) -> T3Activity:
    """Derive T3 freshness and preserve binding and settlement evidence.

    Freshness is inclusive at the maximum-age boundary: an observation exactly
    ``max_age`` old is fresh. Naive, malformed, missing, future, or otherwise
    invalid time evidence and invalid bounds produce UNKNOWN. A valid timestamp
    older than ``max_age`` produces STALE. Timestamps are compared in UTC.
    Binding and settlement values are parsed independently; missing or malformed
    values become UNKNOWN so the cleanup planner continues to hold them.
    """
    freshness = ActivityFreshness.UNKNOWN
    timestamp = _parse_activity_time(observed_at)
    if (timestamp is not None and isinstance(now, datetime)
            and isinstance(max_age, timedelta) and max_age >= timedelta(0)
            and _is_aware(timestamp) and _is_aware(now)):
        try:
            observed_utc = timestamp.astimezone(timezone.utc)
            now_utc = now.astimezone(timezone.utc)
            age = now_utc - observed_utc
            if age < timedelta(0):
                freshness = ActivityFreshness.UNKNOWN
            elif age <= max_age:
                freshness = ActivityFreshness.FRESH
            else:
                freshness = ActivityFreshness.STALE
        except (OverflowError, TypeError, ValueError):
            freshness = ActivityFreshness.UNKNOWN

    return T3Activity(
        freshness,
        _activity_enum(binding, ActivityBinding),
        _activity_enum(settlement, ActivitySettlement),
    )


def evaluate_t3_observation(
    record: dict[str, object],
    now: datetime,
    max_age: timedelta,
) -> T3Activity:
    """Evaluate a closed JSON-like observation record as T3 activity evidence.

    The record must contain exactly ``observed_at``, ``binding``, and
    ``settlement``, each as a string. Freshness is always derived by
    :func:`evaluate_t3_activity`; serialized freshness claims are rejected.
    This is a pure input boundary, not a real T3 schema or provenance check.
    """
    fields = {"observed_at", "binding", "settlement"}
    if (type(record) is not dict or record.keys() != fields
            or any(type(value) is not str for value in record.values())):
        return T3Activity(
            ActivityFreshness.UNKNOWN,
            ActivityBinding.UNKNOWN,
            ActivitySettlement.UNKNOWN,
        )

    return evaluate_t3_activity(
        record["observed_at"], now, max_age, record["binding"], record["settlement"]
    )


@dataclass(frozen=True)
class WorktreeBinding:
    path: str
    branch: str | None
    dirty_tracked: bool
    has_untracked: bool
    has_ignored: bool
    locked: bool
    detached: bool
    is_main: bool
    activity: T3Activity


@dataclass(frozen=True)
class BranchSnapshot:
    name: str
    tip: str | None
    exists: bool
    is_default: bool
    protected: bool
    merged_ancestry: bool | None
    last_activity: datetime | None
    worktree_bindings: tuple[WorktreeBinding, ...]
    detached: bool = False
    deployment: bool = False
    activity: T3Activity | None = None


@dataclass(frozen=True)
class Snapshot:
    branches: tuple[BranchSnapshot, ...]
    default_branch: str
    bindings_readable: bool
    allowed_worktree_root: str
    is_deployment: bool = False
    is_archived: bool = False


@dataclass(frozen=True)
class Policy:
    now: datetime
    retention: timedelta = timedelta(days=3)
    cleanup_owner: CleanupOwner = CleanupOwner.T3
    maintenance_t3_cleanup_disabled: bool = False


class SkipReason(str, Enum):
    ALREADY_GONE = "already-gone"
    DEFAULT_BRANCH = "default-branch"
    PROTECTED = "protected"
    DETACHED = "detached"
    MAIN_WORKTREE = "main-worktree"
    DEPLOYMENT = "deployment"
    ARCHIVED = "archived"
    NOT_ANCESTOR = "tip-not-merged-ancestor"
    UNKNOWN_ANCESTRY = "ancestry-unknown"
    MISSING_TIP = "branch-tip-missing"
    TOO_RECENT = "inside-retention-window"
    INVALID_ACTIVITY_TIME = "activity-time-missing-naive-or-future"
    ACTIVITY_UNKNOWN = "activity-unknown-or-stale"
    ACTIVITY_BOUND = "activity-bound-or-running"
    BINDINGS_UNKNOWN = "worktree-bindings-unreadable"
    INCONSISTENT_BINDINGS = "worktree-bindings-duplicated-or-inconsistent"
    CHECKED_OUT_ELSEWHERE = "branch-checked-out-elsewhere"
    UNSAFE_PATH = "worktree-path-unsafe-or-outside-root"
    DIRTY_TRACKED = "worktree-has-tracked-changes"
    UNTRACKED = "worktree-has-untracked-files"
    IGNORED = "worktree-has-ignored-files"
    LOCKED = "worktree-locked"
    T3_OWNS_WORKTREE = "t3-owns-worktree-cleanup"
    T3_CLEANUP_NOT_DISABLED = "t3-cleanup-not-explicitly-disabled"
    MISSING_ACTIVITY = "activity-evidence-missing"


@dataclass(frozen=True)
class Skip:
    branch: str
    reason: SkipReason


@dataclass(frozen=True)
class RemoveEligibleWorktree:
    """A worktree the snapshot marked eligible for removal.

    `expected_tip` pins the commit the branch pointed at when the snapshot was
    taken, so a future executor can re-check identity before acting.
    """

    path: str
    branch: str
    expected_tip: str


@dataclass(frozen=True)
class DeleteBranch:
    branch: str
    expected_tip: str


Action = Skip | RemoveEligibleWorktree | DeleteBranch


@dataclass(frozen=True)
class CleanupPlan:
    actions: tuple[Action, ...]


def _activity_problem(activity: T3Activity | None) -> SkipReason | None:
    if activity is None:
        return SkipReason.MISSING_ACTIVITY
    if (activity.freshness is not ActivityFreshness.FRESH
            or activity.binding is ActivityBinding.UNKNOWN
            or activity.settlement is ActivitySettlement.UNKNOWN):
        return SkipReason.ACTIVITY_UNKNOWN
    if (activity.binding is not ActivityBinding.UNBOUND
            or activity.settlement is not ActivitySettlement.SETTLED):
        return SkipReason.ACTIVITY_BOUND
    return None


def _path_flavor(path: str) -> str:
    return "windows" if "\\" in path or PureWindowsPath(path).drive else "posix"


def _normalized(path: str, flavor: str) -> str | None:
    """Normalize an absolute path, rejecting traversal before normalization.

    Comparison only. Emitted paths stay verbatim; an executor must re-canonicalize.
    """
    if flavor == "windows":
        p = PureWindowsPath(path)
        if not p.is_absolute() or ".." in p.parts:
            return None
        return str(PureWindowsPath(*p.parts)).casefold().rstrip("\\")
    p = PurePosixPath(path)
    if not p.is_absolute() or ".." in p.parts:
        return None
    return str(PurePosixPath(*p.parts)).rstrip("/") or "/"


def _inside_root(path: str, root: str) -> bool:
    """True only for a strict descendant of `root` in the same path flavor."""
    flavor = _path_flavor(root)
    if _path_flavor(path) != flavor:
        return False
    child = _normalized(path, flavor)
    parent = _normalized(root, flavor)
    if child is None or parent is None or child == parent:
        return False
    root_path = PureWindowsPath(root) if flavor == "windows" else PurePosixPath(root)
    if root_path.parent == root_path:
        return False
    separator = "\\" if flavor == "windows" else "/"
    return child.startswith(parent.rstrip(separator) + separator)


def _time_problem(activity_at: datetime | None, policy: Policy) -> SkipReason | None:
    """Judge the retention clock. Only branch activity time counts, never a merge tip."""
    if activity_at is None or policy.now.tzinfo is None:
        return SkipReason.INVALID_ACTIVITY_TIME
    if activity_at.tzinfo is None or activity_at > policy.now:
        return SkipReason.INVALID_ACTIVITY_TIME
    if activity_at > policy.now - policy.retention:
        return SkipReason.TOO_RECENT
    return None


def _inconsistent_branches(snapshot: Snapshot) -> frozenset[str]:
    """Branch names whose binding evidence is duplicated or mutually contradictory."""
    flagged: set[str] = set()

    seen_names: set[str] = set()
    for branch in snapshot.branches:
        if branch.name in seen_names:
            flagged.add(branch.name)
        seen_names.add(branch.name)

    path_owners: dict[str, set[str]] = {}
    for branch in snapshot.branches:
        for binding in branch.worktree_bindings:
            if binding.branch != branch.name:
                flagged.add(branch.name)
            flavor = _path_flavor(binding.path)
            canonical = _normalized(binding.path, flavor)
            key = f"{flavor}:{canonical if canonical is not None else binding.path.casefold()}"
            path_owners.setdefault(key, set()).add(branch.name)

    for owners in path_owners.values():
        if len(owners) > 1:
            flagged.update(owners)
    return frozenset(flagged)


def plan_cleanup(snapshot: Snapshot, policy: Policy) -> CleanupPlan:
    """Return typed eligibility actions. Never executes cleanup operations."""
    if policy.retention < timedelta(0):
        raise ValueError("retention must not be negative")

    inconsistent = _inconsistent_branches(snapshot)
    actions: list[Action] = []

    for branch in snapshot.branches:
        if not branch.exists:
            actions.append(Skip(branch.name, SkipReason.ALREADY_GONE))
            continue

        # Scope and protection reasons are reported first: they hold on their own
        # and do not depend on binding evidence being trustworthy.
        if snapshot.is_archived:
            reason: SkipReason | None = SkipReason.ARCHIVED
        elif snapshot.is_deployment or branch.deployment:
            reason = SkipReason.DEPLOYMENT
        elif branch.is_default or branch.name == snapshot.default_branch:
            reason = SkipReason.DEFAULT_BRANCH
        elif branch.protected:
            reason = SkipReason.PROTECTED
        elif branch.detached:
            reason = SkipReason.DETACHED
        elif branch.name in inconsistent:
            reason = SkipReason.INCONSISTENT_BINDINGS
        elif branch.merged_ancestry is None:
            reason = SkipReason.UNKNOWN_ANCESTRY
        elif branch.merged_ancestry is not True:
            reason = SkipReason.NOT_ANCESTOR
        elif not snapshot.bindings_readable:
            reason = SkipReason.BINDINGS_UNKNOWN
        else:
            reason = _time_problem(branch.last_activity, policy)
        if reason is None:
            reason = _activity_problem(branch.activity)

        if reason is not None:
            actions.append(Skip(branch.name, reason))
            continue

        # A planned action must be pinned to a known commit, so a missing tip
        # blocks both branch deletion and worktree removal.
        if not branch.tip:
            actions.append(Skip(branch.name, SkipReason.MISSING_TIP))
            continue

        bindings = tuple(b for b in branch.worktree_bindings if b.branch == branch.name)
        if len(bindings) > 1:
            actions.append(Skip(branch.name, SkipReason.CHECKED_OUT_ELSEWHERE))
            continue
        if not bindings:
            actions.append(DeleteBranch(branch.name, branch.tip))
            continue

        binding = bindings[0]
        if binding.is_main:
            actions.append(Skip(branch.name, SkipReason.MAIN_WORKTREE))
        elif binding.detached:
            actions.append(Skip(branch.name, SkipReason.DETACHED))
        elif not _inside_root(binding.path, snapshot.allowed_worktree_root):
            actions.append(Skip(branch.name, SkipReason.UNSAFE_PATH))
        elif binding.locked:
            actions.append(Skip(branch.name, SkipReason.LOCKED))
        elif binding.dirty_tracked:
            actions.append(Skip(branch.name, SkipReason.DIRTY_TRACKED))
        elif binding.has_untracked:
            actions.append(Skip(branch.name, SkipReason.UNTRACKED))
        elif binding.has_ignored:
            actions.append(Skip(branch.name, SkipReason.IGNORED))
        else:
            binding_problem = _activity_problem(binding.activity)
            if binding_problem is not None:
                actions.append(Skip(branch.name, binding_problem))
            elif policy.cleanup_owner is CleanupOwner.T3:
                actions.append(Skip(branch.name, SkipReason.T3_OWNS_WORKTREE))
            elif not policy.maintenance_t3_cleanup_disabled:
                actions.append(Skip(branch.name, SkipReason.T3_CLEANUP_NOT_DISABLED))
            else:
                actions.append(
                    RemoveEligibleWorktree(binding.path, branch.name, branch.tip)
                )

    return CleanupPlan(tuple(actions))
