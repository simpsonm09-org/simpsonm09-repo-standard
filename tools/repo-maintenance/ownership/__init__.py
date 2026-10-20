"""Pure, offline ownership-policy planner for the fleet-maintenance inventory.

This package is side-effect free. It reads no files, opens no sockets, spawns no
processes, and touches no live settings, tasks, WSL, or Git repositories. Callers
parse JSON at the boundary and hand plain data to :func:`plan`; the planner only
rearranges that data into an explicit, fail-closed ownership policy.

It deliberately does NOT emit a ready-to-apply runtime config. Every decision is a
candidate held by default. The single source of truth for effective T3 autoPull is
the operator's supported Settings UI per-project override. Nothing a clone or a
capability probe reports can mark it verified, and no programmatic read is trusted.

Boundary honesty: this is a planner, not an authenticity proof. An operator's
recorded observation is an assertion, not a verified fact. Before any future apply
step, the running server must be validated live; nothing here does that.

The modules are split by concern:

- :mod:`ownership.model` -- the immutable data types and the shared constants.
- :mod:`ownership.paths` -- checkout-path flavor and normalization.
- :mod:`ownership.evidence` -- evidence sanitization and freshness derivation.
- :mod:`ownership.parsing` -- inventory and config boundary parsing.
- :mod:`ownership.classification` -- pinned classes and declared cleanup intent.
- :mod:`ownership.decision` -- checkout and fork-sync decisions.
- :mod:`ownership.planner` -- grouping, counting, and provenance.
- :mod:`ownership.validation` -- coverage and fail-closed invariants.
- :mod:`ownership.serialization` -- the candidate JSON shape.
"""

from __future__ import annotations

from .classification import decide_cleanup_owner, special_class, special_classes
from .decision import decide_fork_sync, remote_repo
from .evidence import sanitize_evidence
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
    Effective,
    Entry,
    Evidence,
    Exception_,
    ForkSyncOwner,
    LocalWriter,
    Plan,
    PolicyConfig,
    RepoPlan,
    VerificationContext,
)
from .parsing import parse_config, parse_inventory
from .paths import (
    is_gitbash_path,
    is_posix_path,
    is_windows_path,
    is_wsl_path,
    normalize_path,
)
from .planner import plan
from .serialization import plan_to_dict
from .validation import validate, validate_manifest_coverage

__all__ = [
    "ALLOWED_VERIFIED_EVIDENCE_SOURCES",
    "APPLY_PERMITTED",
    "MODE_CANDIDATE_ONLY",
    "POLICY_SCHEMA",
    "REVIEWED_CLONE_EQUIVALENCE_PROVEN",
    "CanonicalPolicy",
    "Checkout",
    "CheckoutDecision",
    "CleanupOwner",
    "Effective",
    "Entry",
    "Evidence",
    "Exception_",
    "ForkSyncOwner",
    "LocalWriter",
    "Plan",
    "PolicyConfig",
    "RepoPlan",
    "VerificationContext",
    "decide_cleanup_owner",
    "decide_fork_sync",
    "is_gitbash_path",
    "is_posix_path",
    "is_windows_path",
    "is_wsl_path",
    "normalize_path",
    "parse_config",
    "parse_inventory",
    "plan",
    "plan_to_dict",
    "remote_repo",
    "sanitize_evidence",
    "special_class",
    "special_classes",
    "validate",
    "validate_manifest_coverage",
]
