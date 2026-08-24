# Project Approach: Software Factory local-first

## Overview

### TL;DR

Sí construiría un producto propio, pero no otro coding agent ni otro motor genérico de workflows.

Construiría un control plane extensible para equipos: normaliza trabajo procedente de GitHub/Azure DevOps/Slack/Teams, ejecuta agentes existentes mediante adaptadores, aplica workflows deterministas, aísla cada ejecución y ofrece una UI operativa con inbox, aprobaciones, evidencias, costes y telemetría.

La combinación que mejor encaja contigo:

- Backend: ASP.NET Core + Microsoft Agent Framework como candidato inicial para agentes y grafos; Mastra framework merece un spike equivalente antes de fijar el runtime.
- Frontend: React/TypeScript + CopilotKit sobre AG-UI.
- Estado: PostgreSQL.
- Ejecución: adaptadores ACP y protocolos nativos como Codex app-server.
- Sandboxing: `SandboxProvider` sustituible; Docker Sandboxes, Azure Dynamic Sessions, E2B y Vercel Sandbox son candidatos de spike.
- Telemetría: OpenTelemetry + event log de dominio; Langfuse como integración opcional para observabilidad/evaluación LLM.
- Despliegue inicial: Docker Compose en una máquina.
- Referencias OSS: Mastra Factory como baseline vertical; Mastra framework y Microsoft Agent Framework como candidatos para el core; Symphony, Sandcastle, Fusion, OpenHands y Archon como comparadores especializados.
- Referencias de producto/UX: Mastra Factory, Warp Factories, T3 Code y Buzz.
- Referencia mínima de arquitectura: OpenAI Symphony.

El hueco interesante no es “un agente que programa”. Es la capa que convierte agentes intercambiables en un proceso de ingeniería gobernable.

---

### Project Frame

Objetivo: herramienta interna para equipos de desarrollo, inicialmente experimental y self-hosted, con posible evolución a SaaS.

Restricciones determinantes:

- Desarrollo en solitario.
- Dominio de .NET y TypeScript.
- Máxima extensibilidad.
- Ejecución local, Docker o VPS genérico.
- Integración con trackers, mensajería, documentación y Git.
- Workflows reproducibles con pasos deterministas.
- UI configurable, pero operativamente fiable.
- El coste principal aceptado es tiempo propio y consumo de modelos.

El repositorio no contiene todavía una implementación del producto; los archivos de `docs/init` son estrategia e investigación. Por tanto, esto es estrategia pre-build, no revisión de una implementación existente.

---

### Evidencia revisada

Investigación observada el 24 de agosto de 2026:

- Documentación oficial y repositorios de Mastra Factory y Mastra framework, Warp Factories, OpenAI Symphony, Sandcastle, Fusion, Archon, Cole Medin Dark Factory, Buzz, T3 Code, OpenHands, CopilotKit, Agent-Native, Microsoft Agent Framework, ACP, AG-UI, Docker Sandboxes, E2B, Vercel Sandbox, Azure Dynamic Sessions, Temporal, OpenTelemetry y Langfuse.
- Pricing oficial de Warp, Factory.ai, Devin y OpenHands.
- Señales secundarias seleccionadas de Reddit y YouTube.
- No instalé ni ejecuté ninguno de esos proyectos; las conclusiones sobre experiencia operativa son provisionales.
- No encontré una API pública estable y documentada de AFFiNE comparable a Notion; esa integración necesita un spike específico.
- Warp Factories está en early access, Mastra Factory está en alpha y varios protocolos siguen evolucionando. Sus superficies pueden cambiar rápidamente.

---

## Cómo encajan los proyectos

