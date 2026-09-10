# Diseño: aislamiento Docker por Mission

Fecha: 2026-09-10

## Pregunta

¿Cuál es la configuración Docker local mínima que aísla checkout, procesos,
red y secretos por Mission y devuelve Artifacts verificables sin exponer el
host?

## Decisión de diseño

Construir un harness throwaway en
`prototypes/mission-docker-isolation/`, ejecutado desde el host mediante Node y
Docker Compose CLI. Compose definirá la configuración endurecida de una
Mission; el controlador host lanzará dos proyectos temporales con directorios
únicos, sin montar el Docker socket dentro de la Mission.

La configuración candidata del contenedor será:

- imagen Node 24 Alpine con usuario no root;
- `network_mode: none`;
- root filesystem de sólo lectura;
- `cap_drop: ALL` y `no-new-privileges`;
- límites de memoria, CPU y PIDs;
- `/tmp` como `tmpfs` efímero;
- checkout montado en `/mission` como sólo lectura;
- un único directorio de salida montado en `/artifacts` como escritura;
- sólo `MISSION_ID` y `SCENARIO` como variables explícitas.

El controlador no pasará secretos, no montará el host ni el Docker socket y
calculará el SHA-256 de cada Artifact producido. La identidad de cada
contenedor y la configuración efectiva se conservarán en la evidencia.

## Frontera de confianza

El código de la Mission y el contenido del checkout se consideran no
confiables. El controlador, Docker Engine, el host y el kernel son confiables.
El resultado no será una garantía contra un escape del kernel, un Docker
daemon comprometido ni un host comprometido; esas fronteras requieren otra
decisión de sandboxing.

## Alternativas consideradas

1. **Controlador Node host-side + Compose CLI** — elegido: prueba la frontera
   real, conserva la convención Docker Compose del repositorio, no añade
   dependencias y no concede el Docker socket a la Mission.
2. `docker run` directo — descartado por ahora: sería ligeramente más corto,
   pero duplicaría la configuración canónica fuera de Compose.
3. SDK de Docker o Testcontainers — descartado: añade dependencia y abstracción
   sin aportar evidencia necesaria para este spike.

## Escenarios de evidencia

1. Una Mission lee su checkout y produce un Artifact JSON en su salida.
2. La Mission no puede modificar el checkout; su hash permanece igual.
3. Dos Missions concurrentes sólo ven sus propios marcadores, directorios y
   Artifacts.
4. La red está deshabilitada y una conexión de prueba falla.
5. Un sentinel de secreto que sólo existe en el host no aparece en el entorno
   ni en el filesystem de la Mission.
6. La inspección del contenedor confirma rootfs read-only, usuario no root,
   ausencia de red host, capacidades eliminadas y ausencia de montajes no
   autorizados.
7. El controlador limpia sus contenedores y directorios temporales sin usar
   volúmenes persistentes ni comandos globales de Docker.

El self-check será un único script assertivo, sin framework de pruebas. Cada
ejecución producirá un manifest local con MissionId, containerId, configuración
observada, estado de salida, lista de Artifacts y hashes.

## Estructura y ejecución

El prototipo incluirá `Dockerfile`, `compose.yaml`, `package.json`, un
controlador host-side, el workload no confiable, `README.md` y
`PROTOTYPE-REPORT.md`. Se ejecutará desde su directorio con:

```text
npm run prototype
```

El controlador creará directorios temporales por Mission, ejecutará Compose
con un nombre de proyecto único y limpiará en un bloque `finally`. No habrá
conexión a GitHub, Azure DevOps, PostgreSQL ni servicios externos.

## Criterios de aceptación

- El comando termina con código cero cuando todos los escenarios pasan.
- La evidencia prueba aislamiento de checkout, procesos, red y secretos según
  la frontera de confianza declarada.
- El Artifact de cada Mission tiene un hash reproducible y sólo aparece en su
  directorio de salida.
- No quedan contenedores, listeners, secretos ni volúmenes del prototipo tras
  la limpieza.
- El README permite repetir la comprobación en un Docker local limpio.
- El informe distingue evidencia observada de garantías no demostradas.

## Límites

Quedan fuera allowlists de red, proxies o brokers de efectos, acceso real a
SCM, gestores de secretos, validación semántica de Artifacts, multi-tenancy,
carga, réplicas, failover, hardening contra un host comprometido,
Kubernetes/gVisor/VM y despliegue productivo. El prototipo tampoco modifica el
runtime de Factory.

## Salida e integración

El código y el informe vivirán en la rama `prototype/mission-docker-isolation`
como fuente primaria de la decisión. Se abrirá un pull request con el enlace
`Closes #15`; el ticket permanecerá abierto hasta que el PR se revise y se
integre. Después del merge se añadirá al mapa la decisión observada y el
puntero al informe.
