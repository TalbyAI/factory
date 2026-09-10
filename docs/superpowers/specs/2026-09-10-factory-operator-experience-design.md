# Factory Operator experience prototype

Status: approved design for a throwaway UI prototype.

## Question

What is the smallest Operator-facing arrangement that makes active Missions,
their Gates, dependencies, evidence, Projection Drift, timeline, and safe
actions understandable without requiring chat or a visual editor?

## Scope

The prototype covers one authenticated Operator, active `Open` Missions, and
an in-memory desktop UI. It deliberately uses synthetic data and has no
backend, persistence, tracker calls, or real privileged effects.

It does not decide final API contracts, audit retention, responsive behavior,
multi-user access, bulk actions, chat, a visual Workflow editor, or production
deployment.

## Approved interaction model

- The entry point is an Inbox-first split workspace.
- The left pane keeps all active Missions visible. Each row exposes the
  Mission title, Work Type, operational state, Run, Gates, and Projection
  Drift badges.
- Rows are ordered by a fixed attention rank: pending Human Gates, stalled or
  failed Runs that need intervention, Projection Drift, then the remaining
  active Missions. Ties use a stable deterministic order.
- Selecting a row keeps the Inbox visible and opens the Mission detail on the
  right.
- The detail uses a stable header and tabs: Overview, Timeline, Gates,
  Dependencies, and Evidence.
- The action bar shows one recommended primary action and secondary inspection
  actions. Privileged or destructive actions are represented with their
  required approval or Autonomy Grant; the prototype never performs them.
- Projection Drift is visible in the Inbox and Mission detail, but does not
  mutate or block Mission state on its own.

## Seeded scenarios

The fixture includes enough state to exercise the design:

- a Feature waiting on a Human Gate;
- a Feature with child Missions and an Execution Frontier;
- a Running Mission with a durable Run;
- a Ready Mission;
- a Mission with a stalled or failed Run that offers intervention;
- an external Projection Drift;
- immutable Artifacts and versioned Gate evidence;
- Timeline events linking Runs, Gates, Artifacts, dependencies, and drift.

## Prototype shape

One self-contained `public/index.html` is served by a tiny Node standard-
library server. All state is held in memory. Each interaction re-renders the
relevant full view so the Operator can see the effect of selection, tab
changes, and simulated safe actions. The only run command is `npm run
prototype` from the prototype directory.

## Acceptance walkthrough

The prototype answers the ticket if a non-developer can, without chat:

1. find every active Mission and identify why an item is high attention;
2. select a Mission without losing the Inbox;
3. locate its Timeline, Gates, Dependencies, and Evidence;
4. understand the difference between a pending Gate, a blocked dependency,
   a stalled Run, and Projection Drift;
5. identify the next recommended action and which actions require authority;
6. see that simulated actions change only local prototype state.

## Verification

Run `npm run prototype`, open the printed local URL, and manually complete the
acceptance walkthrough for the seeded scenarios. Run `node --check` against
the server and browser script, then run `git diff --check`.