| Proyecto                                                                                        | Qué es realmente                                                                                                             | Qué aprovecharía                                                                                                                  | Qué no copiaría                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mastra Factory](https://factory.mastra.ai/)                                                    | Showcase vertical de Mastra para entrega de software: intake, board, agentes, planificación y PR review                     | Modelo de UI, fases del board, configuración progresiva e integración GitHub/Linear/Slack                                         | Confundir la alpha de Factory con la madurez del framework Mastra; acoplar el núcleo a Mastra Platform. El template es Apache-2.0 y funciona localmente, pero el despliegue oficial usa la plataforma para auth, base de datos y sandboxes |
| [Mastra](https://mastra.ai/)                                                                     | Framework general 1.x para agentes, workflows, storage, schedules, memoria y observabilidad; Factory es un caso de uso       | Primitivas del core y la separación entre workflow determinista y pasos AI                                                     | Usarlo sin comparar su semántica de checkpoints, HITL y durabilidad con .NET; asumir que Mastra Factory representa todo el framework |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)                       | SDK .NET para agentes y graph workflows                                                                                        | Routing tipado, fan-out/in, checkpoints, HITL, YAML declarativo y OTel; encaje con ASP.NET, Teams y Azure DevOps                | Tratar checkpoints como sustituto de un control plane durable o Temporal; algunas superficies siguen en preview |
| [Warp Factories](https://www.warp.dev/blog/open-infrastructure-for-building-a-software-factory) | Producto comercial de control plane: factory-as-code, agentes/harnesses intercambiables, métricas, evals y canales           | Visión de producto, métricas como coste por PR y porcentaje automatizado, configuración versionada                                | Su control plane gestionado y las funciones self-hosted reservadas a Enterprise                                                                                         |
| [OpenAI Symphony](https://github.com/openai/symphony)                                           | Especificación y referencia mínima de un daemon que lee tickets, crea workspaces y ejecuta Codex                             | Límites conceptuales, recuperación, concurrencia acotada, `WORKFLOW.md`, observabilidad mínima                                    | Considerarlo una factory completa: excluye deliberadamente UI rica, motor general de workflows y sandbox fuerte                                                         |
| [Sandcastle](https://github.com/mattpocock/sandcastle)                                          | Librería TypeScript para lanzar coding agents en Docker/Podman/Vercel y reconciliar ramas                                    | Contrato de `SandboxProvider`, ciclo de branch/commit y soporte multi-harness                                                     | Usarlo como control plane: carece de estado de producto, inbox multiusuario y durabilidad completa                                                                      |
| [Archon](https://github.com/coleam00/archon)                                                    | OSS de workflows AI/deterministas con worktrees, dashboard, Slack/GitHub, persistencia y HITL                               | Comparador operativo del dominio y del validation harness                                                                        | Declararlo referencia principal sin un spike independiente; confundir worktree con aislamiento de seguridad                                                           |
| [Fusion](https://github.com/Runfusion/Fusion)                                                    | OSS amplio con dashboard, mailbox, approvals, chat, visual workflows, agents/missions y worktrees                         | Comparador de superficie operativa y de cuánto producto puede reutilizarse                                                     | Heredar una superficie grande y rápidamente cambiante sin validar trackers, seguridad y licencias                                                                     |
| [Coleam Dark Factory](https://github.com/coleam00/dark-factory-experiment)                      | Experimento operativo construido sobre Archon y GitHub como máquina de estados                                               | Perímetro inmutable que la factory no puede modificar, revisores independientes y dispatcher sin LLM                              | GitHub labels como única base de estado para un futuro SaaS multi-tracker                                                                                               |
| [Buzz](https://github.com/block/buzz)                                                           | Workspace self-hosted donde personas y agentes comparten canales, identidad y event log                                      | UX de colaboración, agente como miembro y auditabilidad de mensajes/acciones                                                      | Convertir mensajería en el centro de todo el dominio. Una conversación no sustituye al estado de ejecución                                                              |
| [T3 Code](https://github.com/pingdotgg/t3code)                                                  | “Agent harness control surface” local/remota para Codex, Claude, Cursor, Grok y OpenCode                                     | UX de sesiones concurrentes, attach/resume, acceso web/móvil y selección de harness                                               | Tomarlo como workflow engine o tracker. El propio proyecto se declara muy temprano                                                                                      |
| [OpenHands](https://docs.openhands.dev/sdk/index)                                               | SDK MIT, agent server, UI y ejecución local/remota; las capacidades multiusuario avanzadas son comerciales                   | Contrato agent-server/workspace, soporte ACP y SDK de coding agent completo                                                       | Depender de su edición Enterprise para que tu producto sea multiusuario                                                                                                 |
| [Agent-Native](https://github.com/QueTea333/agent-native)                                       | Framework TS para compartir acciones, datos y estado entre UI y agentes                                                      | El patrón “una acción, dos consumidores”: UI y agente llaman la misma operación validada                                          | Adoptarlo como fundamento ahora: es extremadamente reciente y sin señal pública de adopción suficiente                                                                  |

La investigación confirma una convergencia clara: tracker → workflow versionado → workspace aislado → agente → validación → evidencia → revisión humana. La oportunidad está en hacer esa cadena portable y operable, no en inventar otra forma de generar código.

**Decisión derivada.** Mastra Factory, Archon y Fusion se comparan como productos/baselines verticales; Mastra y Microsoft Agent Framework se comparan como frameworks de core. No son sustitutos equivalentes y el resultado de uno no debe usarse como evidencia automática del otro.

---

## Recomendación de arquitectura

```text
GitHub / ADO / Linear       Slack / Teams       Notion / AFFiNE
          │                      │                     │
          └────────── Ingress adapters ───────────────┘
                              │
                     Canonical Work Item
                              │
              ┌──────── Factory Control Plane ────────┐
              │ inbox · runs · approvals · policies  │
              │ workflows · costs · audit · evidence │
              └───────────────┬──────────────────────┘
                              │
              deterministic workflow executor
                              │
                 Agent Adapter: ACP / native SDK
                              │
                   Sandbox Provider interface
                              │
               Docker Sandbox / container / remote
                              │
                      Git branch / PR
```

### Fuentes de verdad

| Información                              | Fuente autoritativa                                            |
| ---------------------------------------- | -------------------------------------------------------------- |
| Intención y aceptación                   | Tracker o documento original                                   |
| Especificación usada por una ejecución   | Snapshot inmutable con hash                                    |
| Código                                   | Git                                                            |
| Estado de runs, pasos y aprobaciones     | PostgreSQL de la factory                                       |
| Logs, spans, tokens y latencia           | OpenTelemetry                                                  |
| Vídeos, diffs, reports y outputs pesados | Disco local inicialmente; almacenamiento S3-compatible después |

No intentaría sincronizar todo bidireccionalmente. La factory guarda proyecciones y enlaces; el sistema originario conserva su autoridad.

### Stack recomendado

- ASP.NET Core como modular monolith. Encaja con Teams, Azure DevOps, procesos en background, SignalR/OpenTelemetry y tu experiencia.
- React/TypeScript para dashboard, inbox, editor de workflow y vistas de ejecución.
- PostgreSQL con tablas normales y un `run_events` append-only para auditoría. No hace falta event sourcing completo.
- Microsoft Agent Framework para agentes y grafos, aprovechando workflows, checkpointing y human-in-the-loop ya disponibles en [.NET](https://github.com/microsoft/agent-framework).
- Un workflow explícito y persistido al principio. Si necesitas ejecuciones de semanas, upgrades sin interrupción o decenas de workers, [Temporal](https://docs.temporal.io/) es la alternativa más sólida, aunque añade infraestructura.
- [ACP](https://github.com/agentclientprotocol) para controlar coding agents compatibles; adaptadores nativos cuando un harness ofrezca una API mejor.
- Runner inicial: adapter directo a Codex/Claude o ACP; [Sandcastle](https://github.com/mattpocock/sandcastle), OpenHands SDK y OpenAI Agents SDK son alternativas para comparar ciclo de sesión, commits, resume y outputs tipados.
- MCP para herramientas que el modelo pueda invocar. No usaría MCP como sustituto de webhooks/APIs deterministas del control plane.
- AG-UI para streaming agente–frontend; A2A solo cuando realmente tengas agentes externos independientes.
- Observabilidad: OTel para operación, `run_events` para auditoría y Langfuse como provider de traces LLM/evals. El spike debe comprobar que cambiar backend de observabilidad no cambia el dominio ni el audit log.

#### Technical spike: Mastra framework vs Microsoft Agent Framework

Mastra Factory es el showcase vertical; este spike compara directamente los frameworks que podrían sostener el core de agentes y workflows.

| Criterio | Mastra framework | Microsoft Agent Framework | Qué debe decidir el spike |
|---|---|---|---|
| Lenguaje y encaje | TypeScript; reutiliza primitives y referencias de Mastra Factory | .NET; encaja con ASP.NET, Teams, Azure DevOps y el stack del proyecto | Productividad real y coste de mantener un runtime adicional |
| Workflows | Steps tipados, schedules, storage/memory y Studio | Graph workflows, routing tipado, fan-out/in, checkpoints, HITL y YAML | Expresar stages, gates, retries, cancelación y reanudación |
| Integración | Más cercana a la referencia Factory y a la UI React | Más cercana al backend y telemetría .NET existentes | Cantidad de adapters y código puente necesario |
| Durabilidad | Verificar semántica de persistencia y replay | Verificar límites de checkpoints y recuperación | Qué queda en el control plane y cuándo entra Temporal |
| Riesgo | El framework es más amplio que la Factory alpha; revisar licencias por ruta | Paquetes y superficies en preview | Estabilidad, upgrades y coste de salida |

**Caso de prueba común:** `WorkItem → SpecSnapshot → plan → aprobación → ejecución de agente → validación → evidencia → PR`, con reinicio, retry, cancelación y webhook duplicado. La salida no es elegir el framework con más features, sino el que permita conservar el dominio y sustituir el runtime sin migración.

**Alternativa de durabilidad:** ejecutar Mastra o Microsoft Agent Framework dentro de activities de Temporal si las runs duran horas/días, esperan gates humanos o deben sobrevivir despliegues. Un workflow persistido propio basta para el primer tracer bullet sólo si pasa los invariantes de recuperación e idempotencia.

**Sin spike por ahora:** modular monolith frente a microservicios, PostgreSQL frente a otra base de datos, event sourcing completo, plugin loader y A2A no cambian el tracer bullet lo suficiente para justificar infraestructura adicional. Postgres, `run_events` append-only y object storage compatible con S3 son decisiones reversibles mientras no fallen la concurrencia o la retención medidas.

### UI configurable

Usaría [CopilotKit](https://github.com/CopilotKit/CopilotKit): MIT, React/Angular, AG-UI, shared state, HITL, generative UI y canales Slack/Teams.

Pero no haría el dashboard completamente generativo. Un operador necesita que “Cancelar”, “Aprobar”, coste y estado estén siempre en el mismo sitio.

Separación recomendada:

- UI fija y declarativa: inbox, board, run timeline, costes, filtros, políticas.
- UI generativa acotada: explicación de fallos, resumen de PR, comparación de planes, formularios de aclaración y tarjetas de aprobación.
- Layout configurable mediante módulos registrados y configuración almacenada, no JSX inventado por el modelo.

**Alternativas:** Agent-Native merece un spike si se quiere compartir exactamente la misma acción validada entre UI, agente, HTTP, CLI y MCP. Una UI React convencional con command API directa es la opción más pequeña si CopilotKit/AG-UI añade más acoplamiento que valor. T3 Code y OpenHands Agent Canvas son referencias de consola, no dependencias asumidas.

**Criterio del spike:** una aprobación y una cancelación deben ejecutar el mismo comando tipado desde dashboard, chat y canal, con autorización y audit idénticos. Si no se cumple, la UI generativa queda limitada a lectura, explicación y formularios no privilegiados.

---

## Integraciones

Orden recomendado:

1. GitHub Issues + GitHub App + repositorios Git.
2. Azure DevOps Work Items y repos.
3. Teams.
4. Slack y Linear.
5. Notion.
6. AFFiNE cuando exista un contrato público estable o mediante un adaptador experimental.

Azure DevOps dispone de [service hooks/webhooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops), Linear tiene SDK TypeScript y verificación de [webhooks](https://linear.app/developers/sdk-webhooks), Notion ofrece [API y webhooks firmados](https://developers.notion.com/reference/webhooks), y Teams tiene SDK oficial para [.NET y TypeScript](https://learn.microsoft.com/en-us/microsoftteams/platform/teams-sdk/).

No construiría un plugin loader dinámico en la primera versión. Empezaría con módulos compilados que implementen contratos pequeños; el sistema de plugins aparece cuando exista un segundo integrador externo que necesite desplegar/versionar uno independientemente.

**Alternativas y spikes de integración:**

- **Slack/Teams:** CopilotKit Channels es el camino corto y multicanal; Slack Bolt y Teams SDK son preferibles si hacen falta identidad corporativa, Adaptive Cards, Graph, proactive messaging o control de tenant. El spike debe probar approvals, respuestas proactivas, permisos y correlación de eventos en ambos canales.
- **Trackers:** GitHub App, Azure DevOps Service Hooks y Linear webhooks deben permanecer como adapters delgados. El primer spike de port debe cubrir GitHub + Azure DevOps para comprobar que `watch`, `claim`, `transition`, `attachRun` y `linkPR` no esconden diferencias esenciales.
- **Documentos:** API REST/webhooks para ejecución headless; MCP sólo cuando aporte una capacidad que no tenga la API determinista. AFFiNE queda en spike separado: detectar capacidades por workspace y validar lectura, snapshot y escritura antes de convertirlo en dependencia.
- **Plugins:** módulos compilados primero. Un loader dinámico sólo merece spike cuando un segundo integrador necesite desplegarse y versionarse fuera del ciclo principal.

---

## Sandboxing y seguridad

Para desarrollo y primer VPS probaría [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) en modo clone. Cada agente recibe microVM, kernel, Docker daemon, filesystem y red propios. El modo clone evita que el agente modifique directamente el checkout anfitrión.

Guardrails mínimos:

- Credenciales entregadas mediante proxy o referencias, nunca copiadas al workspace.
- Red deny-by-default con allowlist por workflow.
- Repositorio clonado por ejecución.
- Límites de CPU, RAM, disco y tiempo.
- Ningún acceso al socket Docker del host.
- Operaciones de merge, publish, secrets o producción fuera del sandbox y sujetas a aprobación.
- Perímetro versionado que los agentes no puedan modificar, siguiendo la lección del Dark Factory de Coleam.

Contenedores normales son aceptables para el prototipo, pero no constituyen una frontera suficiente frente a código no confiable. Para SaaS público o múltiples organizaciones, necesitarías microVMs, gVisor/Kata o un proveedor especializado.

**Alternativas:** [Azure Container Apps Dynamic Sessions](https://learn.microsoft.com/en-us/azure/container-apps/sessions) si el entorno objetivo es Azure/Teams/ADO; [E2B](https://github.com/e2b-dev/E2B) para un provider portable; [Vercel Sandbox](https://vercel.com/docs/sandbox) para DX TypeScript y microVMs; Daytona como servicio gestionado si se acepta dependencia comercial. Sandcastle resuelve el ciclo del runner y Git, pero no debe confundirse con una frontera de seguridad.

**Technical spike:** implementar el contrato `SandboxProvider` con Docker Sandboxes y una alternativa fuerte. Comparar clone/mount, exec/stream, artifacts, kill/TTL, cuotas, egress allowlist, secret brokerage y attestación de teardown. La salida debe incluir un intento de escape, una prueba de secreto en logs y recuperación tras matar el sandbox.

---

## Alternativas

### 1. Mastra framework como core; Mastra Factory como acelerador vertical

Mastra framework es la alternativa TypeScript que debe compararse con Microsoft Agent Framework. Aporta el runtime general; Mastra Factory aporta un caso de uso concreto con board, intake, fases, reglas, UI e integraciones.

La alpha de Factory limita su uso como dependencia estable, pero no invalida el framework. El spike debe medir cuánto de Factory se puede reutilizar sin adoptar su control plane ni su plataforma gestionada.

### 2. Archon, Fusion y OpenHands como comparadores OSS

Archon sirve para comparar workflows AI/deterministas, HITL, worktrees y persistencia; Fusion para comparar una superficie operativa más amplia; OpenHands Agent Canvas para consola y automatizaciones. Symphony + Sandcastle siguen siendo la opción mínima de kernel + runner.

No adoptaría ninguno por cobertura nominal. Cada uno debe pasar el mismo tracer bullet y la misma prueba de aislamiento, recuperación y segundo tracker.

### 3. Comprar Warp, Factory.ai, Devin, Codegen u OpenHands Enterprise

Correcto si la prioridad pasa de aprender a obtener productividad interna rápidamente.

Precios observados el 24-08-2026:

- [Warp](https://www.warp.dev/pricing): factory pay-as-you-go con 20% de markup; workers self-hosted en Enterprise.
- [Factory.ai](https://factory.ai/pricing): Pro $20, Plus $100, Max $200; on-premise en Enterprise.
- [Devin](https://docs.devin.ai/admin/billing/self-serve): Pro $20, Max $200 y Teams desde $80/mes. Su “brain” permanece en Cognition Cloud incluso con Devbox en VPC.
- [Codegen](https://docs.codegen.com/integrations/integrations): alternativa SaaS centrada en sesiones desde canales/trackers, sandboxes y seguimiento de PR/CI.
- [OpenHands](https://www.openhands.dev/pricing): OSS local gratuito y single-user; multiusuario self-hosted bajo precio Enterprise personalizado.

Ninguna encaja tan bien como proyecto de aprendizaje soberano, aunque todas son benchmarks valiosos.

**Technical spike build/buy:** ejecutar Mastra Factory extendida, kernel propio inspirado en Symphony + Sandcastle y un piloto comercial con el mismo conjunto de 10–20 tareas. Decidir con coste por PR aceptada, tiempo hasta PR, intervenciones humanas, rework, recuperación, seguridad y esfuerzo para añadir un segundo tracker o canal. Si GitHub es el único system of record, incluir GitHub Copilot como alternativa de baja fricción.

---

## Plan de construcción

0. Ejecutar el spike de Mastra framework vs Microsoft Agent Framework con el mismo flujo y contrato de runtime. Mantener Temporal como alternativa de durabilidad, no como decisión implícita del spike.

1. Entregar un único flujo GitHub end-to-end:

   `issue con label → inbox → investigar → aprobación → implementar en sandbox → validar → draft PR`.

   Debe sobrevivir a un reinicio, mostrar cada paso en la UI y adjuntar diff, comandos, test result, tokens y coste.

2. Añadir Azure DevOps y Teams sobre el mismo modelo canónico, sin cambiar el workflow. Esto valida que la abstracción de entrada sea real.

3. Incorporar workflows configurables, políticas, evals y un segundo agent adapter. Solo entonces separar plugins o workers independientes.

4. Añadir Notion, Slack y Linear; conservar AFFiNE como experimental hasta verificar su API.

5. Antes de plantear SaaS: organizaciones, RBAC, aislamiento por tenant, secrets, cuotas, facturación, retención y borrado de datos.

### Validación de la primera slice

Prueba enfocada:

- Entregar dos veces el mismo webhook: debe existir un solo run.
- Matar el backend durante validación y reiniciarlo: no debe repetirse ningún paso irreversible.
- Intentar escribir fuera del repositorio clonado: debe fallar.
- Rechazar la aprobación: no debe ejecutarse implementación.
- Forzar tests fallidos: el draft PR no debe considerarse listo y la evidencia debe mostrar el comando exacto.
- Cambiar la especificación original durante el run: la ejecución debe conservar el snapshot inicial.
- Repetir y desordenar webhooks, forzar timeout/cancelación/retry: no deben duplicarse commit, PR ni efectos irreversibles.
- Entregar un secreto a una herramienta autorizada: no debe aparecer en workspace, prompt, logs ni artifacts.
- Ejecutar el mismo flujo con Mastra framework y Microsoft Agent Framework detrás del mismo contrato de runtime.

El escalado a Temporal o workers distribuidos solo queda justificado cuando fallen estos invariantes, haya ejecuciones de larga duración que no sobrevivan despliegues, o una sola máquina deje de sostener la concurrencia medida.

---

## Cuándo sería incorrecta esta recomendación

- Si quieres valor interno en menos de un mes y aprender es secundario: adopta Mastra Factory, OpenHands Agent Canvas, GitHub Copilot o un producto comercial según tus integraciones.
- Si necesitas desde el inicio air-gap, SSO empresarial, auditoría certificada o usuarios no confiables: evalúa OpenHands/Factory/Warp Enterprise.
- Si GitHub cubre todos tus repositorios y automatizaciones: GitHub Copilot cloud agent o GitHub Agentic Workflows pueden ser suficientes; Archon sólo merece la pena si necesitas su workflow OSS.
- Si una prueba real demuestra que Microsoft Agent Framework no recupera runs exactamente como necesitas: conserva ASP.NET/React, pero sustituye su ejecución durable por Temporal.

Mi conclusión: hay mercado para tu proyecto, pero su identidad debería ser “control plane abierto y portable para el SDLC agentic”, no “otro agente de programación”. Mastra Factory es el baseline vertical; Mastra framework y Microsoft Agent Framework son los candidatos de core que deben compararse; Archon y Fusion son comparadores OSS; Warp, Factory.ai, Devin y Codegen son referencias comerciales; Symphony, Sandcastle, CopilotKit/AG-UI y ACP son las piezas estándar que evitarían construir toda la fontanería desde cero.
