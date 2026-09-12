# Mission Docker isolation prototype

This is a throwaway prototype for testing a narrow Docker isolation boundary
around two untrusted Missions. It is not a production runner or a production
security guarantee.

## Prerequisites

- Node.js 24
- Docker Engine with Docker Compose

From `prototypes/mission-docker-isolation/`, run:

```powershell
npm run prototype
```

The command builds a uniquely tagged image, runs two untrusted Missions with
separate checkouts and Artifact directories, writes ignored local evidence to
`PROTOTYPE-EVIDENCE.local.json`, and removes the containers, Compose projects,
image, and temporary directories created by that run.

## Trust boundary

The prototype trusts the host, Docker Engine, and kernel. It does not test
kernel or daemon escape, production multi-tenancy, real SCM access, or external
secret delivery.
