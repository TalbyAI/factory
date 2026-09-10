import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCKER_MAX_BUFFER = 4 * 1024 * 1024;
const DOCKER_TIMEOUT = 30_000;
const HOST_SENTINEL = 'factory-test-secret-host-only';
const SOURCE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_MISSION_CHECKS = Object.freeze([
  'missionWriteDenied',
  'rootWriteDenied',
  'artifactsWritable',
  'noSecretEnvironment',
  'noHostSecret',
  'noMountedSecret',
  'networkDisabled',
  'pidIsOne',
]);

export function runDocker(args, options = {}) {
  return new Promise((resolveResult) => {
    execFile('docker', args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      windowsHide: true,
      maxBuffer: DOCKER_MAX_BUFFER,
      timeout: DOCKER_TIMEOUT,
    }, (error, stdout = '', stderr = '') => {
      const code = error
        ? (Number.isInteger(error.code) && error.code !== 0 ? error.code : 1)
        : 0;
      resolveResult({
        code,
        stdout: String(stdout),
        stderr: String(stderr || error?.message || ''),
      });
    });
  });
}

export async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function isContained(root, target) {
  const relativePath = relative(root, target);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

async function safeArtifactPath(artifactRoot, name) {
  const candidate = resolve(artifactRoot, name);
  assert.ok(isContained(artifactRoot, candidate), `Artifact path escapes ${artifactRoot}: ${name}`);

  const entry = await lstat(candidate);
  assert.equal(entry.isSymbolicLink(), false, `Artifact is a symlink: ${name}`);
  assert.equal(entry.isFile(), true, `Artifact is not a regular file: ${name}`);

  const resolvedPath = await realpath(candidate);
  assert.ok(isContained(artifactRoot, resolvedPath), `Artifact path escapes ${artifactRoot}: ${name}`);
  const resolvedEntry = await lstat(resolvedPath);
  assert.equal(resolvedEntry.isSymbolicLink(), false, `Artifact is a symlink: ${name}`);
  assert.equal(resolvedEntry.isFile(), true, `Artifact is not a regular file: ${name}`);
  return resolvedPath;
}

export async function inspectContainer(name) {
  const result = await runDocker(['inspect', name]);
  assert.equal(result.code, 0, `docker inspect failed for ${name}: ${result.stderr}`);
  const containers = JSON.parse(result.stdout);
  assert.ok(Array.isArray(containers) && containers.length > 0, `docker inspect returned no container for ${name}`);
  return containers[0];
}

export async function prepareMission(scratchRoot, missionId) {
  const id = String(missionId);
  const checkoutDir = join(scratchRoot, id, 'checkout');
  const artifactDir = join(scratchRoot, id, 'artifacts');
  const markerPath = join(checkoutDir, 'marker.txt');

  await mkdir(checkoutDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeFile(markerPath, `${id}-marker`, 'utf8');

  return { id, checkoutDir, artifactDir, checkoutHash: await sha256File(markerPath) };
}

export function assertContainerSecurity(container, mission) {
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.Config.User, '65532:65532');
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.ok(container.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
  assert.notEqual(container.HostConfig.PidMode, 'host');
  assert.notEqual(container.HostConfig.IpcMode, 'host');
  assert.equal(container.HostConfig.Memory, 128 * 1024 * 1024);
  assert.equal(container.HostConfig.NanoCpus, 1e9);
  assert.equal(container.HostConfig.PidsLimit, 64);
  assert.equal(container.HostConfig.Privileged, false);
  assert.deepEqual(container.HostConfig.Tmpfs, { '/tmp': 'rw,nosuid,nodev,noexec' });
  assert.deepEqual(
    container.Mounts.map(({ Type, Destination }) => [Type, Destination]).sort(),
    [['bind', '/artifacts'], ['bind', '/mission']],
  );
  assert.deepEqual(
    container.Mounts.map(({ Type, Source, Destination, Mode, RW }) => ({
      Type, Source, Destination, Mode, RW,
    })).sort((left, right) => left.Destination.localeCompare(right.Destination)),
    [
      { Type: 'bind', Source: mission.artifactDir, Destination: '/artifacts', Mode: 'rw', RW: true },
      { Type: 'bind', Source: mission.checkoutDir, Destination: '/mission', Mode: 'ro', RW: false },
    ].sort((left, right) => left.Destination.localeCompare(right.Destination)),
  );
}

function composeContext(composeFile) {
  const file = resolve(composeFile);
  return { cwd: dirname(file), file: basename(file) };
}

function missionEnvironment(image, mission) {
  return {
    MISSION_IMAGE: image,
    MISSION_ID: mission.id,
    SCENARIO: mission.scenario ?? mission.id,
    FACTORY_TEST_SECRET: HOST_SENTINEL,
  };
}

async function cleanupMission(composeFile, image, mission, cleanup) {
  const context = composeContext(composeFile);
  const env = missionEnvironment(image, mission);
  const removeArgs = ['rm', '-f', mission.containerName];
  const remove = await runDocker(removeArgs);
  cleanup.push({ action: 'remove-container', args: removeArgs, ...remove });

  const downArgs = [
    'compose', '--ansi', 'never', '-f', context.file, '-p', mission.projectName,
    'down', '--volumes', '--remove-orphans',
  ];
  const down = await runDocker(downArgs, { cwd: context.cwd, env });
  cleanup.push({ action: 'compose-down', args: downArgs, cwd: context.cwd, ...down });
}

export async function runMission({ image, composeFile, mission }) {
  const cleanup = [];
  let value;
  let missionError;

  try {
    const context = composeContext(composeFile);
    const env = missionEnvironment(image, mission);
    const runArgs = [
      'compose', '--ansi', 'never', '-f', context.file, '-p', mission.projectName,
      'run', '--no-deps', '-T', '--name', mission.containerName,
      '--volume', `${mission.checkoutDir}:/mission:ro`,
      '--volume', `${mission.artifactDir}:/artifacts:rw`,
      'mission',
    ];
    const run = await runDocker(runArgs, { cwd: context.cwd, env });
    const container = await inspectContainer(mission.containerName);
    assertContainerSecurity(container, mission);
    assert.equal(run.code, 0, `Mission ${mission.id} failed: ${run.stderr}`);
    assert.equal(`${run.stdout}\n${run.stderr}`.includes(HOST_SENTINEL), false, 'Host sentinel leaked into Docker output');

    const artifactDirectory = await lstat(mission.artifactDir);
    assert.equal(artifactDirectory.isSymbolicLink(), false, `Artifact directory is a symlink: ${mission.artifactDir}`);
    assert.equal(artifactDirectory.isDirectory(), true, `Artifact directory is not a directory: ${mission.artifactDir}`);
    const artifactRoot = await realpath(mission.artifactDir);
    const resultText = await readFile(await safeArtifactPath(artifactRoot, 'result.json'), 'utf8');
    const report = JSON.parse(resultText);
    assert.equal(report.missionId, mission.id);
    assert.equal(report.scenario, mission.scenario ?? mission.id);
    assert.ok(
      report.checks !== null
        && typeof report.checks === 'object'
        && !Array.isArray(report.checks),
      `Mission ${mission.id} checks must be a non-array object`,
    );
    assert.deepEqual(
      Object.keys(report.checks).sort(),
      [...EXPECTED_MISSION_CHECKS].sort(),
      `Mission ${mission.id} checks have unexpected keys`,
    );
    for (const name of EXPECTED_MISSION_CHECKS) {
      assert.equal(typeof report.checks[name], 'boolean', `Mission ${mission.id} check is not boolean: ${name}`);
      assert.equal(report.checks[name], true, `Mission ${mission.id} check failed: ${name}`);
    }
    assert.equal(resultText.includes(HOST_SENTINEL), false, 'Host sentinel leaked into result.json');

    const checkoutHashAfter = await sha256File(join(mission.checkoutDir, 'marker.txt'));
    assert.equal(checkoutHashAfter, mission.checkoutHash);
    assert.equal(report.sourceHash, mission.checkoutHash);

    const artifactNames = (await readdir(artifactRoot)).sort();
    const artifacts = await Promise.all(artifactNames.map(async (name) => {
      const path = await safeArtifactPath(artifactRoot, name);
      return { name, path, sha256: await sha256File(path) };
    }));

    value = {
      missionId: mission.id,
      scenario: mission.scenario ?? mission.id,
      projectName: mission.projectName,
      containerName: mission.containerName,
      containerId: container.Id,
      checkoutDir: mission.checkoutDir,
      artifactDir: mission.artifactDir,
      checkoutHashBefore: mission.checkoutHash,
      checkoutHashAfter,
      marker: report.marker,
      sourceHash: report.sourceHash,
      report,
      artifacts,
      container,
      command: { executable: 'docker', args: runArgs, cwd: context.cwd },
      exitCode: run.code,
      stdout: run.stdout,
      stderr: run.stderr,
      cleanup,
    };
  } catch (error) {
    missionError = error;
  }

  let cleanupError;
  try {
    await cleanupMission(composeFile, image, mission, cleanup);
  } catch (error) {
    cleanupError = error;
  }

  if (missionError) {
    missionError.cleanup = cleanup;
    if (cleanupError) missionError.cleanupError = cleanupError;
    throw missionError;
  }
  if (cleanupError) {
    cleanupError.cleanup = cleanup;
    throw cleanupError;
  }
  return { ...value, cleanup };
}

export async function main() {
  const prototypeRoot = SOURCE_FILE;
  const composeFile = join(prototypeRoot, 'compose.yaml');
  const evidenceFile = join(prototypeRoot, 'PROTOTYPE-EVIDENCE.local.json');
  const scratchRoot = await mkdtemp(join(tmpdir(), 'mission-docker-isolation-'));
  const suffix = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`.toLowerCase();
  const image = `factory-mission-isolation:${suffix}`;
  const projectPrefix = `mission-isolation-${suffix}`;
  const buildProject = `${projectPrefix}-build`;
  const cleanup = {};
  let evidence;
  let failure;

  try {
    const hostSecretPath = join(scratchRoot, 'host-secret.txt');
    await writeFile(hostSecretPath, HOST_SENTINEL, 'utf8');

    const [alpha, beta] = await Promise.all([
      prepareMission(scratchRoot, 'alpha'),
      prepareMission(scratchRoot, 'beta'),
    ]);
    const missions = [
      { ...alpha, scenario: 'alpha', projectName: `${projectPrefix}-alpha`, containerName: `${projectPrefix}-alpha-container` },
      { ...beta, scenario: 'beta', projectName: `${projectPrefix}-beta`, containerName: `${projectPrefix}-beta-container` },
    ];

    const buildArgs = ['compose', '--ansi', 'never', '-f', basename(composeFile), '-p', buildProject, 'build', 'mission'];
    const buildEnv = { MISSION_IMAGE: image, MISSION_ID: 'build', SCENARIO: 'build' };
    const build = await runDocker(buildArgs, { cwd: prototypeRoot, env: buildEnv });
    assert.equal(build.code, 0, `Mission image build failed: ${build.stderr}`);

    const missionResults = await Promise.allSettled(
      missions.map((mission) => runMission({ image, composeFile, mission })),
    );
    const cleanupFailures = [];
    for (const [index, settlement] of missionResults.entries()) {
      const mission = missions[index];
      const outcome = settlement.status === 'fulfilled' ? settlement.value : settlement.reason;
      const missionCleanup = outcome?.cleanup;
      if (!Array.isArray(missionCleanup)) {
        cleanupFailures.push(new Error(`Mission ${mission.id} did not expose cleanup`));
        continue;
      }
      if (missionCleanup.length !== 2) {
        cleanupFailures.push(new Error(`Mission ${mission.id} cleanup was incomplete`));
      }
      const failedCleanup = missionCleanup.find(({ code }) => code !== 0);
      if (failedCleanup) {
        cleanupFailures.push(new Error(`Mission ${mission.id} cleanup failed: ${failedCleanup.stderr}`));
      }
      if (settlement.status === 'rejected' && settlement.reason?.cleanupError) {
        cleanupFailures.push(new Error(`Mission ${mission.id} cleanup threw: ${settlement.reason.cleanupError.message}`));
      }
    }
    const rejected = missionResults.find(({ status }) => status === 'rejected');
    if (rejected) {
      if (cleanupFailures.length > 0 && rejected.reason && typeof rejected.reason === 'object') {
        rejected.reason.cleanupFailures = cleanupFailures;
      }
      throw rejected.reason;
    }
    if (cleanupFailures.length > 0) throw cleanupFailures[0];
    const reports = missionResults.map(({ value }) => value);
    assert.equal(reports[0].containerId === reports[1].containerId, false, 'Missions reused a container');
    assert.equal(reports[0].artifactDir === reports[1].artifactDir, false, 'Missions reused an artifact directory');
    for (const report of reports) {
      assert.equal(report.marker, `${report.missionId}-marker`);
      assert.equal(report.checkoutHashBefore, report.checkoutHashAfter);
      assert.equal(JSON.stringify(report).includes(HOST_SENTINEL), false, 'Host sentinel leaked into Mission evidence');
      assert.ok(report.cleanup.every(({ code }) => code === 0), `Mission cleanup failed for ${report.missionId}`);
    }

    evidence = {
      generatedAt: new Date().toISOString(),
      image,
      composeFile,
      hostSecretPath,
      build: { command: { executable: 'docker', args: buildArgs, cwd: prototypeRoot }, ...build },
      missions: reports,
    };
  } catch (error) {
    failure = error;
  } finally {
    const buildDownArgs = [
      'compose', '--ansi', 'never', '-f', basename(composeFile), '-p', buildProject,
      'down', '--volumes', '--remove-orphans',
    ];
    const buildDown = await runDocker(buildDownArgs, {
      cwd: prototypeRoot,
      env: { MISSION_IMAGE: image, MISSION_ID: 'build', SCENARIO: 'build' },
    });
    cleanup.buildProject = { action: 'compose-down', args: buildDownArgs, cwd: prototypeRoot, ...buildDown };

    const imageArgs = ['image', 'rm', '--force', image];
    const imageRemoval = await runDocker(imageArgs);
    cleanup.image = { action: 'remove-image', args: imageArgs, ...imageRemoval };

    try {
      await rm(scratchRoot, { recursive: true, force: true });
      cleanup.scratch = { path: scratchRoot, removed: true };
    } catch (error) {
      cleanup.scratch = { path: scratchRoot, removed: false, error: error.message };
    }
  }

  if (evidence) {
    evidence.cleanup = cleanup;
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }

  if (!failure && cleanup.buildProject.code !== 0) failure = new Error(`Build Compose cleanup failed: ${cleanup.buildProject.stderr}`);
  if (!failure && cleanup.image.code !== 0) failure = new Error(`Image cleanup failed: ${cleanup.image.stderr}`);
  if (!failure && cleanup.scratch.removed !== true) failure = new Error('Scratch directory cleanup failed');
  if (failure) throw failure;

  process.stdout.write(`${JSON.stringify({
    image,
    missions: evidence.missions.map(({ missionId, marker, containerId, checkoutHashAfter, artifactDir }) => ({
      missionId, marker, containerId, checkoutHash: checkoutHashAfter, artifactDir,
    })),
    evidenceFile,
    cleaned: cleanup.scratch.removed,
  })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
}
