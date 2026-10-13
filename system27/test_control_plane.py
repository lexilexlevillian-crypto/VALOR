"""Executable control-plane checks; no external game system is simulated."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import fields
from pathlib import Path
from unittest.mock import patch

from system27 import control_plane as cp


class ControlPlaneTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'control.sqlite3')
        self.engine = cp.ControlPlane(self.path)
        self.counter = 0
        self.scope = {
            'context_id': 'context-1', 'campaign_id': 'demo:campaign',
            'timeline_id': 'demo:source', 'cut_ref': 'demo:cut:0',
            'fence': None, 'actor_or_subject_ref': 'demo:actor',
            'read_write_scope': 'write', 'policy_version': cp.POLICY_VERSION,
        }
        opened = self.send('OpenContext', {'workspace': 'authoring'})
        self.assertTrue(opened['ok'], opened)
        self.scope['fence'] = opened['data']['fence']

    def tearDown(self):
        self.engine.close()
        self.directory.cleanup()

    def request(self, command, payload, request_id=None, **scope):
        self.counter += 1
        return {
            **self.scope, **scope, 'command': command,
            'request_id': request_id or f'request-{self.counter}',
            'payload': copy.deepcopy(payload),
        }

    def send(self, command, payload, request_id=None, **scope):
        return self.engine.state_machine(self.request(command, payload, request_id, **scope))

    def good(self, command, payload, request_id=None, **scope):
        answer = self.send(command, payload, request_id, **scope)
        self.assertTrue(answer['ok'], answer)
        self.assertEqual(answer['execution'], 'mock')
        self.assertIs(answer['canonical_effects_committed'], False)
        return answer['data']

    def stored(self):
        return json.loads(self.engine._db.execute(
            'SELECT payload FROM control_snapshot WHERE singleton=1'
        ).fetchone()[0])

    def make_plan(self, plan_id='plan-1', kind='instance_edit', owner='system_15',
                  patch_ref='demo:patch', **extra):
        return self.good('PreviewImpact', {
            'plan_id': plan_id, 'kind': kind, 'targets': ['demo:entity'],
            'patches': [{'owner_domain': owner, 'patch_ref': patch_ref}],
            'recovery_anchor': 'demo:checkpoint', **extra,
        })

    def review(self, preview):
        return self.good('ReviewPlan', {
            'plan_id': preview['plan']['id'], 'preview_digest': preview['preview_digest'],
            'reason': 'Review exact fixture plan',
        })

    def draft(self):
        self.good('CreateDraft', {
            'id': 'draft-1', 'owner_domain': 'system_15',
            'source_version': 'demo:v1', 'candidate_ref': 'demo:candidate',
        })

    def scenario(self, run=True, fault=False):
        self.good('CreateScenario', {
            'id': 'scenario-1', 'root_checkpoint': 'demo:checkpoint',
            'fixture_refs': ['demo:fault-fixture' if fault else 'demo:fixture'],
            'scripted_inputs': [{'kind': 'synthetic_player_input',
                                 'content': 'Fixture response', 'test_only': True}],
            'assertion_refs': ['demo:assertion'], 'version': '1',
        })
        if run:
            return self.good('RunScenario', {
                'scenario_id': 'scenario-1', 'run_id': 'run-1', 'reason': 'Run fixture',
            }, 'run-request-1')

    def test_exact_state_schema(self):
        self.assertEqual({f.name for f in fields(cp.System27State)}, set(cp.RECORD_FIELDS))
        for table, records in self.stored().items():
            for record in records.values():
                self.assertEqual(set(record), set(cp.RECORD_FIELDS[table]))

    def test_draft_validation_and_publication(self):
        self.draft()
        self.good('ValidateDraft', {'draft_id': 'draft-1'})
        first = self.good('PublishVersion', {'draft_id': 'draft-1', 'reason': 'Publish'}, 'publish')
        second = self.good('PublishVersion', {'draft_id': 'draft-1', 'reason': 'Publish'}, 'publish')
        self.assertEqual(first, second)
        self.assertFalse(first['existing_instances_changed'])
        denied = self.send('EditDraft', {'draft_id': 'draft-1', 'candidate_ref': 'demo:candidate'})
        self.assertFalse(denied['ok'])

    def test_invalid_candidate_preserves_draft(self):
        self.draft()
        self.good('EditDraft', {'draft_id': 'draft-1', 'candidate_ref': 'unknown'})
        self.assertFalse(self.send('ValidateDraft', {'draft_id': 'draft-1'})['ok'])
        self.assertEqual(self.stored()['content_draft']['draft-1']['status'], 'invalid')

    def test_apply_requires_concrete_review(self):
        self.make_plan()
        answer = self.send('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Apply'})
        self.assertFalse(answer['ok'])
        self.assertEqual(answer['data']['code'], 'PLAN_NOT_REVIEWED')

    def test_review_digest_must_match(self):
        self.make_plan()
        answer = self.send('ReviewPlan', {
            'plan_id': 'plan-1', 'preview_digest': 'wrong', 'reason': 'Review',
        })
        self.assertFalse(answer['ok'])

    def test_apply_retry_and_persistence(self):
        self.review(self.make_plan())
        payload = {'plan_id': 'plan-1', 'reason': 'Apply'}
        first = self.good('ApplyReviewedPlan', payload, 'apply')
        self.engine.close()
        self.engine = cp.ControlPlane(self.path)
        second = self.good('ApplyReviewedPlan', payload, 'apply')
        self.assertEqual(first, second)
        self.assertEqual(self.stored()['impact_plan']['plan-1']['status'], 'applied')

    def test_reused_operation_key_rejected(self):
        self.review(self.make_plan())
        self.good('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Apply'}, 'apply')
        answer = self.send('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Changed'}, 'apply')
        self.assertFalse(answer['ok'])
        self.assertEqual(answer['data']['code'], 'IDEMPOTENCY_KEY_REUSED')

    def test_stale_revision_rejected_before_patch(self):
        self.review(self.make_plan())
        original = cp.ADAPTERS['system_15']
        calls = []
        def adapter(request):
            calls.append(request['action'])
            answer = original(request)
            if request['action'] == 'check_revisions':
                answer['data']['revisions']['demo:entity'] = 'newer'
            return answer
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            answer = self.send('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Apply'})
        self.assertFalse(answer['ok'])
        self.assertNotIn('apply_patch', calls)
        self.assertEqual(self.stored()['impact_plan']['plan-1']['status'], 'stale')

    def test_owner_invariant_failure_blocks_preview(self):
        original = cp.ADAPTERS['system_15']
        def adapter(request):
            answer = original(request)
            if request['action'] == 'preview':
                answer['data']['checks']['owner_invariants'] = False
            return answer
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            answer = self.send('PreviewImpact', {
                'plan_id': 'bad', 'kind': 'instance_edit', 'targets': ['demo:entity'],
                'patches': [{'owner_domain': 'system_15', 'patch_ref': 'demo:patch'}],
                'recovery_anchor': 'demo:checkpoint',
            })
        self.assertFalse(answer['ok'])
        self.assertNotIn('bad', self.stored()['impact_plan'])

    def test_partial_retry_never_reissues_completed_patch(self):
        self.review(self.make_plan())
        original = cp.ADAPTERS['system_15']
        calls = []
        fail = [True]
        def adapter(request):
            calls.append(request['action'])
            if request['action'] == 'post_validate' and fail[0]:
                raise RuntimeError('private failure content')
            return original(request)
        payload = {'plan_id': 'plan-1', 'reason': 'Apply'}
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            first = self.send('ApplyReviewedPlan', payload, 'apply')
            self.assertEqual(first['status'], 'partial')
            self.assertNotIn('private failure', json.dumps(first))
            fail[0] = False
            self.good('ApplyReviewedPlan', payload, 'apply')
        self.assertEqual(calls.count('apply_patch'), 1)

    def test_cancel_preserves_completed_stages(self):
        self.review(self.make_plan())
        original = cp.ADAPTERS['system_15']
        def adapter(request):
            if request['action'] == 'post_validate':
                raise cp.ControlError('DEPENDENCY_UNAVAILABLE')
            return original(request)
        payload = {'plan_id': 'plan-1', 'reason': 'Apply'}
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            partial = self.send('ApplyReviewedPlan', payload, 'apply')
        cancelled = self.good('CancelOperation', {
            'operation_id': partial['data']['operation_id'], 'reason': 'Stop pending work',
        })
        self.assertEqual(cancelled['completed_stages_retained'], 1)
        self.assertFalse(self.send('ApplyReviewedPlan', payload, 'apply')['ok'])
        self.assertEqual(self.stored()['control_operation'][partial['data']['operation_id']]['status'], 'cancelled')

    def test_partial_plan_cannot_restart_under_new_operation_id(self):
        self.review(self.make_plan())
        original = cp.ADAPTERS['system_15']
        calls = []
        def adapter(request):
            calls.append(request['action'])
            if request['action'] == 'post_validate':
                raise RuntimeError('temporarily unavailable')
            return original(request)
        payload = {'plan_id': 'plan-1', 'reason': 'Apply'}
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            self.assertEqual(self.send('ApplyReviewedPlan', payload, 'original')['status'], 'partial')
            second = self.send('ApplyReviewedPlan', payload, 'different')
        self.assertFalse(second['ok'])
        self.assertEqual(second['data']['code'], 'RESUME_OR_RECOVER_ORIGINAL_OPERATION')
        self.assertEqual(calls.count('apply_patch'), 1)

    def test_lost_acknowledgement_requires_same_operation_id(self):
        self.review(self.make_plan())
        original = cp.ADAPTERS['system_15']
        def adapter(request):
            if request['action'] == 'apply_patch':
                raise TimeoutError('response lost')
            return original(request)
        payload = {'plan_id': 'plan-1', 'reason': 'Apply'}
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            first = self.send('ApplyReviewedPlan', payload, 'original')
        self.assertEqual(first['status'], 'pending')
        self.assertFalse(self.send('ApplyReviewedPlan', payload, 'different')['ok'])
        self.good('ApplyReviewedPlan', payload, 'original')

    def test_rejected_preview_does_not_broaden_scope(self):
        original = cp.ADAPTERS['system_15']
        def adapter(request):
            answer = original(request)
            if request['action'] == 'preview':
                answer['data']['patches'][0]['target_ref'] = 'another-entity'
            return answer
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            answer = self.send('PreviewImpact', {
                'plan_id': 'plan-1', 'kind': 'instance_edit', 'targets': ['demo:entity'],
                'patches': [{'owner_domain': 'system_15', 'patch_ref': 'demo:patch'}],
                'recovery_anchor': 'demo:checkpoint',
            })
        self.assertFalse(answer['ok'])
        self.assertEqual(self.stored()['impact_plan'], {})

    def test_tampered_adapter_binding_rejected(self):
        original = cp.ADAPTERS['system_15']
        def adapter(request):
            answer = original(request)
            answer['request_binding'] = 'other-request'
            return answer
        with patch.dict(cp.ADAPTERS, {'system_15': adapter}):
            denied = self.send('InspectTruth', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        self.assertFalse(denied['ok'])
        self.assertNotIn('panes', denied['data'])

    def test_revocation_rechecked(self):
        self.engine._server_session = 'revoked'
        denied = self.send('InspectTruth', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        self.assertFalse(denied['ok'])
        self.assertNotIn('panes', json.dumps(denied))

    def test_player_cannot_request_privileged_schema(self):
        player = cp.ControlPlane(server_session='player')
        try:
            opened_request = self.request('OpenContext', {'workspace': 'player_preview'},
                                          fence=None, read_write_scope='read')
            opened = player.state_machine(opened_request)
            self.assertTrue(opened['ok'], opened)
            request = self.request('InspectTruth', {
                'owner_domain': 'system_15', 'target_refs': ['demo:entity'],
            }, fence=opened['data']['fence'], read_write_scope='read')
            self.assertFalse(player.state_machine(request)['ok'])
        finally:
            player.close()

    def test_inspection_has_no_gameplay_or_knowledge_effect(self):
        before = self.stored()
        answer = self.good('InspectTruth', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        self.assertTrue(answer['payload']['read_only'])
        after = self.stored()
        for table in cp.RECORD_FIELDS:
            if table != 'diagnostic_artifact':
                self.assertEqual(before[table], after[table], table)

    def test_player_projection_omits_hidden_panes(self):
        answer = self.good('PreviewPlayerView', {})
        self.assertNotIn('demo:truth', json.dumps(answer))
        self.assertNotIn('panes', answer)
        self.assertIn('cache_key', answer)

    def test_leave_fences_stale_callback(self):
        old = self.request('InspectTruth', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        self.good('LeavePrivilegedMode', {})
        self.assertFalse(self.engine.state_machine(old)['ok'])

    def test_player_workspace_rejects_creator_truth_even_with_fresh_fence(self):
        left = self.good('LeavePrivilegedMode', {})
        self.scope['fence'] = left['fence']
        answer = self.send('InspectTruth', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        self.assertFalse(answer['ok'], answer)

    def test_branch_switch_invalidates_review(self):
        self.review(self.make_plan())
        self.good('SwitchContext', {
            'workspace': 'authoring', 'new_context_id': 'context-2',
            'target': {k: self.scope[k] for k in (
                'campaign_id', 'timeline_id', 'cut_ref', 'actor_or_subject_ref', 'read_write_scope')},
        })
        self.assertEqual(self.stored()['impact_plan']['plan-1']['status'], 'stale')

    def test_scenario_report_does_not_claim_external_assertions_passed(self):
        answer = self.scenario()
        self.assertNotEqual(answer['run']['sandbox_timeline'], self.scope['timeline_id'])
        self.assertEqual(answer['run']['actual_results'][0]['status'], 'not_executed')
        repeated = self.good('RunScenario', {
            'scenario_id': 'scenario-1', 'run_id': 'run-1', 'reason': 'Run fixture',
        }, 'run-request-1')
        self.assertEqual(answer, repeated)

    def test_new_run_has_new_child(self):
        first = self.scenario()
        second = self.good('RunScenario', {
            'scenario_id': 'scenario-1', 'run_id': 'run-2', 'reason': 'Clean rerun',
        })
        self.assertNotEqual(first['run']['sandbox_timeline'], second['run']['sandbox_timeline'])

    def test_fault_provenance_persists(self):
        self.scenario(fault=True)
        self.engine.close()
        self.engine = cp.ControlPlane(self.path)
        self.assertTrue(self.stored()['test_execution']['run-1']['invalid_fault_fixture'])

    def test_time_advance_stops_at_choice(self):
        self.scenario()
        answer = self.good('AdvanceTestTime', {
            'run_id': 'run-1', 'reason': 'Step', 'target_time_or_interval': 'demo:later',
            'stop_policy': 'stop_at_player_choice',
        })
        self.assertEqual(answer['receipt']['paused_choices'], ['demo:choice'])

    def test_unsupplied_synthetic_choice_rejected(self):
        self.scenario()
        answer = self.send('AdvanceTestTime', {
            'run_id': 'run-1', 'reason': 'Step', 'target_time_or_interval': 'demo:later',
            'stop_policy': 'scripted_test_response',
        })
        self.assertFalse(answer['ok'])

    def test_pause_resume_and_task_override(self):
        self.scenario()
        for command in ('PauseTestTime', 'ResumeTestTime'):
            self.good(command, {'run_id': 'run-1', 'reason': command})
        self.good('StageContextOverride', {
            'run_id': 'run-1', 'reason': 'Test candidate',
            'task_ref': 'demo:task', 'candidate_ref': 'demo:candidate',
        })

    def test_repair_requires_verified_evidence(self):
        case = self.good('DiagnoseState', {
            'case_id': 'case-1', 'owner_domain': 'system_15',
            'invariant_refs': ['demo:invariant'], 'evidence_refs': [],
        })
        self.assertFalse(case['case']['validation_results']['verified_restoration'])
        self.assertEqual(case['diagnosis']['classification'], 'unrecoverable_canonical_gap')

    def test_verified_repair(self):
        self.good('DiagnoseState', {
            'case_id': 'case-1', 'owner_domain': 'system_15',
            'invariant_refs': ['demo:invariant'], 'evidence_refs': ['demo:evidence'],
        })
        self.review(self.make_plan(kind='repair', patch_ref='demo:repair', repair_case_id='case-1'))
        self.good('ApplyRepair', {'plan_id': 'plan-1', 'repair_case_id': 'case-1', 'reason': 'Restore'})

    def test_knowledge_repair_is_explicit_and_separate(self):
        preview = self.make_plan(kind='knowledge_correction', owner='knowledge',
                                 patch_ref='demo:knowledge', knowledge_correction={
            'subject': 'demo:actor', 'source': 'demo:acquisition',
            'acquisition_time': 'demo:time:0', 'reason': 'Restore acquisition',
        })
        self.assertEqual(preview['plan']['knowledge_policy'], 'source_correction')
        self.review(preview)
        self.good('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Apply'})

    def test_npc_generation_duplicate_creation_blocked_before_owner_call(self):
        self.good('StageGeneration', {
            'task_id': 'generation-1', 'constraint_snapshot': 'demo:constraints',
            'accepted_output': 'demo:candidate', 'creation_key': 'creation-1',
        })
        for plan_id in ('plan-1', 'plan-2'):
            self.review(self.make_plan(plan_id=plan_id, kind='npc_create', owner='system_9',
                                       patch_ref='demo:npc-create', generation_task_id='generation-1'))
        self.good('ApplyReviewedPlan', {'plan_id': 'plan-1', 'reason': 'Create'})
        calls = []
        original = cp.ADAPTERS['system_9']
        def adapter(request):
            calls.append(request['action'])
            return original(request)
        with patch.dict(cp.ADAPTERS, {'system_9': adapter}):
            second = self.send('ApplyReviewedPlan', {'plan_id': 'plan-2', 'reason': 'Duplicate'})
        self.assertFalse(second['ok'])
        self.assertNotIn('apply_patch', calls)

    def test_import_staged_not_activated(self):
        imported = self.good('StageImport', {
            'draft_id': 'import-1', 'package_ref': 'demo:package',
            'owner_domain': 'system_15', 'source_version': 'demo:v1',
        })
        self.assertFalse(imported['activated'])
        self.assertEqual(self.stored()['content_draft']['import-1']['status'], 'draft')

    def test_exports_do_not_publish(self):
        exported = self.good('Export', {'panes': ['truth'], 'mode': 'privileged_redacted'})
        self.assertFalse(exported['published'])
        self.assertFalse(self.send('Export', {'panes': ['truth'], 'mode': 'known_view'})['ok'])

    def test_recovery_retains_original_future(self):
        recovered = self.good('RecoverAnchor', {'checkpoint_ref': 'demo:checkpoint', 'reason': 'Recover'})
        self.assertTrue(recovered['recovery']['original_future_retained'])

    def test_trace_context_watcher_are_read_only(self):
        self.good('InspectTrace', {'owner_domain': 'system_15', 'target_refs': ['demo:entity']})
        context = self.good('InspectContext', {'task_ref': 'demo:task'})
        self.assertFalse(context['payload']['hidden_reasoning_available'])
        watcher = self.good('InspectWatcher', {'owner_domain': 'system_24', 'target_refs': ['demo:watcher']})
        self.assertEqual(watcher['payload']['value'], 'unknown')

    def test_malformed_requests_are_filtered(self):
        for invalid in (None, [], {'command': []}, {'secret': 'private'}):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.engine.state_machine(invalid)['status'], 'rejected')

    def test_malformed_payload_does_not_report_storage_outage(self):
        answer = self.send('GetOperation', {'operation_id': []})
        self.assertEqual(answer['status'], 'rejected', answer)

    def test_player_cannot_select_another_actor(self):
        player = cp.ControlPlane(server_session='player')
        try:
            request = self.request('OpenContext', {'workspace': 'player_preview'},
                                   fence=None, actor_or_subject_ref='someone-else', read_write_scope='read')
            self.assertFalse(player.state_machine(request)['ok'])
        finally:
            player.close()

    def test_cli_json_lines(self):
        request = self.request('OpenContext', {'workspace': 'authoring'}, fence=None)
        process = subprocess.run(
            [sys.executable, '-B', '-m', 'system27', str(Path(self.directory.name) / 'cli.sqlite3')],
            input=json.dumps(request) + '\nnot-json\n', text=True, capture_output=True,
            cwd=Path(__file__).resolve().parent.parent,
        )
        self.assertEqual(process.returncode, 0, process.stderr)
        lines = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertTrue(lines[0]['ok'])
        self.assertEqual(lines[1]['data']['code'], 'INVALID_JSON')


if __name__ == '__main__':
    unittest.main()
