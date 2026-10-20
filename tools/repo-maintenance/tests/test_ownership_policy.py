"""Evidence, writer, pin, and path tests for the pure ownership planner.

Pure: no network, no Git, no settings, no subprocess, no credentials, and no file
read. Every fixture is synthetic. Each `f1`..`f6` test names the review finding it
reproduces.
"""

from __future__ import annotations

import unittest

import ownership as op

from .ownership_fixtures import (
    DEV_PATH,
    MAX_AGE,
    NOW,
    RUNNING,
    checkout,
    entry,
    evidence,
    parse,
    sctx,
    unlock_doc,
)


class EvidenceBoundaryTests(unittest.TestCase):
    def test_clone_source_can_never_verify(self):
        ev = op.sanitize_evidence(
            evidence(observed="true", source="clone_read", version=RUNNING)
        )
        self.assertFalse(ev.verified)
        self.assertFalse(ev.usable_true())
        self.assertIn("downgraded", ev.verification_note)

    def test_unknown_observation_is_never_verified_or_fresh(self):
        ev = op.sanitize_evidence(evidence(observed="unknown"))
        self.assertEqual(ev.observed, op.Effective.UNKNOWN)
        self.assertFalse(ev.verified)
        self.assertFalse(ev.fresh)

    def test_stale_evidence_is_unusable(self):
        ev = op.sanitize_evidence(evidence(observed_at="1999-01-01T00:00:00Z"), sctx())
        self.assertFalse(ev.usable_false())
        self.assertFalse(ev.fresh)
        self.assertIn("stale", ev.verification_note)

    def test_f1_string_verified_is_not_true(self):
        # Repro R1: "verified": "false" must not coerce to True.
        ev = op.sanitize_evidence(evidence(verified="false"))
        self.assertFalse(ev.verified)
        self.assertFalse(ev.usable_false())
        self.assertIn("boolean", ev.verification_note)

    def test_f1_self_attested_fresh_is_ignored(self):
        # Repro R2: fresh is derived from observed_at, never trusted from input.
        raw = evidence()
        raw["fresh"] = True
        raw.pop("observed_at")
        ev = op.sanitize_evidence(raw)
        self.assertFalse(ev.fresh)
        self.assertFalse(ev.usable_false())

    def test_f1_future_observed_at_rejected(self):
        ev = op.sanitize_evidence(evidence(observed_at="2027-01-01T00:00:00Z"), sctx())
        self.assertFalse(ev.fresh)
        self.assertIn("future", ev.verification_note)

    def test_f1_naive_observed_at_rejected(self):
        ev = op.sanitize_evidence(evidence(observed_at="2026-10-18T06:00:00"), sctx())
        self.assertFalse(ev.fresh)
        self.assertIn("timezone", ev.verification_note)

    def test_f1_version_mismatch_cannot_verify_running_build(self):
        # Repro R3: a clone version must not verify the configured running build.
        ev = op.sanitize_evidence(evidence(observed="true", version="0.0.45"), sctx())
        self.assertFalse(ev.verified)
        self.assertFalse(ev.usable_true())
        self.assertIn("does not match", ev.verification_note)

    def test_f1_missing_configured_version_cannot_verify(self):
        ev = op.sanitize_evidence(
            evidence(observed="true"),
            op.VerificationContext(
                now=NOW, max_age=MAX_AGE, current_server_version=None
            ),
        )
        self.assertFalse(ev.verified)

    def test_f1_missing_horizon_is_not_fresh(self):
        ev = op.sanitize_evidence(evidence(observed="true"))
        self.assertFalse(ev.fresh)


