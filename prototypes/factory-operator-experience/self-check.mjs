import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./public/data.json', import.meta.url)));
const missionsById = new Map(fixture.missions.map((mission) => [mission.id, mission]));
const missionStates = new Set(['Open', 'Completed', 'Failed', 'Cancelled']);
const situations = new Set(['Ready', 'Running', 'Waiting', 'Stalled']);
const runStates = new Set(['Queued', 'Running', 'Suspended', 'Succeeded', 'Failed', 'Cancelled']);
const gateStates = new Set(['Pending', 'Satisfied', 'Denied']);
const frontierStatuses = new Set(['blocked', 'waiting', 'eligible']);

assert.equal(fixture.missions.length, 5);
assert(fixture.missions.every((mission) => missionStates.has(mission.state)));
assert(fixture.missions.every((mission) => mission.state === 'Open'));
assert(fixture.missions.every((mission) => situations.has(mission.situation)));
assert(fixture.missions.every((mission) => mission.run === null || runStates.has(mission.run.status)));
assert(fixture.missions.every((mission) => mission.gates.every((gate) => gateStates.has(gate.status))));
assert(fixture.missions.every((mission) => frontierStatuses.has(mission.frontier.status)
  && typeof mission.frontier.reason === 'string'));
assert(fixture.missions.every((mission) => mission.nextActionSimulated === true));
assert(fixture.missions.every((mission) => mission.revisionValid === true));
assert(fixture.missions.every((mission) => typeof mission.revisionId === 'string'));
assert(fixture.missions.every((mission) => Array.isArray(mission.artifacts) && mission.artifacts.length > 0));
assert(fixture.missions.every((mission) => typeof mission.authority === 'string' && mission.authority.length > 0));

const attentionOrder = [...fixture.missions]
  .sort((left, right) => left.attentionRank - right.attentionRank || left.id.localeCompare(right.id))
  .map((mission) => mission.id);
assert.deepEqual(attentionOrder, [
  'mission-feature-gate',
  'mission-bug-drift',
  'mission-feature-implementation',
  'mission-pr-review',
  'mission-change-proposal'
]);

assert.deepEqual(missionsById.get('mission-feature-gate').children, ['mission-feature-implementation']);
assert.equal(missionsById.get('mission-feature-implementation').parentId, 'mission-feature-gate');
assert.equal(missionsById.get('mission-pr-review').parentId, undefined);
assert.equal(missionsById.get('mission-feature-implementation').frontier.status, 'blocked');
assert.match(missionsById.get('mission-feature-implementation').frontier.reason, /dep-customer-export-fixtures/);
assert.equal(missionsById.get('mission-pr-review').frontier.status, 'waiting');
assert.equal(missionsById.get('mission-change-proposal').frontier.status, 'eligible');
assert.notEqual(missionsById.get('mission-feature-implementation').frontier.status, 'eligible');

assert.equal(missionsById.get('mission-feature-implementation').gates[0].status, 'Satisfied');
assert.equal(missionsById.get('mission-change-proposal').gates[0].status, 'Satisfied');
assert.equal(missionsById.get('mission-feature-gate').run, null);
assert.equal(missionsById.get('mission-change-proposal').run, null);
assert.equal(missionsById.get('mission-pr-review').run.status, 'Running');
assert.equal(missionsById.get('mission-bug-drift').run.status, 'Failed');
assert(typeof missionsById.get('mission-pr-review').run.id === 'string');
assert(typeof missionsById.get('mission-bug-drift').run.id === 'string');

function actionIsEnabled(mission) {
  if (mission.nextActionSimulated !== true || mission.revisionValid !== true) return false;
  if (mission.authority === 'Local inspection only') return true;
  const approvingGate = mission.authority === 'Exact Operator approval'
    && mission.nextAction === 'Approve the export scope gate';
  return mission.gates.every((gate) => gate.status === 'Satisfied'
    || (approvingGate && gate.kind === 'Human Gate' && gate.status === 'Pending'));
}

