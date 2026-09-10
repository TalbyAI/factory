# Mission Docker isolation prototype report

## Question

Under a trusted host, Docker Engine, and kernel, can this repeatable Docker
Compose prototype run two untrusted Missions so that each reads its own
checkout, writes `result.json` and its other Artifacts to its own Mission
Artifact directory, cannot mutate its checkout or root filesystem, has no
network or host secret, and leaves no created Docker or temporary resources
behind?

## Environment observed

The successful runtime evidence captured these commands and outputs:

| Command | Observed output |
|---|---|
| `node --version` | `v24.14.1` |
| `docker version` | Docker Engine `29.5.3 linux/amd64` (client `29.5.3 windows/amd64`, context `desktop-linux`) |
| `docker compose version` | `Docker Compose version v5.1.4` |

The harness records each command's exit code, stdout, and stderr under
`versions` in the ignored `PROTOTYPE-EVIDENCE.local.json` file.

## Command and cleanup evidence

The successful run used `npm run prototype` from
`prototypes/mission-docker-isolation/`:

```text
> prototype
> node src/harness.mjs

{"image":"factory-mission-isolation:mtvz21iu-1450ebfd52","missions":[{"missionId":"alpha","marker":"alpha-marker","containerId":"19757ddceeaf25074239d074e583f889bcb1b00bdb8df7fc686841b2ccd0c1d0","checkoutHash":"be22418abd20c4df7561552477cc5c1429c7d022513047d8a0f6e769da58cd25","artifactDir":"<temp>/mission-docker-isolation-ZWMWoL/alpha/artifacts"},{"missionId":"beta","marker":"beta-marker","containerId":"652f11afa863e247913fb286c9fd7d4774dd63a10612bd831cfb989f80df328b","checkoutHash":"4ec8e63faedd5c82e042fa89081641b9a5da0bac4c2cfd9655c9981ca7e9c3fb","artifactDir":"<temp>/mission-docker-isolation-ZWMWoL/beta/artifacts"}],"evidenceFile":"prototypes/mission-docker-isolation/PROTOTYPE-EVIDENCE.local.json","cleaned":true}
```

The ignored local evidence recorded one image for both Missions:

- Image tag: `factory-mission-isolation:mtvz21iu-1450ebfd52`
- Image digest observed during inspection and removal:
  `sha256:d1e69806cae2f5c72feacb837492abd3f31d25c3bb3dbb5507fb502d53e4bbff`
- `alpha`: container
  `19757ddceeaf25074239d074e583f889bcb1b00bdb8df7fc686841b2ccd0c1d0`,
  checkout hash before and after
  `be22418abd20c4df7561552477cc5c1429c7d022513047d8a0f6e769da58cd25`,
  Artifact directory
  `<temp>/mission-docker-isolation-ZWMWoL/alpha/artifacts`
- `beta`: container
  `652f11afa863e247913fb286c9fd7d4774dd63a10612bd831cfb989f80df328b`,
  checkout hash before and after
  `4ec8e63faedd5c82e042fa89081641b9a5da0bac4c2cfd9655c9981ca7e9c3fb`,
  Artifact directory
  `<temp>/mission-docker-isolation-ZWMWoL/beta/artifacts`

Both per-Mission `remove-container` and `compose-down` operations returned
code `0`. The build Compose project cleanup also returned code `0` and emitted
Docker Compose's warning that there was no resource to remove for the
build-only project. Image removal returned code `0`, reported the image
untagged and deleted, and the scratch directory
`<temp>/mission-docker-isolation-ZWMWoL` was removed. The final exact-resource
enumeration found no matching containers, listeners, secrets, volumes,
networks, or the exact image tag; the exact scratch-path check returned
`False`.

## Scenario evidence

| Scenario | Result | Observed evidence |
|---|---|---|
| Checkout read and Artifact write | PASS | Both Missions produced `result.json` and their other Artifacts inside their distinct Mission Artifact directories, reported their own markers (`alpha-marker` and `beta-marker`), and had `artifactsWritable: true`; `/tmp` was the ephemeral writable tmpfs. |
| Checkout mutation blocked | PASS | Both reports had `missionWriteDenied: true`; alpha's checkout hash stayed `be22418abd20c4df7561552477cc5c1429c7d022513047d8a0f6e769da58cd25` and beta's stayed `4ec8e63faedd5c82e042fa89081641b9a5da0bac4c2cfd9655c9981ca7e9c3fb`. |
| Root filesystem mutation blocked | PASS | Both reports had `rootWriteDenied: true`; inspected containers had `ReadonlyRootfs: true`. |
| Network disabled | PASS | Both reports had `networkDisabled: true`; inspected containers had `NetworkMode: none`. |
| Secret absent | PASS | For both Missions, `noSecretEnvironment`, `noHostSecret`, and `noMountedSecret` were `true`; the observed environment keys excluded `FACTORY_TEST_SECRET`, and the host-only sentinel was absent from runtime output and `result.json`. |
| Process and namespace isolation | PASS | Both reports had `pidIsOne: true`; inspection showed user `65532:65532`, `CapDrop: ALL`, `no-new-privileges:true`, empty `PidMode`, `IpcMode: private`, an ephemeral writable `/tmp` tmpfs, and only `bind:/mission` plus `bind:/artifacts` mounts. |
| Concurrent Mission separation | PASS | Alpha and beta ran as separate Missions with distinct container IDs, markers, checkout hashes, and Artifact directories; both completed all eight workload checks while their exact per-Mission cleanup operations returned code `0`. |

## Verdict

**Observed verdict: validated for the narrow prototype scope.** The successful
run showed both concurrent Missions exiting successfully with all eight
workload checks true, the inspected security profile in effect, distinct
Mission resources, preserved checkouts, and successful exact-resource cleanup.
This supports reproducible local isolation behavior under the stated trusted
host, Docker Engine, and kernel boundary. It is not evidence of production
security or of semantic validation of production Artifacts.

## Trust boundary and limits

The host, Docker Engine, and kernel are trusted. This prototype does not test
or claim protection against a compromised Docker host, kernel or daemon escape,
production multi-tenancy, real SCM access, external secret delivery, resource
load behavior, or semantic validation of production Artifacts.

**Deferred minor:** the failure reproduction for the Mission settlement barrier
was a synthetic Node promise-timing test, not a failing Docker Mission. The
runtime evidence recorded here was a happy path, so a real Docker failure-path
exercise remains outside this prototype's observed evidence.
