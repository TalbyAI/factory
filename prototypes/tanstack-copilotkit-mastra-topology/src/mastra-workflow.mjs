import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { config } from './config.mjs';

export function makeWorkflow(pool) {
  const input = z.object({ runId: z.string() });
  const output = z.object({ runId: z.string(), approved: z.boolean(), effectKey: z.string() });
  const step = createStep({
    id: 'operator-gate',
    inputSchema: input,
    outputSchema: output,
    resumeSchema: z.object({ command: z.literal('approve'), idempotencyKey: z.string() }),
    suspendSchema: z.object({ gate: z.literal('operator-approval') }),
    execute: async ({ inputData, resumeData, runId, suspend, writer }) => {
      const effectKey = `${runId}:publish`;
      if (!resumeData) {
        const existingEffect = await pool.query(
          'select 1 from topology_factory.effects where run_id = $1 and idempotency_key = $2 limit 1',
          [runId, effectKey],
        );
        if (existingEffect.rowCount) return { runId: inputData.runId, approved: true, effectKey };
        await writer.custom({ type: 'gate.pending', runId, gate: 'operator-approval' });
        return suspend({ gate: 'operator-approval' });
      }
      const response = await fetch(`${config.bffUrl}/internal/effects`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.serviceToken}`,
          'content-type': 'application/json',
          'idempotency-key': effectKey,
        },
        body: JSON.stringify({ runId, effectKey }),
      });
      if (!response.ok) throw new Error(`Effect callback failed with ${response.status}`);
      return { runId: inputData.runId, approved: true, effectKey };
    },
  });
  return createWorkflow({ id: 'topology-workflow', inputSchema: input, outputSchema: output }).then(step).commit();
}