class LocalWriterTests(unittest.TestCase):
    def test_unknown_evidence_fails_closed_on_a_clean_default_branch(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        result = op.plan((e,), parse(None))
        decision = result.checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)
        self.assertEqual(decision.evidence.observed, op.Effective.UNKNOWN)
        self.assertIn("fail_closed", decision.reasons)

    def test_maintenance_requires_false_verified_fresh_and_approval(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        decision = op.plan((e,), parse(unlock_doc())).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.MAINTENANCE)

    def test_maintenance_refused_without_approval(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        doc = unlock_doc()
        doc["approved_dev_checkouts"] = []
        decision = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)
        self.assertIn("not_approved_dev_checkout", decision.reasons)

    def test_t3_requires_true_verified_and_disabled_worker_writes(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        doc = {
            "worker_local_writes_disabled": True,
            "current_server_version": RUNNING,
            "evidence": {"checkouts": {DEV_PATH: evidence("true")}},
        }
        decision = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.T3)

    def test_t3_refused_when_worker_writes_are_not_disabled(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        doc = {
            "worker_local_writes_disabled": False,
            "current_server_version": RUNNING,
            "evidence": {"checkouts": {DEV_PATH: evidence("true")}},
        }
        decision = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)
        self.assertIn("worker_local_writes_not_disabled", decision.reasons)

    def test_f1_string_evidence_does_not_unlock_end_to_end(self):
        # Repro R1 end-to-end: a string-typed verified/fresh must not unlock.
        e = entry(checkouts=(checkout(DEV_PATH),))
        raw = evidence()
        raw["verified"] = "false"
        raw["fresh"] = "false"
        doc = {
            "approved_dev_checkouts": [DEV_PATH],
            "worker_local_writes_disabled": False,
            "current_server_version": RUNNING,
            "evidence": {"checkouts": {DEV_PATH: raw}},
        }
        decision = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)

    def test_f1_version_mismatch_does_not_unlock_t3(self):
        # Repro R3 end-to-end.
        e = entry(checkouts=(checkout(DEV_PATH),))
        doc = {
            "worker_local_writes_disabled": True,
            "current_server_version": RUNNING,
            "evidence": {"checkouts": {DEV_PATH: evidence("true", version="0.0.45")}},
        }
        decision = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(decision.local_default_writer, op.LocalWriter.HOLD)


class PinTests(unittest.TestCase):
    def _pinned(self, config_doc, **over):
        e = entry(checkouts=(checkout(DEV_PATH),), **over)
        return op.plan((e,), parse(config_doc)).checkout_decisions[0]

    def test_deployment_holds_even_with_otherwise_eligible_evidence(self):
        d = self._pinned(unlock_doc(), eligibility="deployment_or_homelab_excluded")
        self.assertIn("deployment", d.special_classes)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)

    def test_archive_holds(self):
        d = self._pinned(unlock_doc(), archived=True, eligibility="archived_excluded")
        self.assertIn("archive", d.special_classes)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)

    def test_thirdparty_holds(self):
        d = self._pinned(
            unlock_doc(),
            classification="personal_thirdparty_fork",
            parent_full_name="someone-else/upstream",
        )
        self.assertEqual(d.special_class, "thirdparty")
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)

    def test_wsl_path_holds_and_is_named(self):
        path = "/home/example/wsl-repo"
        e = entry(
            full_name="org-alpha/wsl-repo",
            checkouts=(checkout(path, branch="patches"),),
        )
        d = op.plan((e,), parse(unlock_doc(path))).checkout_decisions[0]
        self.assertTrue(op.is_wsl_path(path))
        self.assertEqual(d.special_class, "unsupported_wsl")
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)

    def test_f7_gitbash_mount_is_named_not_wsl(self):
        path = "/d/dev/x"
        self.assertTrue(op.is_gitbash_path(path))
        self.assertFalse(op.is_wsl_path(path))
        e = entry(checkouts=(checkout(path),))
        d = op.plan((e,), parse(None)).checkout_decisions[0]
        self.assertEqual(d.special_class, "unsupported_gitbash")

    def test_f7_all_classes_are_reported(self):
        classes = op.special_classes(
            entry(archived=True, eligibility="archived_excluded"),
            checkout("/home/example/proj"),
        )
        self.assertIn("archive", classes)
        self.assertIn("unsupported_wsl", classes)

    def test_explicit_exception_is_recorded_and_still_holds_on_unknown_evidence(self):
        e = entry(
            checkouts=(checkout(DEV_PATH),),
            archived=True,
            eligibility="archived_excluded",
        )
        config = parse(
            {
                "exceptions": {
                    "checkouts": {DEV_PATH: {"reason": "human reviewed", "lift_pin": True}}
                }
            }
        )
        d = op.plan((e,), config).checkout_decisions[0]
        self.assertTrue(d.exception_recorded)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)

    def test_recorded_exception_without_lift_keeps_the_pin(self):
        e = entry(
            checkouts=(checkout(DEV_PATH),),
            archived=True,
            eligibility="archived_excluded",
        )
        config = parse(
            {
                "exceptions": {
                    "checkouts": {DEV_PATH: {"reason": "noted", "lift_pin": False}}
                }
            }
        )
        d = op.plan((e,), config).checkout_decisions[0]
        self.assertTrue(d.exception_recorded)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(any("pin_retained" in r for r in d.reasons))

    def test_checkout_exception_with_evidence_can_unlock(self):
        e = entry(
            checkouts=(checkout(DEV_PATH),),
            archived=True,
            eligibility="archived_excluded",
        )
        doc = unlock_doc()
        doc["exceptions"] = {
            "checkouts": {DEV_PATH: {"reason": "reviewed", "lift_pin": True}}
        }
        d = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertTrue(d.exception_recorded)
        self.assertEqual(d.local_default_writer, op.LocalWriter.MAINTENANCE)

    def test_f4_canonical_exception_does_not_lift_a_physical_pin(self):
        # Repro R6: a canonical-wide lift_pin must not unlock a physical checkout.
        canonical = "org-alpha/widget"
        e = entry(
            full_name=canonical,
            canonical=canonical,
            archived=True,
            eligibility="archived_excluded",
            checkouts=(checkout(DEV_PATH),),
        )
        doc = unlock_doc()
        doc["exceptions"] = {
            "canonicals": {canonical: {"reason": "blanket", "lift_pin": True}}
        }
        d = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertTrue(d.exception_recorded)
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertTrue(
            any("canonical_scope_does_not_lift_pin" in r for r in d.reasons)
        )

    def test_f4_canonical_evidence_does_not_unlock_a_physical_checkout(self):
        canonical = "org-alpha/widget"
        e = entry(
            full_name=canonical, canonical=canonical, checkouts=(checkout(DEV_PATH),)
        )
        doc = {
            "approved_dev_checkouts": [DEV_PATH],
            "worker_local_writes_disabled": False,
            "current_server_version": RUNNING,
            "evidence": {"canonicals": {canonical: evidence("false")}},
        }
        d = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(d.local_default_writer, op.LocalWriter.HOLD)
        self.assertEqual(d.evidence.observed, op.Effective.UNKNOWN)
        self.assertTrue(
            any("canonical_evidence_does_not_unlock" in r for r in d.reasons)
        )

    def test_unpinned_checkout_with_unknown_evidence_names_the_supported_ui_path(self):
        e = entry(checkouts=(checkout(DEV_PATH),))
        d = op.plan((e,), parse(None)).checkout_decisions[0]
        self.assertIsNone(d.special_class)
        self.assertTrue(any("supported" in a for a in d.required_actions))

    def test_no_checkout_entry_holds(self):
        e = entry(checkouts=(), coverage="no_checkout", eligibility="no_checkout_excluded")
        r = op.plan((e,), parse(None)).repo_plans[0]
        self.assertEqual(r.local_default_writer, op.LocalWriter.HOLD)


