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

assert.equal(missionsById.get('mission-feature-gate').children.join(','), 'mission-feature-implementation,mission-pr-review');
assert.equal(missionsById.get('mission-feature-implementation').parentId, 'mission-feature-gate');
assert.equal(missionsById.get('mission-pr-review').parentId, 'mission-feature-gate');
assert.equal(missionsById.get('mission-feature-implementation').frontier.status, 'blocked');
assert.match(missionsById.get('mission-feature-implementation').frontier.reason, /dep-invoice-fixtures/);
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

const artifactIds = fixture.missions.flatMap((mission) => mission.artifacts.map((artifact) => artifact.id));
assert.equal(new Set(artifactIds).size, artifactIds.length);
assert(fixture.missions.every((mission) => mission.artifacts.every((artifact) => artifact.immutable === true
  && typeof artifact.revisionId === 'string')));

for (const mission of fixture.missions) {
  for (const gate of mission.gates) {
    assert(typeof gate.evidence?.evidenceId === 'string');
    assert(typeof gate.evidence?.revisionId === 'string');
    assert.equal(gate.evidence.appliesToRevision, mission.revisionId);
    assert(mission.evidence.some((evidence) => evidence.id === gate.evidence.evidenceId));
  }
  for (const event of mission.timeline) {
    assert(event.refs?.length > 0);
    assert(event.refs.every((ref) => typeof ref.type === 'string' && typeof ref.id === 'string'));
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
