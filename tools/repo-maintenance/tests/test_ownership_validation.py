"""Validation, boundary, coverage, and purity tests for the ownership planner.

The synthetic inventory below stands in for the private one: it exercises several
owner groups, a shared physical path, a third-party-parent canonical, and a
no-checkout record without hard-coding any real count. Nothing here reads an
external file or skips by environment.
"""

from __future__ import annotations

import ast
import pathlib
import unittest
from collections import Counter
from dataclasses import replace

import ownership as op

from .ownership_fixtures import (
    DEV_PATH,
    RUNNING,
    checkout,
    entry,
    parse,
    synthetic_inventory,
)


class ValidationTests(unittest.TestCase):
    def _base(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        return (e,), op.plan((e,), parse(None))

    def test_clean_plan_has_no_violations(self):
        entries, result = self._base()
        self.assertEqual(op.validate(result, entries), ())

    def test_validator_rejects_non_hold_with_unknown_evidence(self):
        entries, result = self._base()
        tampered = replace(
            result,
            checkout_decisions=(
                replace(
                    result.checkout_decisions[0],
                    local_default_writer=op.LocalWriter.MAINTENANCE,
                ),
            ),
        )
        self.assertTrue(
            any(
                "unknown evidence" in p or "maintenance writer" in p
                for p in op.validate(tampered, entries)
            )
        )

    def test_validator_rejects_apply_mode(self):
        entries, result = self._base()
        tampered = replace(result, mode="apply", apply_permitted=True)
        problems = op.validate(tampered, entries)
        self.assertTrue(any("mode" in p for p in problems))
        self.assertTrue(any("apply_permitted" in p for p in problems))

    def test_validator_detects_a_dropped_repo(self):
        entries, result = self._base()
        tampered = replace(result, repo_plans=())
        self.assertTrue(any("repo" in p for p in op.validate(tampered, entries)))

    def test_f8_validator_detects_a_dropped_checkout(self):
        entries, result = self._base()
        tampered = replace(result, checkout_decisions=())
        problems = op.validate(tampered, entries)
        self.assertTrue(any("coverage mismatch" in p for p in problems))

    def test_f4_validator_rejects_duplicate_full_names(self):
        # Repro R11.
        dupes = (
            entry(full_name="x/y", canonical="x/y", checkouts=(checkout("D:\\a"),)),
            entry(full_name="x/y", canonical="x/y", checkouts=(checkout("D:\\b"),)),
        )
        problems = op.validate(op.plan(dupes, parse(None)), dupes)
        self.assertTrue(any("duplicate inventory full_name" in p for p in problems))

    def test_plan_is_candidate_only(self):
        _, result = self._base()
        payload = op.plan_to_dict(result)
        self.assertEqual(payload["mode"], "candidate_only_no_apply")
        self.assertFalse(payload["apply_permitted"])
        self.assertNotIn("operations", payload)

    def test_validator_rejects_forged_fork_sync_maintenance(self):
        canonical = "org-alpha/widget"
        org = entry(full_name=canonical, canonical=canonical)
        fork = entry(
            full_name="owner-beta/widget",
            classification="personal_fork_of_owned_org",
            canonical=canonical,
            personal_fork="owner-beta/widget",
            parent_full_name=None,
            is_fork=True,
            scope="personal",
        )
        config = parse({"owned_accounts": ["org-alpha", "owner-beta"]})
        plan = op.plan((org, fork), config)
        forged = replace(
            plan,
            canonical_policies=(
                replace(
                    plan.canonical_policies[0],
                    fork_sync_owner=op.ForkSyncOwner.MAINTENANCE,
                    fork_members=(fork.full_name,),
                ),
            ),
        )
        problems = op.validate(forged, (org, fork))
        self.assertTrue(any("fork binding" in problem for problem in problems))


class ParseBoundaryTests(unittest.TestCase):
    def test_f1_parse_inventory_rejects_string_boolean(self):
        # Repro R9.
        doc = {
            "repositories": [
                {
                    "full_name": "org-alpha/x",
                    "archived": "false",
                    "fork": False,
                    "private": False,
                }
            ]
        }
        with self.assertRaises(ValueError):
            op.parse_inventory(doc)

    def test_f1_parse_inventory_rejects_null_boolean(self):
        doc = {
            "repositories": [
                {
                    "full_name": "org-alpha/x",
                    "fork": None,
                    "archived": False,
                    "private": False,
                }
            ]
        }
        with self.assertRaises(ValueError):
            op.parse_inventory(doc)

    def test_f1_parse_config_rejects_string_worker_flag(self):
        with self.assertRaises(ValueError):
            parse({"worker_local_writes_disabled": "false"})

    def test_f4_parse_inventory_rejects_duplicate_full_name(self):
        doc = {
            "repositories": [
                {"full_name": "org-alpha/x"},
                {"full_name": "org-alpha/x"},
            ]
        }
        with self.assertRaises(ValueError):
            op.parse_inventory(doc)


class SyntheticInventoryTests(unittest.TestCase):
    """Coverage and defaults over a synthetic inventory, never a fixed count."""

    @classmethod
    def setUpClass(cls):
        cls.entries = op.parse_inventory(synthetic_inventory())
        cls.result = op.plan(cls.entries, parse(None))

    def test_every_entry_is_planned_with_no_drops(self):
        self.assertEqual(len(self.entries), 8)
        self.assertEqual(len(self.result.repo_plans), 8)
        self.assertEqual(
            self.result.counts["owner_groups"],
            dict(Counter(e.owner_group for e in self.entries)),
        )
        self.assertEqual(
            self.result.counts["owner_groups"],
            {"org-alpha": 2, "owner-beta": 2, "owner-gamma": 2, "owner-delta": 2},
        )

    def test_canonical_groups_and_checkouts_are_derived_from_source(self):
        expected_canonicals = {e.canonical for e in self.entries}
        expected_paths = {
            op.normalize_path(c.path) for e in self.entries for c in e.checkouts
        }
        self.assertEqual(
            self.result.counts["canonical_groups"], len(expected_canonicals)
        )
        self.assertEqual(self.result.counts["checkouts"], len(expected_paths))
        self.assertEqual(len(self.result.canonical_policies), 7)
        self.assertEqual(len(self.result.checkout_decisions), 6)

    def test_private_and_personal_entries_are_retained(self):
        self.assertTrue(any(r.private for r in self.result.repo_plans))
        self.assertTrue(
            any(r.inventory_scope == "personal" for r in self.result.repo_plans)
        )

    def test_defaults_hold_everywhere(self):
        self.assertEqual(
            self.result.counts["local_default_writer"], {"hold": 8}
        )
        self.assertTrue(
            all(
                d.local_default_writer is op.LocalWriter.HOLD
                for d in self.result.checkout_decisions
            )
        )

    def test_shared_path_aggregates_records_and_conflicts_hold(self):
        shared = [
            d
            for d in self.result.checkout_decisions
            if op.normalize_path(d.checkout_path)
            == op.normalize_path("D:\\dev\\example\\shared")
        ]
        self.assertEqual(len(shared), 1)
        decision = shared[0]
        self.assertEqual(decision.canonical, "org-alpha/widget")
        self.assertEqual(len(decision.remote_urls), 2)
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(
            any(
                "conflicting_canonical_or_owner_identity" in r
                for r in decision.reasons
            )
        )

    def test_pinned_classes_hold_and_are_named(self):
        by_path = {
            op.normalize_path(d.checkout_path): d
            for d in self.result.checkout_decisions
        }
        deploy = by_path[op.normalize_path("D:\\dev\\example\\deploy")]
        self.assertIn("deployment", deploy.special_classes)
        legacy = by_path[op.normalize_path("D:\\dev\\example\\legacy")]
        self.assertIn("archive", legacy.special_classes)
        tp = by_path[op.normalize_path("D:\\dev\\example\\tp")]
        self.assertIn("thirdparty", tp.special_classes)
        wsl = by_path[op.normalize_path("/home/example/wsl-repo")]
        self.assertIn("unsupported_wsl", wsl.special_classes)

    def test_bridge_canonical_preserved_despite_thirdparty_parent(self):
        canonicals = {c.canonical for c in self.result.canonical_policies}
        self.assertIn("org-alpha/Archipelago", canonicals)
        self.assertNotIn("someone-else/bridgeipelago", canonicals)

    def test_plan_validates(self):
        self.assertEqual(op.validate(self.result, self.entries), ())


class ManifestCoverageTests(unittest.TestCase):
    def _plan(self):
        entries = op.parse_inventory(synthetic_inventory())
        return entries, op.plan(entries, parse(None))

    def _manifest(self, canonicals, checkouts):
        return {
            "entries": [
                {
                    "canonical": canonical,
                    "checkouts": [{"checkout": path} for path in checkouts],
                }
                for canonical in canonicals
            ]
        }

    def test_covered_manifest_has_no_violations(self):
        _, result = self._plan()
        manifest = self._manifest(
            ["org-alpha/widget", "org-alpha/Archipelago"],
            ["D:\\dev\\example\\shared", "D:\\dev\\example\\bridge"],
        )
        self.assertEqual(op.validate_manifest_coverage(result, manifest), ())

    def test_manifest_gap_is_reported(self):
        _, result = self._plan()
        manifest = self._manifest(
            ["org-alpha/missing"], ["D:\\dev\\example\\missing"]
        )
        problems = op.validate_manifest_coverage(result, manifest)
        self.assertTrue(any("canonical missing" in p for p in problems))
        self.assertTrue(any("checkout path missing" in p for p in problems))


class ProvenanceTests(unittest.TestCase):
    def _payload(self, doc=None):
        e = entry(checkouts=(checkout(DEV_PATH),))
        return op.plan_to_dict(op.plan((e,), parse(doc)))

    def test_default_provenance_hardcodes_no_local_version(self):
        prov = self._payload()["provenance"]
        self.assertIsNone(prov["t3_clone_version"])
        self.assertIsNone(prov["t3_clone_commit"])
        self.assertFalse(prov["t3_clone_equivalence_proven"])
        self.assertIsNone(prov["expected_running_version"])

    def test_caller_supplied_provenance_round_trips(self):
        prov = self._payload(
            {
                "source_label": "synthetic-inventory",
                "reviewed_clone_version": "9.9.9",
                "reviewed_clone_commit": "abc1234",
                "current_server_version": RUNNING,
            }
        )["provenance"]
        self.assertEqual(prov["source"], "synthetic-inventory")
        self.assertEqual(prov["t3_clone_version"], "9.9.9")
        self.assertEqual(prov["t3_clone_commit"], "abc1234")
        self.assertEqual(prov["expected_running_version"], RUNNING)


class PurityTests(unittest.TestCase):
    """The package is a pure library: stdlib-only imports and no I/O calls."""

    def _sources(self):
        package = pathlib.Path(op.__file__).parent
        return {
            path.name: path.read_text(encoding="utf-8")
            for path in sorted(package.glob("*.py"))
        }

    def test_package_imports_only_pure_stdlib(self):
        roots = set()
        for source in self._sources().values():
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, ast.Import):
                    roots.update(alias.name.split(".")[0] for alias in node.names)
                elif (
                    isinstance(node, ast.ImportFrom)
                    and node.level == 0
                    and node.module
                ):
                    roots.add(node.module.split(".")[0])
        self.assertEqual(
            roots,
            {"__future__", "collections", "dataclasses", "datetime", "enum", "re", "typing"},
        )

    def test_package_has_no_io_or_execution_calls(self):
        """Inspect the code, not the prose, so docstrings cannot mask a real call."""
        names: set[str] = set()
        for source in self._sources().values():
            for node in ast.walk(ast.parse(source)):
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
    unittest.main(verbosity=2)
