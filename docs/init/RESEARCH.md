La recomendación es construir una factory propia, pero con una estrategia híbrida: poseer el control plane, el modelo de dominio, las políticas y la UX; reutilizar durabilidad, protocolos y observabilidad; contratar el aislamiento fuerte y la inferencia mediante proveedores sustituibles.

He dejado la investigación completa aquí: [software-factory-market-research.md](C:/Users/iskan/software-factory-market-research.md). Incluye 67 enlaces a fuentes primarias, matrices de capacidades, licencias, madurez, arquitectura, build-vs-buy, spike y roadmap.

### Conclusiones principales

- [Mastra Factory](https://factory.mastra.ai/) es la base OSS vertical más cercana: board, intake, sesiones, reglas, GitHub/Linear/Slack y UI React. Está en alpha; la usaría como baseline o fork experimental, no como dependencia estable.

- [Warp Factories](https://www.warp.dev/factories) es el benchmark comercial más completo: control room, stages, coste por PR, autonomía, scorers, steering e integraciones. Sigue en Early Access y su control plane no es OSS.

- [OpenAI Symphony](https://github.com/openai/symphony) es una muy buena especificación de kernel —scheduler, workspaces, reconciliación, retries y adapters—, pero deliberadamente no es una plataforma completa ni proporciona aislamiento fuerte.

- [Sandcastle](https://github.com/mattpocock/sandcastle) es una buena primitiva TypeScript para agentes, worktrees, commits y sandboxes. Encaja debajo de un control plane propio.

- Cole Medin `build-dark-factory` es un blueprint útil para gates, validation harness y state machines; Buzz es una referencia excelente para inbox/event log humano-agente; T3 Code, para la consola de operación. Ninguno resuelve por sí solo la factory completa.

- Entre los productos comerciales, Devin ofrece la coincidencia más amplia con Teams, Slack, Azure DevOps, Linear, GitHub y extensiones documentales; Factory.ai y Codegen también merecen piloto.

### Arquitectura que elegiría

```text
Canales y trackers
        ↓
WorkItem + SpecSnapshot + event log
        ↓
Workflow durable y policy engine
        ↓
Human gates → runner de agentes → sandbox fuerte
        ↓
Git / PR / CI
        ↓
OTel + observabilidad LLM + dashboard propio
```

Empezaría como monolito modular con workers, Postgres y object storage.

Para la UI:

- React convencional para dashboard, inbox, diffs, permisos, costes y gates.
- CopilotKit + AG-UI para chat, streaming, tool activities y aprobaciones.
- Agent-Native como spike arquitectónico.
- Evitaría una UI operativa completamente generativa: las acciones privilegiadas deben seguir contratos tipados, autorización y auditoría.

### Próximo paso recomendado

Haría un bake-off con el mismo conjunto de 10–20 tareas reales:

1. Mastra Factory extendida.
2. Kernel propio inspirado en Symphony + Sandcastle.
3. Piloto Warp, Devin o Factory.ai.

El tracer bullet debe cubrir:

`ticket → snapshot de especificación → plan → aprobación → sandbox → commit/PR → CI/review → cierre`

Y probar explícitamente reinicios, webhooks duplicados, cancelación, retries, secretos, aislamiento y recuperación. La decisión final debe basarse en coste por PR aceptada, intervenciones humanas, tiempo hasta PR, rework, seguridad y esfuerzo para añadir un segundo tracker o canal.
