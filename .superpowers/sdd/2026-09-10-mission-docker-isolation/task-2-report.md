# Task 2 Report: Untrusted Mission Workload

## Implementation

Created `prototypes/mission-docker-isolation/src/mission.mjs` using only Node
standard-library modules:

- Reads `/mission/marker.txt` as bytes, reports its UTF-8 contents as `marker`,
  and calculates the lowercase SHA-256 `sourceHash` from the original bytes.
- Attempts `/mission/write-probe` and `/root-write-probe`; each expected-denial
  check is true only for `EACCES` or `EROFS`.
- Writes and removes `/artifacts/write-probe` to verify the artifact directory
  is writable.
- Checks that `FACTORY_TEST_SECRET`, `/host-secret.txt`, and
  `/run/secrets/factory` are absent.
- Attempts a TCP connection to `1.1.1.1:80` with a 500 ms timeout; the network
  check is true only on connection failure, timeout, or close without a
  successful connection.
- Records `pid` and checks that it equals `1`.
- Writes `missionId`, `scenario`, `marker`, `sourceHash`, `environmentKeys`,
  `pid`, and boolean `checks` to `/artifacts/result.json`.
- Leaves the final result write uncaught so failure to write the artifact fails
  the process. When checks fail, it prints their names and sets
  `process.exitCode` to `1`.

## Syntax check

Command, run from `prototypes/mission-docker-isolation`:

```powershell
node --check src/mission.mjs
```

Output: no output.

Exit code: `0`.

## Files changed

- `prototypes/mission-docker-isolation/src/mission.mjs` — new workload.
- `.superpowers/sdd/2026-09-10-mission-docker-isolation/task-2-report.md` — this report.

## Self-review

- [x] Uses only `node:crypto`, `node:fs/promises`, and `node:net`.
- [x] Uses the exact marker, probe paths, secret paths, environment key,
  destination, host, port, and 500 ms timeout from the brief.
- [x] Treats only `EACCES` and `EROFS` as successful expected-denial results.
- [x] Keeps the final `/artifacts/result.json` write on the success path rather
  than converting a write failure into a passing check.
- [x] Produces a boolean value for every `checks` entry and reports failing
  check names.
- [x] Keeps the workload free of Docker SDKs, secret loaders, dependencies,
  and production abstractions.
- [x] `git diff --check` produced no output.

## Concerns

The workload was syntax-checked but not run in Docker because Task 3 supplies
the controller, bind mounts, and runtime evidence assertions. Running it
directly on the host is expected to fail isolation checks such as `pidIsOne`.
