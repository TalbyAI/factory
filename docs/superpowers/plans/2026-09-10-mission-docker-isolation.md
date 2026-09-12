# Mission Docker Isolation Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a throwaway Docker Compose harness that proves the minimum per-Mission isolation boundary for checkout, processes, network, secrets, and verifiable Artifacts.

**Architecture:** A trusted Node 24 controller runs on the host and invokes Docker Compose CLI without a Docker SDK. Compose builds a non-root Mission image with a read-only root filesystem, no network, dropped capabilities, resource limits, and two explicit bind mounts. The controller launches two uniquely named Missions, inspects their effective configuration, validates their reports and hashes, and removes only resources it created.

**Tech Stack:** Node 24 built-ins, Docker Engine 29.5.3+, Docker Compose, Alpine Linux, no runtime dependencies.

## Global Constraints

- Prototype files live under prototypes/mission-docker-isolation/ and never change Factory runtime code.
- Mission code and checkout contents are untrusted; Docker Engine, host, kernel, and controller are trusted.
- No Docker socket, host PID/IPC namespace, host network, or secret reaches a Mission.
- Only the per-Mission host directories are mounted: the checkout at `/mission:ro` and the Artifact directory at `/artifacts:rw`; no other host filesystem paths are mounted.
- No named or anonymous volumes are used.
- The Mission runs as UID/GID 65532:65532 with network_mode none, read-only rootfs, cap_drop ALL, no-new-privileges, /tmp tmpfs, 128 MiB memory, 1 CPU, and 64 PIDs.
- The controller passes only MISSION_ID and SCENARIO through Compose.
- The assert-based self-check is the prototype's evidence mechanism; no separate test framework is added.
- Cleanup targets exact temporary paths, project names, container names, and image tags only.
- The final PR uses Closes #15; the issue stays open until that PR merges.

---

### Task 1: Scaffold the hardened Mission image

**Files:** Create package.json, Dockerfile, compose.yaml, and .gitignore under
prototypes/mission-docker-isolation/.

**Interfaces:** Compose consumes MISSION_IMAGE, MISSION_ID, and SCENARIO and
produces a service named mission that runs /prototype/src/mission.mjs as
UID/GID 65532:65532.

- [ ] **Step 1: Create package.json.**

~~~json
{
  "name": "mission-docker-isolation-prototype",
  "private": true,
  "type": "module",
  "scripts": {
    "prototype": "node src/harness.mjs"
  }
}
~~~

- [ ] **Step 2: Create Dockerfile.**

~~~dockerfile
FROM node:24-alpine
RUN addgroup -S -g 65532 mission \
  && adduser -S -D -H -u 65532 -G mission mission
WORKDIR /prototype
COPY --chown=65532:65532 src/mission.mjs ./src/mission.mjs
USER 65532:65532
ENTRYPOINT ["node", "/prototype/src/mission.mjs"]
~~~

- [ ] **Step 3: Create compose.yaml.**

~~~yaml
services:
  mission:
    build:
      context: .
    image: ${MISSION_IMAGE:?MISSION_IMAGE is required}
    user: "65532:65532"
    network_mode: none
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 64
    mem_limit: 128m
    cpus: 1.0
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec
    environment:
      MISSION_ID: ${MISSION_ID:?MISSION_ID is required}
      SCENARIO: ${SCENARIO:?SCENARIO is required}
~~~

- [ ] **Step 4: Create .gitignore with exactly PROTOTYPE-EVIDENCE.local.json.**

- [ ] **Step 5: Validate the model.**

Run from prototypes/mission-docker-isolation:

~~~powershell
$env:MISSION_IMAGE = "factory-mission-isolation:config"
$env:MISSION_ID = "config"
$env:SCENARIO = "config"
docker compose config
~~~

Expected: exit 0; rendered output contains network_mode none, read_only true,
UID/GID 65532:65532, cap_drop ALL, all resource limits, and only MISSION_ID
and SCENARIO in the service environment.

- [ ] **Step 6: Commit.**

~~~powershell
git add prototypes/mission-docker-isolation
git commit -m "chore(prototype): scaffold Mission isolation image"
~~~

### Task 2: Add the untrusted Mission workload

