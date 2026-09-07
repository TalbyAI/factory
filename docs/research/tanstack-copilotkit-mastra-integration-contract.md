# Contrato de integración entre TanStack Start, CopilotKit y Mastra

Fecha de observación: 2026-09-07.

## Pregunta

¿Qué topologías e interfaces oficiales permiten conectar TanStack Start, CopilotKit Runtime/AG-UI y Mastra Server conservando streaming, HITL, autenticación y recuperación en dos procesos Node?

## Conclusión

La topología apropiada para la Factory es **remota en dos procesos**:

```text
Browser
  │ same-origin session cookie
  ▼
TanStack Start (UI + BFF + CopilotKit Runtime v2)
  │ server-to-server MastraClient + service token
  ▼
Mastra Server (agents + predefined workflows)
  │
  ▼
PostgreSQL (Factory schema + Mastra schema, separados)
```

El BFF debe alojar `CopilotRuntime` y adaptar los agents remotos con `MastraAgent.getRemoteAgents({ mastraClient, resourceId })`. Es una integración oficial: el adaptador descubre los agents de Mastra y crea un `MastraAgent` AG-UI por cada uno; el bridge remoto traduce el stream de `@mastra/client-js` a eventos AG-UI, incluidos tool calls, estado e interrupts. [Fuente del adaptador remoto](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/src/utils.ts#L241-L284) y [contrato AG-UI de CopilotKit](https://docs.copilotkit.ai/mastra/ag-ui).

Hay que mantener **dos carriles distintos**:

1. **Carril interactivo CopilotKit/AG-UI:** conversación, streaming de texto y actividades, estado compartido y HITL propio de un agent.
2. **Carril durable de Mission:** comandos, estado, Gates y Artifacts de la Factory, con ejecución y suspensión mediante la API de workflows de Mastra.

AG-UI no debe convertirse en la fuente de verdad de una Mission. La integración oficial de `@ag-ui/mastra` enumera agents, no workflows. Encapsular un Workflow como tool de un agent ocultaría el `runId`, los Gates y la recuperación al control plane. La Factory debe conservar `MissionId ↔ workflowId ↔ workflowRunId` y usar `MastraClient.getWorkflow(...).createRun(...)` directamente desde el BFF.

## Comparación de topologías oficiales

| Topología | Streaming y HITL | Auth | Recuperación | Evaluación |
| --- | --- | --- | --- | --- |
| Mastra embebido en TanStack Start mediante `@mastra/tanstack-start` y `getLocalAgents` | Camino más corto; soporta capacidades locales como `untilIdle` | Un solo boundary HTTP | UI y ejecución comparten proceso y fallo | Útil para demo; contradice la decisión de operar dos procesos |
| CopilotKit Runtime en Mastra mediante `registerCopilotKit`; TanStack actúa como proxy | Bridge local completo y dos procesos visibles | El proxy y Mastra deben coordinar dos gates de auth | El estado de CopilotKit cae junto al runtime de ejecución | Válida, pero mezcla UI protocol y engine en Mastra sin beneficio para la Factory |
| **CopilotKit Runtime en TanStack + `getRemoteAgents` + MastraClient** | Dos saltos de stream; bridge remoto oficial soporta stream y resume de interrupts | BFF como único boundary del navegador; token interno hacia Mastra | Permite separar recuperación visual, estado Factory y snapshots Mastra | **Seleccionada** |
| Browser conectado directamente al endpoint AG-UI de Mastra | Menos salto | El navegador debe recibir credenciales y gestionar CORS | Omite el BFF y sus políticas | Descartada: CopilotKit no recomienda la conexión directa para producción y pierde middleware/ecosistema del Runtime ([comparación oficial](https://docs.copilotkit.ai/mastra/copilot-runtime#what-if-i-want-to-connect-to-my-ag-ui-agent-directly)) |

Mastra ofrece un adaptador oficial para montar todas sus rutas dentro de TanStack Start con un splat route, por lo que la opción embebida es técnicamente real y no requiere inventar un adapter. Precisamente por eso puede conservarse como simplificación para una demo, sin condicionar la arquitectura de producción. [Referencia `@mastra/tanstack-start`](https://mastra.ai/en/reference/server/tanstack-start-adapter).

La diferencia funcional relevante entre agents locales y remotos es pequeña para el alcance inicial. El bridge actual soporta remote streaming, remote interrupt resume y sincronización de working memory; `untilIdle` sigue siendo una opción sólo local. [Implementación local/remota](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/src/mastra.ts#L2980-L3195). La Factory no debe cambiar de topología sólo por `untilIdle`: sus trabajos de larga duración pertenecen al carril de Workflow, no a una conexión de chat mantenida abierta.

## Contrato HTTP y de streaming

### Browser → TanStack Start

TanStack Start expondrá un catch-all same-origin bajo `/api/copilotkit/*`. Los server routes aceptan y devuelven `Request`/`Response` estándar, por lo que pueden delegar directamente en `createCopilotRuntimeHandler`; no hace falta Express ni un proxy personalizado. [Server routes de TanStack Start](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes) y [handler v2 de CopilotKit](https://docs.copilotkit.ai/mastra/copilot-runtime#setting-up-the-runtime).

Se usará el modo multi-route del Runtime v2, montando al menos `GET` y `POST` sobre el splat completo, no una ruta que sólo capture `/api/copilotkit`. El frontend apunta `CopilotKitProvider` a ese base path. El flujo resultante es:

```text
GET  /api/copilotkit/info
POST /api/copilotkit/agent/:agentId/run      -> SSE AG-UI
GET  /api/copilotkit/agent/:agentId/connect  -> replay + live SSE
POST /api/copilotkit/agent/:agentId/stop/:threadId
```

`CopilotRuntime` debe construir los agents remotos con una factory evaluada por request. Esto evita fallar el proceso si Mastra todavía no está disponible y permite inyectar contexto y tracing correlacionados. Para la primera versión, `resourceId` será el identificador estable del único Operator y `threadId` identificará la conversación de la Mission; no se usarán ambos como sinónimos.

El `InMemoryAgentRunner` de CopilotKit inicia el agent inmediatamente, conserva eventos por thread y su `connect()` reproduce historia compactada antes de enlazar el stream activo. Esto permite refrescar la página o reconectar mientras sobreviva el proceso BFF. No sobrevive a un reinicio ni ofrece coordinación multi-instancia. [Implementación del runner](https://github.com/CopilotKit/CopilotKit/blob/078260605a2ccfa0042fb4d835f36f0c4960fdc6/packages/runtime/src/v2/runtime/runner/in-memory.ts#L609-L900).

Para la primera iteración debe conservarse el runner in-memory: añadir SQLite o implementar un `AgentRunner` PostgreSQL duplicaría persistencia que no es autoritativa. Tras un reinicio del BFF, la pantalla se reconstruirá con la Mission y sus Artifacts persistidos y, cuando corresponda, con la memoria del thread de Mastra. Se añadirá un runner persistente sólo si se exige replay exacto de eventos AG-UI a través de reinicios.

### TanStack Start → Mastra Server

El BFF usará una única configuración server-only de `MastraClient` con:

- `baseUrl` de Mastra;
- service token interno en `headers.Authorization`;
- timeout/retry acotados;
- ningún secreto expuesto al bundle del browser.

`MastraClient` soporta agents y workflows, streaming y headers desde Node, sin cambiar de SDK. [Documentación oficial](https://mastra.ai/en/docs/server/mastra-client).

Los Workflows de Mission seguirán el patrón **start/observe**, que desacopla su vida de la petición del navegador:

1. La Factory crea la Mission y el `workflowRunId`, y guarda la correlación antes de iniciar trabajo externo.
2. El BFF llama `run.start(...)`, que devuelve inmediatamente y deja el Workflow ejecutándose.
3. La UI observa progreso a través de un endpoint autenticado del BFF; éste consume `run.observe({ offset })` y transmite sólo los eventos necesarios.
4. El cliente conserva el último offset aplicado. Tras una desconexión vuelve a observar desde `offset + 1`.
5. Al completar o suspenderse un paso, la Factory persiste el estado y los Artifacts relevantes. No persiste cada token.

La API actual expone `start`, `observe({ offset })`, `resume`, `resumeStream` y `cancel` sobre un run identificado. [Fuente de `@mastra/client-js`](https://github.com/mastra-ai/mastra/blob/b947ae4490df857b5ba82b1ea04740e7d51917d4/client-sdks/client-js/src/resources/run.ts#L118-L408). El endpoint `/workflows/:workflowId/observe` reproduce chunks cacheados desde el offset y los concatena con el stream vivo. [Fuente de Mastra Server](https://github.com/mastra-ai/mastra/blob/b947ae4490df857b5ba82b1ea04740e7d51917d4/packages/server/src/server/handlers/workflows.ts#L756-L808).

Los eventos de Workflow no se convertirán a AG-UI en la primera versión. La UI convencional de inbox/detalle consume el modelo Factory; CopilotKit consume AG-UI. Si más adelante una experiencia requiere mostrar eventos del Workflow dentro del chat, podrá proyectarse un subconjunto como actividades AG-UI sin hacer que ese stream gobierne la Mission.

## Contrato HITL

Hay dos formas de espera humana y no deben compartir autoridad:

### Interrupt de agent

Un tool de Mastra puede suspenderse y el bridge convierte esa suspensión en un `RUN_FINISHED` con outcome AG-UI de tipo `interrupt`. El identificador conserva tanto el run de snapshot Mastra como el tool call; la respuesta posterior se traduce a `resumeStream`, en local y remoto. [Fuente del bridge de interrupts](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/src/mastra.ts#L774-L1018) y [mapeo de identidad](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/src/mastra.ts#L1170-L1275).

El bridge requiere CopilotKit client `>= 1.61.2` para el camino estructurado de interrupts. Se fijará un conjunto exacto de versiones y se comprobará el round-trip en una prueba de contrato; no se dependerá sólo de rangos semver.

### Gate de Mission

Una aprobación de negocio es un Gate de la Factory, aunque Mastra la materialice mediante `suspend()` dentro del Workflow. El flujo será:

```text
Workflow suspend
  -> snapshot Mastra en PostgreSQL
  -> Gate pendiente en Factory
  -> Operator pulsa aprobar/rechazar
  -> comando BFF autenticado y auditado
  -> validación de política y estado actual
  -> run.resume(...) en Mastra
  -> reconciliación + nueva observación
```

Mastra persiste el snapshot al suspender y permite recrear el run con el mismo `runId` para reanudarlo después de un despliegue o reinicio. [Suspend/resume oficial](https://mastra.ai/en/docs/workflows/suspend-and-resume).

Un botón React y una tool expuesta al agent pueden invocar el mismo comando Factory, pero CopilotKit nunca ejecutará la acción privilegiada directamente. El comando vuelve a comprobar sesión, autonomía configurada, versión de política, Gate esperado e idempotency key. Sólo después llama a Mastra. Esto conserva la decisión previa de que BFF, Gate y auditoría sean una única frontera de autoridad.

## Contrato de autenticación

1. **Acceso del Operator:** la clave bootstrap se intercambia por una cookie de sesión `HttpOnly`, `Secure` y `SameSite`. La clave no permanece en `localStorage` ni se reenvía a Mastra.
2. **Boundary de TanStack:** todas las server functions privadas validan la sesión en su propio middleware; la protección de ruta sólo mejora UX. Se habilita el middleware CSRF de TanStack para server functions. [Primitivas de seguridad de server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions#same-origin-requests).
3. **Boundary de CopilotKit:** `createCopilotRuntimeHandler({ hooks: { onRequest, onBeforeHandler } })` valida la sesión antes de descubrir, ejecutar, conectar o detener agents. [Auth de CopilotKit Runtime](https://docs.copilotkit.ai/teams/mastra/auth#backend).
4. **Boundary de Mastra:** Mastra Server no será accesible desde el browser. El BFF usa un service token distinto mediante `MastraClient.headers`. Para desarrollo local basta `SimpleAuth`; el token se carga de entorno y no se versiona. [SimpleAuth oficial](https://mastra.ai/en/docs/auth/simple-auth).
5. **Separación de headers:** CopilotKit reenvía por defecto `authorization` y headers `x-*` al agent, y `@ag-ui/mastra` los coloca en `modelSettings.headers`. Por eso el Runtime se configurará con `forwardHeaders: { deny: ['authorization'], denyPrefixes: ['x-'] }`; el token de servicio viaja exclusivamente en `MastraClient.headers`. [Política de forwarding](https://github.com/CopilotKit/CopilotKit/blob/078260605a2ccfa0042fb4d835f36f0c4960fdc6/packages/runtime/src/v2/runtime/handlers/header-utils.ts#L165-L225) y [consumo en MastraAgent](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/src/mastra.ts#L3045-L3140).

El contexto funcional (`missionId`, versión de Workflow, política, actor) viajará como input tipado/`RequestContext` y metadata de tracing, nunca como un header reenviado al proveedor de modelo.

## Semántica de recuperación

“Recuperación” debe explicitar qué fallo cubre:

| Fallo | Garantía inicial |
| --- | --- |
| Refresh o corte de red del browser durante chat | `AgentRunner.connect()` reproduce y reengancha mientras viva el BFF |
| Refresh o corte de red observando un Workflow | `run.observe({ offset })` reproduce chunks cacheados y sigue el stream vivo mientras viva el cache de Mastra |
| Reinicio del BFF | La Mission se reconstruye desde PostgreSQL y se consulta Mastra por `workflowRunId`; no se garantiza replay token-perfect de AG-UI |
| Reinicio de Mastra con Workflow suspendido | El snapshot PostgreSQL permite recrear y reanudar el run |
| Reinicio de Mastra en mitad de un step activo | No se promete exactly-once; el step debe ser idempotente y la Factory debe reconciliar el efecto externo |
| Reinicio de Mastra y replay completo del stream | Fuera del primer alcance: el server cache por defecto es in-memory; requiere cache/pubsub compartido, típicamente Redis |

Los snapshots de Workflow preservan estado de pasos y suspensiones, pero no convierten automáticamente cualquier efecto externo en exactly-once. Cada step que escriba en GitHub, Azure DevOps, Git o el sandbox debe llevar una idempotency key derivada de `MissionId + workflowVersion + stepId + attempt` y comprobar el efecto antes de repetirlo.

La cancelación usa `run.cancel()`. Mastra propaga un `AbortSignal`, pero un step activo debe observarlo; de lo contrario termina ese step y evita los siguientes. La Factory sólo marcará `Cancelled` tras reconciliar el estado real del run.

## Versiones y prueba de contrato

La superficie cambia con rapidez. En la fecha de observación, npm publicaba `@copilotkit/runtime` 1.70.1, `@ag-ui/mastra` 1.1.2, `@mastra/core` 1.64.0, `@mastra/client-js` 1.43.0 y `@tanstack/react-start` 1.168.50. `@ag-ui/mastra` declara compatibilidad con CopilotKit `^1.60.1` y Mastra 1.x, pero su propio código establece un mínimo funcional más alto para structured interrupts. [Manifest del bridge](https://github.com/ag-ui-protocol/ag-ui/blob/bb34bb684cecfaa54d3ceb4e8f0d4d1c9f46929a/integrations/mastra/typescript/package.json).

Antes de implementar workflows reales debe existir una sola prueba de contrato end-to-end que demuestre:

- `/info` descubre el agent remoto;
- texto y tool activities llegan por SSE;
- un tool suspend genera interrupt, una aprobación reanuda el mismo snapshot y el run termina;
- un Workflow iniciado en modo fire-and-forget puede observarse, desconectarse y reobservarse desde offset;
- tras reiniciar Mastra, un Workflow suspendido se recupera desde PostgreSQL;
- ninguna cookie, clave bootstrap o service token aparece en `modelSettings.headers`, eventos o traces.

## Decisión resultante

Usar TanStack Start como UI/BFF y host de CopilotKit Runtime v2; conectar por `MastraClient` y `MastraAgent.getRemoteAgents` a un Mastra Server separado. Reservar AG-UI para interacción agent–UI y usar la API de workflows de Mastra para Missions, Gates y recuperación. La Factory conserva la autoridad y persiste correlaciones y resultados; Mastra conserva snapshots y ejecución; los streams son vistas reconectables, no estado autoritativo.
