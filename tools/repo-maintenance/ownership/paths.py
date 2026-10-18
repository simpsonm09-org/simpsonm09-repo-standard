"""Checkout-path flavor and normalization. Pure string handling, no I/O.

A Windows drive-letter or UNC path is case-insensitive, so it folds to lower case
with forward slashes. A POSIX path on a Windows fleet is genuinely
case-sensitive, so its case is preserved. Folding both would merge distinct
physical directories.
"""

from __future__ import annotations

import re

# Patterns stay strings: the module is inspected by a purity guard that rejects a
# bare `compile` name, and `re.match` compiles internally with its own cache.
_WINDOWS_DRIVE = r"^[A-Za-z]:[\\/]"
_GITBASH_MOUNT = r"^/[A-Za-z]/"
_CYGWIN_MOUNT = r"^/cygdrive/[A-Za-z]/"


def is_windows_path(path: str) -> bool:
    """True for a Windows drive-letter or UNC path."""
    return bool(path) and (
        bool(re.match(_WINDOWS_DRIVE, path)) or path.startswith("\\\\")
    )


def is_posix_path(path: str) -> bool:
    """True for an absolute POSIX path (single leading slash)."""
    return (
        bool(path)
        and path.startswith("/")
        and not path.startswith("//")
        and not re.match(_WINDOWS_DRIVE, path)
    )


def is_gitbash_path(path: str) -> bool:
    """True for a Git-Bash/MSYS/Cygwin mount such as ``/c/Users/...`` or ``/d/dev``."""
    return is_posix_path(path) and bool(
        re.match(_GITBASH_MOUNT, path) or re.match(_CYGWIN_MOUNT, path)
    )


def is_wsl_path(path: str) -> bool:
    """True for a genuine WSL POSIX path on a Windows fleet.

    A Git-Bash/MSYS mount is also undriveable, but it is a different genus and is
    named separately so the two are never conflated.
    """
    return is_posix_path(path) and not is_gitbash_path(path)


def normalize_path(path: str) -> str:
    """Stable key for a checkout path.

    Windows drive-letter and UNC paths are folded to lower case with forward
    slashes; POSIX paths keep their case and separators. See the module docstring.
    """
    replaced = path.replace("\\", "/").rstrip("/")
    if is_windows_path(path) or path.startswith("//"):
        return replaced.lower()
    return replaced
