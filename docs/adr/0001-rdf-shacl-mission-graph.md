# Usar RDF y SHACL para el Mission Graph

El Mission Graph necesita expresar Assertions tipadas, extensibles y append-only y validar su vista efectiva sin acoplarla a los esquemas internos de un Workflow. Usaremos RDF 1.1 con shapes SHACL 1.0 para sus contratos persistidos; JSON Schema 2020-12 validará los Artifacts JSON y cada Artifact Type no JSON tendrá su validador versionado. La v1 no exige triple store ni JSON-LD: conserva semántica y validación portables sin añadir esas dependencias operativas ni inventar un modelo de grafo propio.
