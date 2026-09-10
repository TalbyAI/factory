export function actionPolicy(mission) {
  const inspectionOnly = mission.authority === 'Local inspection only';
  // Inspection-only actions expose pending evidence locally; they never bypass a real effect.
  const approvingGate = mission.authority === 'Exact Operator approval'
    && mission.nextAction === 'Approve the export scope gate';
  const invalidGate = inspectionOnly ? null : mission.gates.find((gate) => gate.status !== 'Satisfied'
    && !(approvingGate && gate.kind === 'Human Gate' && gate.status === 'Pending'));
  const reason = mission.nextActionSimulated !== true ? { code: 'not-simulated' }
    : mission.revisionValid !== true ? { code: 'revision-invalid' }
    : inspectionOnly ? null
    : invalidGate ? { code: 'gate-invalid', gateName: invalidGate.name, gateStatus: invalidGate.status }
    : null;

  return {
    disabled: Boolean(reason),
    authority: mission.authority,
    reason
  };
}
