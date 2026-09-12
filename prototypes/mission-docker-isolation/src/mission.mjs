import { createHash } from 'node:crypto';
import { access, constants, readFile, unlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';

const markerPath = '/mission/marker.txt';
const markerBytes = await readFile(markerPath);
const marker = markerBytes.toString('utf8');
const sourceHash = createHash('sha256').update(markerBytes).digest('hex');

const expectedWriteDenial = async (path) => {
  try {
    await writeFile(path, 'probe');
    return false;
  } catch (error) {
    return error?.code === 'EACCES' || error?.code === 'EROFS';
  }
};

const absent = async (path) => {
  try {
    await access(path, constants.F_OK);
    return false;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
};

const artifactsWritable = async () => {
  const probePath = '/artifacts/write-probe';
  try {
    await writeFile(probePath, 'probe');
    await unlink(probePath);
    return true;
  } catch {
    return false;
  }
};

const networkDisabled = await new Promise((resolve) => {
  let settled = false;
  let socket;
  const finish = (passed) => {
    if (settled) return;
    settled = true;
    socket?.destroy();
    resolve(passed);
  };

  try {
    socket = createConnection({ host: '1.1.1.1', port: 80 });
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.once('close', () => finish(true));
    socket.setTimeout(500, () => finish(true));
  } catch {
    finish(true);
  }
});

const pid = process.pid;
const checks = {
  missionWriteDenied: await expectedWriteDenial('/mission/write-probe'),
  rootWriteDenied: await expectedWriteDenial('/root-write-probe'),
  artifactsWritable: await artifactsWritable(),
  noSecretEnvironment: !Object.hasOwn(process.env, 'FACTORY_TEST_SECRET'),
  noHostSecret: await absent('/host-secret.txt'),
  noMountedSecret: await absent('/run/secrets/factory'),
  networkDisabled,
  pidIsOne: pid === 1,
};

const result = {
  missionId: process.env.MISSION_ID,
  scenario: process.env.SCENARIO,
  marker,
  sourceHash,
  environmentKeys: Object.keys(process.env).sort(),
  pid,
  checks,
};

await writeFile('/artifacts/result.json', JSON.stringify(result, null, 2));

const failingChecks = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failingChecks.length > 0) {
  console.error(failingChecks.join('\n'));
  process.exitCode = 1;
}
