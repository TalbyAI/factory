# Factory Operator Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway, locally runnable UI that tests the approved Inbox-first split workspace for operating active Factory Missions.

**Architecture:** A self-contained prototype directory serves one static page from a tiny Node standard-library HTTP server. Static JSON seeds active Missions; browser state stays in memory and simulates safe actions without calling Factory, GitHub, Azure DevOps, or Mastra.

**Tech Stack:** Node.js 24+, `node:http`, `node:fs`, vanilla HTML/CSS/JavaScript, JSON fixtures, npm scripts.

## Global Constraints

- One Operator and active `Open` Missions only; terminal Missions are outside the primary Inbox.
- Use the canonical terms `Mission`, `Run`, `Gate`, `Artifact`, `Execution Frontier`, and `Projection Drift`.
- Keep all state in memory; no database, external network calls, authentication backend, or real privileged effects.
- Order Inbox rows by fixed attention rank, then stable Mission id; do not add configurable priorities.
- Keep the detail tabs `Overview`, `Timeline`, `Gates`, `Dependencies`, and `Evidence`.
- Expose one recommended action plus secondary inspection actions; label every action as simulated.
- Preserve the existing repository convention of a self-contained prototype directory with `README.md` and `PROTOTYPE-REPORT.md`.

---

### Task 1: Create the runnable prototype shell and fixture

**Files:**
- Create: `prototypes/factory-operator-experience/package.json`
- Create: `prototypes/factory-operator-experience/server.mjs`
- Create: `prototypes/factory-operator-experience/public/data.json`
- Create: `prototypes/factory-operator-experience/self-check.mjs`

**Interfaces:**
- `server.mjs` serves `public/index.html`, `public/data.json`, and `GET /healthz` on `127.0.0.1:4316`.
- `data.json` exposes `{ "missions": Mission[] }` with the fields `id`, `title`, `workType`, `state`, `situation`, `attentionRank`, `run`, `badges`, `nextAction`, `overview`, `timeline`, `gates`, `dependencies`, `evidence`, and `drift`.
- `self-check.mjs` reads `public/data.json` and asserts the fixture includes pending Human Gate, Running, Ready, stalled/failed Run, and Projection Drift scenarios.

- [ ] **Step 1: Add the package scripts**

```json
{
  "name": "factory-operator-experience-prototype",
  "private": true,
  "type": "module",
  "scripts": {
    "prototype": "node server.mjs",
    "check": "node --check server.mjs",
    "self-check": "node self-check.mjs"
  }
}
```

