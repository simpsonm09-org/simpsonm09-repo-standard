# Documentation layout

Every repository in the fleet keeps the same documentation layout so a reader can move between repositories without relearning the structure. `scripts/check-standard.mjs` enforces the layout in the `docs` group. See [validation.md](validation.md) for the check ids.

## README

Keep `README.md` at the repository root with exactly one level-1 heading and a short section list. When the repository has a `docs/` tree, link `docs/README.md` from the README so the reader can reach the index.

## Docs index

Keep `docs/README.md` as the index when the repository has any markdown under `docs/`. Every other markdown file under `docs/` must be linked from the docs tree, so a document cannot become unreachable. Do not name a document so it differs from another only by case, as `readme.md` differs from `README.md`. Windows is case-insensitive and the two collapse into one file.

## Manifest

Keep `docs/manifest.json` at all times. The manifest declares which optional artifacts apply, so "when appropriate" is a fact the checker reads instead of a guess. Absent keys mean the artifact does not apply.

```json
{
  "readme": true,
  "features": ["docs/features/example.md"],
  "diagrams": ["docs/architecture.md"],
  "api": { "style": "openapi", "spec": "openapi.yaml" }
}
```

- `readme` is a boolean and reserved for future use.
- `features` lists one document per user-facing feature under `docs/features/`.
- `diagrams` lists documents that carry a flow, sequence, or architecture diagram.
- `api` declares an HTTP or messaging contract. `style` is `openapi` or `asyncapi`.

Unknown keys fail the check.

## Feature docs

Add a document under `docs/features/` for each feature a reader must understand to use or maintain the repository. A feature doc states what the feature does, the shape of its data, and the failure modes. Link every feature doc from `docs/README.md`.

## Diagrams

Add a diagram when a document describes a flow, a sequence, or a system boundary. Use a fenced `mermaid` block. `plantuml`, `graphviz`, and `dot` fences also pass the check. GitHub renders Mermaid natively, so prefer it.

## API contracts

A repository that exposes an HTTP API keeps an OpenAPI document. A repository that publishes or consumes messages keeps an AsyncAPI document. Declare the document in the manifest. The check confirms the file exists and declares a version.

The document is generated from the code, not hand-edited. Annotate the handlers and the schema types, and let the framework emit the document. The code is then the only source, and the checked-in document cannot drift from it. Add a `spec` recipe that regenerates the document, and mark the generated file `linguist-generated` in `.gitattributes`. The `test` job runs the recipe and fails when regeneration changes the file, so a hand edit goes red.

The check reports `docs/api-generated` when a declared document is not marked generated or the `justfile` has no `spec` recipe.

Frameworks that emit the document: FastAPI for Python, Fastify with `@fastify/swagger` for Node, and springdoc-openapi for Kotlin with Spring Boot.

## Optional directories

A repository may add these under `docs/`.

- `docs/decisions.tsv` is the append-only decision trail.
- `docs/runbooks/` holds operational procedures.
- `docs/machines/` holds per-machine notes.

## Templates

Start from [`../templates/docs/`](../templates/docs/). The directory holds an index, a manifest, an architecture page, and a feature page skeleton.