**Files:** Create prototypes/mission-docker-isolation/src/mission.mjs.

**Interfaces:** The workload reads /mission/marker.txt and MISSION_ID and
SCENARIO, writes /artifacts/result.json, and exits nonzero if any isolation
check fails.

- [ ] **Step 1: Implement the minimal workload.**

Use Node built-ins only. The module must:

1. Read the marker and calculate its SHA-256.
2. Attempt to write /mission/write-probe and mark success only for EACCES or EROFS.
3. Attempt to write /root-write-probe and mark success only for EACCES or EROFS.
4. Verify /artifacts is writable.
5. Verify FACTORY_TEST_SECRET, /host-secret.txt, and /run/secrets/factory are absent.
6. Attempt a 500 ms TCP connection to 1.1.1.1:80 and mark the network check
   successful only when the connection fails or times out.
7. Record process.pid and require it to equal 1.
8. Write a JSON report with missionId, scenario, marker, sourceHash,
   environmentKeys, and a boolean checks object to /artifacts/result.json.
9. Set process.exitCode to 1 and print failing check names when a check is false.

The module must not add a network client, Docker SDK, secret loader, or
production abstraction.

- [ ] **Step 2: Run the syntax check.**

~~~powershell
node --check src/mission.mjs
~~~

Expected: exit 0 and no output.

- [ ] **Step 3: Commit.**

~~~powershell
git add src/mission.mjs
git commit -m "feat(prototype): add untrusted Mission workload"
~~~

### Task 3: Add the host controller and evidence assertions

**Files:** Create prototypes/mission-docker-isolation/src/harness.mjs.

**Interfaces:**
- runDocker(args, options) returns { code, stdout, stderr }.
- sha256File(file) returns lowercase SHA-256 hex.
- inspectContainer(name) returns the first object from docker inspect.
- prepareMission(scratchRoot, missionId) returns { id, checkoutDir, artifactDir, checkoutHash }.
- assertContainerSecurity(container, mission) asserts the effective Docker profile and per-Mission mount sources.
- runMission({ image, composeFile, mission }) returns one parsed evidence object.

- [ ] **Step 1: Implement runDocker with execFile.**

Use execFile('docker', args, ...) with shell false, windowsHide true, a 4 MiB
maxBuffer, timeout 30 seconds by default, and environment { ...process.env, ...env }.
Allow a command-specific timeout for the image build.
Return nonzero results to the caller instead of hiding them.

- [ ] **Step 2: Implement runMission.**

Run this exact shape, omitting --rm so inspection is possible:

~~~text
docker compose --ansi never -f compose.yaml -p PROJECT_NAME run --no-deps -T --name CONTAINER_NAME --volume CHECKOUT_DIR:/mission:ro --volume ARTIFACT_DIR:/artifacts:rw mission
~~~

Pass MISSION_IMAGE, MISSION_ID, SCENARIO, and a host-only
FACTORY_TEST_SECRET to the Docker child. Compose's explicit environment
allowlist must prevent the sentinel from entering the Mission.

Before removing the named container, inspect it and assert:

