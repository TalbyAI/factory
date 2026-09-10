import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./public/data.json', import.meta.url)));
assert.equal(fixture.missions.length, 5);
assert(fixture.missions.some((mission) => mission.gates.some((gate) => gate.status === 'Pending')));
assert(fixture.missions.some((mission) => mission.situation === 'Running'));
assert(fixture.missions.some((mission) => mission.situation === 'Ready'));
assert(fixture.missions.some((mission) => mission.run?.attention === 'stalled'));
assert(fixture.missions.some((mission) => mission.drift.length > 0));
console.log('fixture self-check: PASS');
