# Topology Factory prototype

Throwaway two-process harness for the BFF/Mastra boundary, PostgreSQL-backed
workflow state, SSE replay, and operator approval.

From this directory, start it with one command:

```sh
docker compose up -d postgres && npm run prototype
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). The supervisor control
API listens on `http://127.0.0.1:4312`.

Stop the foreground supervisor with `Ctrl+C`. Reset the disposable database
and its volume with:

```sh
docker compose down -v
```

Run the reproducible check with:

```sh
npm run self-check
```

It starts only its own supervisor and resets only the scratch schemas. It
refuses to replace a process already listening on ports 4310–4312.

> Warning: this uses only the scratch database `topology_prototype` on port
> 55433. `docker compose down -v` permanently removes its prototype volume;
> never point `DATABASE_URL` at a non-disposable database.

See [PROTOTYPE-REPORT.md](PROTOTYPE-REPORT.md) for the observed verdict.
