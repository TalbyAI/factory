const bffPort = Number(process.env.BFF_PORT ?? 4310);

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://prototype:prototype@localhost:55433/topology_prototype',
  bffPort,
  mastraPort: Number(process.env.MASTRA_PORT ?? 4311),
  supervisorPort: Number(process.env.SUPERVISOR_PORT ?? 4312),
  bffUrl: process.env.BFF_URL ?? `http://127.0.0.1:${bffPort}`,
  serviceToken: process.env.SERVICE_TOKEN ?? 'prototype-service-token',
};