~~~js
assert.equal(container.HostConfig.NetworkMode, 'none');
assert.equal(container.HostConfig.ReadonlyRootfs, true);
assert.equal(container.Config.User, '65532:65532');
assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
assert.ok(container.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
assert.notEqual(container.HostConfig.PidMode, 'host');
assert.notEqual(container.HostConfig.IpcMode, 'host');
assert.deepEqual(
  container.Mounts.map(({ Type, Destination }) => [Type, Destination]).sort(),
  [['bind', '/artifacts'], ['bind', '/mission']]
);
~~~

Then parse result.json, assert every workload check is true, compare the
checkout hash before and after, reject the host sentinel in output, capture the
container ID, and clean the exact container and Compose project in finally.
Enumerate the remaining prototype containers, published listeners, secrets,
volumes, networks, and image tag after cleanup and assert that none remain.

- [ ] **Step 3: Implement main.**

Main must create a unique os.tmpdir scratch directory, write a host-only
host-secret.txt outside both checkouts, create alpha and beta with different
markers, build one unique lower-case image tag, and run the two Missions through
Promise.allSettled with distinct project and container names, aggregating both
settlements before final cleanup.

Assert both reports preserve their own markers and hashes, have distinct
container IDs and output directories, and contain no host sentinel. Write the
complete evidence object to the ignored PROTOTYPE-EVIDENCE.local.json on both
success and failure; failure evidence includes the error and available build,
Mission, and cleanup results. Print a compact JSON summary on success.

Finally, remove exact named containers, exact Compose projects, the exact image
tag, and the exact scratch directory. Do not use docker system prune, wildcard
removal, or broad volume deletion.

- [ ] **Step 4: Run the first evidence cycle.**

~~~powershell
npm run prototype
~~~

Expected: exit 0, two distinct container IDs, all workload and security
assertions passing, and no remaining prototype containers, listeners, secrets,
volumes, networks, or image tag. Correct only the minimal failing cause and
rerun the same command if it fails.

- [ ] **Step 5: Commit.**

~~~powershell
git add src/harness.mjs
git commit -m "feat(prototype): verify Mission Docker isolation"
~~~

### Task 4: Capture reproducibility and the observed verdict

**Files:** Create README.md and PROTOTYPE-REPORT.md under
prototypes/mission-docker-isolation/.

**Interfaces:** Documentation consumes the successful command output and local
evidence and produces one repeatable operator command plus an evidence-based
verdict.

- [ ] **Step 1: Write README.md.**

Include prerequisites Node 24 and Docker Compose, this command, and the trust
boundary:

~~~powershell
npm run prototype
~~~

State that the command builds a unique image, runs two untrusted Missions,
writes ignored local evidence, and removes the containers, Compose projects,
image, and temporary directories it created. State that host, Docker Engine,
and kernel are trusted, and that kernel/daemon escape, production
multi-tenancy, real SCM access, and external secret delivery are not tested.

- [ ] **Step 2: Write PROTOTYPE-REPORT.md from observed output.**

Use these exact sections:

~~~markdown
# Mission Docker isolation prototype report

## Question

## Environment observed

## Command and cleanup evidence

## Scenario evidence

| Scenario | Result | Observed evidence |
|---|---|---|
| Checkout read and Artifact write | | |
| Checkout mutation blocked | | |
| Root filesystem mutation blocked | | |
| Network disabled | | |
| Secret absent | | |
| Process and namespace isolation | | |
| Concurrent Mission separation | | |

## Verdict

## Trust boundary and limits
~~~

Fill the result cells only from the successful run. Record the exact outputs of
`node --version`, `docker version`, and `docker compose version`, plus exact
image, container, and cleanup observations; the harness stores those command
results in the local evidence. Do not claim protection against a compromised
Docker host or semantic validation of production Artifacts.

- [ ] **Step 3: Run final checks.**

~~~powershell
node --check src/mission.mjs
node --check src/harness.mjs
npm run prototype
git diff --check
git status --short
~~~

Expected: syntax checks and prototype exit 0, git diff --check is silent, and
status lists only intended design, plan, prototype, README, and report files.

- [ ] **Step 4: Commit documentation.**

~~~powershell
git add README.md PROTOTYPE-REPORT.md
git commit -m "docs(prototype): report Mission Docker isolation"
~~~

- [ ] **Step 5: Review the branch.**

~~~powershell
git status --short
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
~~~

Expected: clean working tree, no whitespace errors, and only the design, plan,
prototype harness, README, and report in the branch delta.

## Plan self-review

- Spec coverage: Task 1 covers Compose security; Task 2 covers checkout,
  rootfs, Artifact, secret, network, and process checks; Task 3 covers unique
  Missions, effective configuration, hashes, cleanup, and concurrency; Task 4
  covers reproducibility and the observed verdict.
- Placeholder scan: no TODO, TBD, or unspecified implementation choice remains.
  Runtime-dependent report values must come from the successful command.
- Failure evidence: every execution writes the local manifest; failed executions
  include the error and any available exit and cleanup results.
- Interface consistency: Compose provides the image and environment inputs, the
  Dockerfile provides /prototype/src/mission.mjs, the workload writes
  /artifacts/result.json, and the controller inspects the named container.
