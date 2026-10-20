"""Classification helpers: pinned classes and declared cleanup intent.

Pure functions over a parsed ``Entry``. No cleanup action is planned here.
"""

from __future__ import annotations

from .model import Checkout, CleanupOwner, Entry
from .paths import is_gitbash_path, is_wsl_path


def special_classes(entry: Entry, checkout: Checkout | None) -> tuple[str, ...]:
    """All classes that must hold unless a human records an explicit exception.

    Every applicable class is returned, not just the first, so an archived WSL
    checkout reports both facts instead of hiding one behind another.
    """
    classes: set[str] = set()
    if entry.classification == "personal_thirdparty_fork":
        classes.add("thirdparty")
    if entry.eligibility == "thirdparty_personal_fork_excluded":
        classes.add("thirdparty")
    if entry.eligibility == "deployment_or_homelab_excluded":
        classes.add("deployment")
    if entry.archived or entry.eligibility == "archived_excluded":
        classes.add("archive")
    if checkout is None:
        classes.add("no_checkout")
    elif is_wsl_path(checkout.path):
        classes.add("unsupported_wsl")
    elif is_gitbash_path(checkout.path):
        classes.add("unsupported_gitbash")
    return tuple(sorted(classes))


def special_class(entry: Entry, checkout: Checkout | None) -> str | None:
    """The pinned-class label for one checkout, or None when nothing pins it."""
    classes = special_classes(entry, checkout)
    return "|".join(classes) if classes else None


def decide_cleanup_owner(entry: Entry) -> tuple[CleanupOwner, str]:
    """Declare cleanup intent only. No cleanup action is ever planned here."""
    if entry.cleanup_policy in ("excluded", "no_cleanup_profile"):
        return CleanupOwner.NONE, f"cleanup_policy:{entry.cleanup_policy}"
    return CleanupOwner.HOLD, "no_cleanup_apply:deferred_to_existing_pure_planner"
