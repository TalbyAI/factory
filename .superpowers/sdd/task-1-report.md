# Task 1 — Disposable topology harness

## Resultado

`validated` para el scaffold de Task 1. Se implementaron únicamente las interfaces de configuración, PostgreSQL scratch y protocolo JSON/SSE definidas en el brief.

## Cambios

- `prototypes/tanstack-copilotkit-mastra-topology/package.json`
  - Manifest ESM privado.
  - Dependencias fijadas a `@mastra/core` 1.64.0, `@mastra/pg` 1.22.3, `pg` 8.16.3 y `zod` 4.1.8.
  - Scripts `prototype` y `self-check` apuntan a las fases posteriores del harness.
- `prototypes/tanstack-copilotkit-mastra-topology/package-lock.json`
  - Generado por `npm install`, como exige el Step 5 del brief.
- `prototypes/tanstack-copilotkit-mastra-topology/compose.yaml`
  - PostgreSQL 17 Alpine en `localhost:55433`.
  - Base explícita `topology_prototype`, usuario `prototype`, volumen `topology-prototype` y healthcheck.
- `prototypes/tanstack-copilotkit-mastra-topology/src/config.mjs`
  - Defaults para base de datos, puertos, URL BFF y token de servicio.
- `prototypes/tanstack-copilotkit-mastra-topology/src/db.mjs`
  - Pool PostgreSQL, guard de base scratch, reset de `topology_factory` y `topology_mastra`, y cierre del pool.
- `prototypes/tanstack-copilotkit-mastra-topology/src/protocol.mjs`
  - Helpers JSON, lectura JSON, headers SSE, eventos SSE y conversión de filas.

No se implementaron BFF, proceso Mastra, supervisor, UI ni self-check; pertenecen a Tasks posteriores.

## Comprobaciones

| Comprobación | Evidencia |
|---|---|
| Sintaxis de `config.mjs`, `db.mjs`, `protocol.mjs` | `node --check` terminó con código 0 para los tres archivos. |
| Manifest | `package.json` parseó correctamente. |
| Instalación | `npm install` terminó con código 0; añadió 172 paquetes, auditó 173 y reportó 0 vulnerabilidades. |
| PostgreSQL | `docker compose up -d postgres` terminó con código 0; el contenedor alcanzó `healthy`. |
| Reset scratch | El comando exacto del brief con `resetSchemas` terminó con código 0. |
| Aislamiento observado | `current_database()` devolvió `topology_prototype`; existen `topology_factory` y `topology_mastra`. |
| Tablas creadas | `topology_factory.commands`, `topology_factory.effects`, `topology_factory.missions` y `topology_mastra.events`. |
| Formato | `git diff --check` no reportó errores. |

La primera consulta auxiliar de inspección de tablas usó un `ORDER BY` inválido; se corrigió y se repitió con éxito. No fue un fallo del harness.

## Concerns

- `npm install` creó `node_modules` localmente para verificar el import de `pg`; la limpieza automática fue rechazada por la política de ejecución. No se añadirá al commit.
- `npm run prototype` y `npm run self-check` todavía no son ejecutables porque sus archivos pertenecen a Tasks posteriores; esto es intencionado para Task 1.
- El contenedor PostgreSQL quedó levantado tras la comprobación; sus datos son exclusivamente del volumen scratch `topology-prototype`.