- [ ] **Step 2: Add the standard-library server**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = createServer(async (request, response) => {
  const pathname = request.url === '/healthz' ? null : request.url === '/' ? '/index.html' : request.url;
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (!pathname || pathname.includes('..')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, pathname));
    response.writeHead(200, { 'content-type': types[extname(pathname)] ?? 'text/plain; charset=utf-8' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(4316, '127.0.0.1', () => {
  console.log('Factory Operator prototype: http://127.0.0.1:4316');
});
```

- [ ] **Step 3: Add fixture data**

Create five active Missions: a Feature waiting on a Human Gate, a Feature Implementation with a blocked dependency and Execution Frontier, a Running Pull Request Review, a Ready Change Proposal, and a Bug Fix with a stalled/failed Run plus Projection Drift. Each Mission must include at least one Timeline entry, and the Feature must include Gates, Dependencies, Evidence, and Drift records.

- [ ] **Step 4: Add the fixture self-check**

```js
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
```

- [ ] **Step 5: Run the shell checks**

Run from `prototypes/factory-operator-experience`:

```sh
npm run check
npm run self-check
```

Expected: `npm run check` exits 0 and `fixture self-check: PASS` is printed.

- [ ] **Step 6: Commit the runnable shell**

```sh
git add prototypes/factory-operator-experience/package.json prototypes/factory-operator-experience/server.mjs prototypes/factory-operator-experience/public/data.json prototypes/factory-operator-experience/self-check.mjs
git commit -m "prototype: seed operator experience fixture"
```

### Task 2: Implement the approved Operator workspace

**Files:**
- Create: `prototypes/factory-operator-experience/public/index.html`
- Create: `prototypes/factory-operator-experience/README.md`
- Create: `prototypes/factory-operator-experience/PROTOTYPE-REPORT.md`

**Interfaces:**
- `index.html` loads `/data.json`, owns only browser memory state `{ missions, selectedMissionId, tab, activity }`, and renders the Inbox plus selected Mission detail.
- `renderInbox()` sorts with `attentionRank` then `id`; each row renders title, Work Type, operational situation, Run, Gate, and Drift badges.
- `renderDetail()` renders the stable Mission header, the five approved tabs, and the action bar.
- `simulateAction(action)` appends a local activity entry and renders a visible “simulated — no external effect” result; it must never call a network endpoint.

- [ ] **Step 1: Add the page structure and styles**

Create a single Spanish-language page with a persistent `#inbox` pane, `#mission-detail` pane, `#tabs`, `#tab-content`, `#action-bar`, and `#activity-log`. Mark the page and actions `PROTOTYPE — local memory only`. Use plain CSS for the two-column desktop layout and a narrow-screen stacked fallback.

- [ ] **Step 2: Add the browser state and render functions**

```js
const state = { missions: [], selectedMissionId: '', tab: 'Overview', activity: [] };
const tabs = ['Overview', 'Timeline', 'Gates', 'Dependencies', 'Evidence'];

function attentionSort(left, right) {
  return left.attentionRank - right.attentionRank || left.id.localeCompare(right.id);
}

function selectedMission() {
  return state.missions.find((mission) => mission.id === state.selectedMissionId) ?? state.missions[0];
}

function render() {
  renderInbox();
  renderDetail();
  renderActivity();
}
```

Render each tab from fixture data. `Overview` must show operational state,
Run, Execution Frontier, children/dependencies counts, Gate counts,
Artifact counts, and Projection Drift. The other tabs show their full seeded
records rather than empty copy.

- [ ] **Step 3: Add selection, tabs, and simulated actions**

Selecting a Mission updates only `state.selectedMissionId`. Selecting a tab
updates only `state.tab`. The primary action calls `simulateAction` and
secondary actions open the relevant tab or append an inspection entry. Show
the required authority on privileged/destructive actions and keep the action
disabled when its Gate or revision is not valid.

- [ ] **Step 4: Add the run instructions**

`README.md` must contain:

```sh
cd prototypes/factory-operator-experience
npm run self-check
npm run prototype
```

It must state that the UI is disposable, uses no external services, and that
all actions are simulations.

- [ ] **Step 5: Record the observed verdict**

`PROTOTYPE-REPORT.md` must record the hypothesis, the five walkthrough
scenarios, the result `validated` or `inconclusive`, evidence from the
manual walkthrough, and explicit limits. The proposed verdict is `validated`
only if the acceptance walkthrough is fully observable without chat.

- [ ] **Step 6: Run verification**

```sh
npm run check
npm run self-check
git diff --check
```

Start `npm run prototype`, manually exercise all five scenarios, confirm the
Inbox retains its list while tabs change, confirm simulated actions never
leave the browser, then stop the server.

- [ ] **Step 7: Commit the prototype**

```sh
git add prototypes/factory-operator-experience
git commit -m "prototype: add operator experience workspace"
```

## Self-review

- Spec coverage: the approved layout, ordering, tabs, action safety, seeded
  scenarios, in-memory boundary, and acceptance walkthrough each map to a
  task above.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step is
  required; the fixture values and commands are explicit.
- Type consistency: `Mission[]`, `state.selectedMissionId`, `state.tab`,
  `attentionSort`, `selectedMission`, `render`, and `simulateAction` are the
  only cross-file contracts; the server serves the exact paths consumed by
  the page.