class PathNormalizationTests(unittest.TestCase):
    def test_f2_windows_paths_are_case_insensitive(self):
        self.assertEqual(
            op.normalize_path("D:\\Dev\\Repo"), op.normalize_path("d:/dev/repo")
        )

    def test_f2_posix_paths_are_case_sensitive(self):
        self.assertNotEqual(
            op.normalize_path("/home/u/Projects/Repo"),
            op.normalize_path("/home/u/Projects/repo"),
        )

    def test_f2_distinct_posix_casenames_stay_distinct(self):
        # Repro R4: two POSIX checkouts differing only in case must not merge.
        entries = (
            entry(
                full_name="owner-beta/one",
                checkouts=(checkout("/home/u/Projects/Repo"),),
            ),
            entry(
                full_name="owner-beta/two",
                checkouts=(checkout("/home/u/Projects/repo"),),
            ),
        )
        result = op.plan(entries, parse(None))
        self.assertEqual(len(result.checkout_decisions), 2)

    def test_f2_uppercase_posix_evidence_key_does_not_attach(self):
        # Repro R12.
        e = entry(checkouts=(checkout("/home/u/Proj/Repo"),))
        doc = {
            "current_server_version": RUNNING,
            "evidence": {"checkouts": {"/HOME/U/PROJ/REPO": evidence("true")}},
        }
        d = op.plan((e,), parse(doc)).checkout_decisions[0]
        self.assertEqual(d.evidence.observed, op.Effective.UNKNOWN)


if __name__ == "__main__":
    unittest.main(verbosity=2)