const reviewMission = missionsById.get('mission-pr-review');
assert.equal(reviewMission.authority, 'Local inspection only');
assert.equal(reviewMission.gates[0].status, 'Pending');
assert.equal(actionIsEnabled(reviewMission), true);
assert.equal(actionIsEnabled({ ...reviewMission, revisionValid: false }), false);
const reviewMissionWithoutRevision = { ...reviewMission };
delete reviewMissionWithoutRevision.revisionValid;
assert.equal(actionIsEnabled(reviewMissionWithoutRevision), false);
const driftMission = missionsById.get('mission-bug-drift');
assert.equal(driftMission.authority, 'Exact Operator approval');
assert.equal(driftMission.gates[0].status, 'Pending');
assert.equal(actionIsEnabled(driftMission), false);
assert.equal(actionIsEnabled({ ...driftMission, revisionValid: false }), false);
const driftMissionWithoutRevision = { ...driftMission };
delete driftMissionWithoutRevision.revisionValid;
assert.equal(actionIsEnabled(driftMissionWithoutRevision), false);

const artifactIds = fixture.missions.flatMap((mission) => mission.artifacts.map((artifact) => artifact.id));
assert.equal(new Set(artifactIds).size, artifactIds.length);
assert(fixture.missions.every((mission) => mission.artifacts.every((artifact) => artifact.immutable === true
  && typeof artifact.revisionId === 'string')));

function referenceTargets(mission) {
  return new Map([
    ['Run', mission.run ? [mission.run] : []],
    ['Gate', mission.gates],
    ['Artifact', mission.artifacts],
    ['Dependency', mission.dependencies],
    ['Drift', mission.drift],
    ['Evidence', mission.evidence]
  ].map(([type, records]) => [type, new Map(records.map((record) => [record.id, record]))]));
}

function assertReferences(mission, refs) {
  const targets = referenceTargets(mission);
  for (const ref of refs) {
    const target = targets.get(ref.type)?.get(ref.id);
    assert(target, `${mission.id}: missing ${ref.type} reference ${ref.id}`);
    if (ref.type === 'Artifact') {
      assert.equal(typeof ref.revisionId, 'string');
      assert.equal(ref.revisionId, target.revisionId);
    }
  }
}

for (const mission of fixture.missions) {
  for (const gate of mission.gates) {
    assert(typeof gate.evidence?.evidenceId === 'string');
    assert(typeof gate.evidence?.revisionId === 'string');
    assert.equal(gate.evidence.appliesToRevision, mission.revisionId);
    const gateEvidence = mission.evidence.find((evidence) => evidence.id === gate.evidence.evidenceId);
    assert(gateEvidence);
    assert.equal(gate.evidence.revisionId, gateEvidence.revisionId);
  }
  for (const event of mission.timeline) {
    assert(event.refs?.length > 0);
    assert(event.refs.every((ref) => typeof ref.type === 'string' && typeof ref.id === 'string'));
    assertReferences(mission, event.refs);
  }
  for (const evidence of mission.evidence) {
    assert(evidence.refs?.length > 0);
    assertReferences(mission, evidence.refs);
  }
}

function referenceTypes(missionId) {
  return new Set(missionsById.get(missionId).timeline.flatMap((event) => event.refs.map((ref) => ref.type)));
}

for (const [missionId, requiredTypes] of [
  ['mission-feature-gate', ['Gate', 'Artifact', 'Dependency']],
  ['mission-feature-implementation', ['Gate', 'Artifact', 'Dependency']],
  ['mission-pr-review', ['Run', 'Gate', 'Artifact']],
  ['mission-change-proposal', ['Gate', 'Artifact']],
  ['mission-bug-drift', ['Run', 'Gate', 'Artifact', 'Dependency', 'Drift']]
]) {
  const types = referenceTypes(missionId);
  for (const type of requiredTypes) assert(types.has(type));
}

assert(fixture.missions.some((mission) => mission.gates.some((gate) => gate.status === 'Pending')));
assert(fixture.missions.some((mission) => mission.situation === 'Running'));
assert(fixture.missions.some((mission) => mission.situation === 'Ready'));
assert(fixture.missions.some((mission) => mission.run?.attention === 'stalled'));
assert(fixture.missions.some((mission) => mission.drift.length > 0));
console.log('fixture self-check: PASS');
