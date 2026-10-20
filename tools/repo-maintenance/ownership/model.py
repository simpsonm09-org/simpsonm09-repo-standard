"""Immutable data types for the ownership-policy planner.

The caller assembles these values from its own observation and parses JSON at the
boundary. The planner only rearranges them. Nothing here reads a file, opens a
socket, runs Git, or touches live settings.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from .paths import normalize_path

POLICY_SCHEMA = "fleet-ownership-policy/candidate/1"
MODE_CANDIDATE_ONLY = "candidate_only_no_apply"

# Applying this policy is out of scope by construction. There is no runtime-config
# writer in this artifact, and this constant exists so a validator can prove that.
APPLY_PERMITTED = False

# Equivalence between the reviewed T3 clone and the running build is not proven by
# anything here. Neither the reviewed version nor the running server version is a
# constant: the caller supplies them, and the core never hard-codes a machine's
# version.
REVIEWED_CLONE_EQUIVALENCE_PROVEN = False

# The only evidence source that may set verified=true. A human reading the
# per-project autoPull override in the supported Settings UI. A clone read is not
# equivalent, and a capability probe does not expose the effective value.
ALLOWED_VERIFIED_EVIDENCE_SOURCES = frozenset({"operator_ui_override"})

# Generic fallback when the caller supplies no source label.
DEFAULT_SOURCE_LABEL = "unspecified-inventory"


class LocalWriter(str, Enum):
    """Who may write the local default branch of a checkout."""

    HOLD = "hold"
    T3 = "t3"
    MAINTENANCE = "maintenance"


class ForkSyncOwner(str, Enum):
    """Who may synchronize a personal fork from its owned canonical."""

    HOLD = "hold"
    MAINTENANCE = "maintenance"
    NONE = "none"


class CleanupOwner(str, Enum):
    """Declared cleanup owner. No cleanup action is planned by this artifact."""

    HOLD = "hold"
    T3 = "t3"
    MAINTENANCE = "maintenance"
    NONE = "none"


class Effective(str, Enum):
    """Observed effective T3 autoPull value for one checkout (or canonical)."""

    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class Checkout:
    path: str
    url: str | None
    branch: str | None
    direction: str | None


@dataclass(frozen=True)
class Entry:
    """One inventory record. One record is one repository namespace entry."""

    full_name: str
    inventory_scope: str
    classification: str
    canonical: str
    personal_fork: str | None
    parent_full_name: str | None
    is_fork: bool
    archived: bool
    private: bool
    default_branch: str | None
    eligibility: str
    cleanup_policy: str
    coverage: str
    checkouts: tuple[Checkout, ...]

    @property
    def owner_group(self) -> str:
        return self.full_name.split("/", 1)[0]


@dataclass(frozen=True)
class VerificationContext:
    """Explicit, injected verification inputs. Nothing defaults to "trusted"."""

    now: datetime | None = None
    max_age: timedelta | None = None
    current_server_version: str | None = None


@dataclass(frozen=True)
class Evidence:
    """Observed effective T3 autoPull evidence, not the legacy aggregate field."""

    observed: Effective = Effective.UNKNOWN
    source: str = "none"
    version: str | None = None
    observed_at: str | None = None
    fresh: bool = False
    verified: bool = False
    verification_note: str | None = None

    def usable_false(self) -> bool:
        return self.observed is Effective.FALSE and self.verified and self.fresh

    def usable_true(self) -> bool:
        return self.observed is Effective.TRUE and self.verified and self.fresh


@dataclass(frozen=True)
class Exception_:
    """An explicit human exception recorded against a pinned class or checkout.

    Only a checkout-scoped exception may lift a pin. A canonical-scoped exception
    is recorded and reported but never lifts the pin on a physical checkout.
    """

    reason: str
    lift_pin: bool = False


@dataclass(frozen=True)
class PolicyConfig:
    """Operator-supplied inputs. Everything defaults to the fail-closed choice."""

    owned_accounts: frozenset[str] = frozenset()
    approved_dev_checkouts: frozenset[str] = frozenset()
    worker_local_writes_disabled: bool | None = None
    current_server_version: str | None = None
    source_label: str = DEFAULT_SOURCE_LABEL
    reviewed_clone_version: str | None = None
    reviewed_clone_commit: str | None = None
    evidence_by_checkout: Mapping[str, Evidence] = None  # type: ignore[assignment]
    evidence_by_canonical: Mapping[str, Evidence] = None  # type: ignore[assignment]
    exceptions_by_checkout: Mapping[str, Exception_] = None  # type: ignore[assignment]
    exceptions_by_canonical: Mapping[str, Exception_] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        for name in (
            "evidence_by_checkout",
            "evidence_by_canonical",
            "exceptions_by_checkout",
            "exceptions_by_canonical",
        ):
            if getattr(self, name) is None:
                object.__setattr__(self, name, {})

    def checkout_evidence(self, checkout_path: str) -> Evidence:
        return self.evidence_by_checkout.get(normalize_path(checkout_path), Evidence())

    def canonical_evidence(self, canonical: str) -> Evidence:
        return self.evidence_by_canonical.get(canonical, Evidence())

    def checkout_exception(self, checkout_path: str) -> Exception_ | None:
        return self.exceptions_by_checkout.get(normalize_path(checkout_path))

    def canonical_exception(self, canonical: str) -> Exception_ | None:
        return self.exceptions_by_canonical.get(canonical)


@dataclass(frozen=True)
class CanonicalPolicy:
    canonical: str
    owner_group: str
    kind: str
    archived: bool
    private: bool
    members: tuple[str, ...]
    fork_members: tuple[str, ...]
    fork_sync_owner: ForkSyncOwner
    fork_sync_reasons: tuple[str, ...]
    cleanup_owner: CleanupOwner
    cleanup_reason: str
    notes: tuple[str, ...]


@dataclass(frozen=True)
class CheckoutDecision:
    checkout_path: str
    canonical: str
    canonicals: tuple[str, ...]
    owner_group: str
    remote_url: str | None
    remote_urls: tuple[str, ...]
    branch: str | None
    special_class: str | None
    special_classes: tuple[str, ...]
    exception_recorded: bool
    approved_dev_checkout: bool
    evidence: Evidence
    local_default_writer: LocalWriter
    reasons: tuple[str, ...]
    required_actions: tuple[str, ...]


@dataclass(frozen=True)
class RepoPlan:
    full_name: str
    owner_group: str
    inventory_scope: str
    classification: str
    canonical: str
    is_fork: bool
    parent_full_name: str | None
    archived: bool
    private: bool
    eligibility: str
    cleanup_policy: str
    coverage: str
    local_default_writer: LocalWriter
    fork_sync_owner: ForkSyncOwner
    cleanup_owner: CleanupOwner
    checkout_paths: tuple[str, ...]
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class Plan:
    schema: str
    mode: str
    apply_permitted: bool
    provenance: Mapping[str, Any]
    worker_local_writes_disabled: bool | None
    owned_accounts: tuple[str, ...]
    canonical_policies: tuple[CanonicalPolicy, ...]
    repo_plans: tuple[RepoPlan, ...]
    checkout_decisions: tuple[CheckoutDecision, ...]
    counts: Mapping[str, Any]
