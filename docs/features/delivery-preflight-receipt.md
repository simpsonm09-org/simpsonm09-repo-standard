# Delivery preflight receipt

`tools/delivery-receipt/` keeps `receipt.mjs` as the stable public facade. `receipt-evaluator.mjs` owns pure evidence evaluation, `receipt-collector.mjs` owns bounded Git and filesystem reads, `receipt-codec.mjs` owns byte/hash descriptions, and `receipt-validation.mjs` owns input validation and shared hash primitives. The collector reads repository identity, HEAD, branch, explicitly named source files, optional installed helpers, and tool availability. The evaluator combines that snapshot with supplied account, host-input, route, execution, and external-decision evidence.

`--repo` must name the Git working-tree root; a subdirectory is rejected. Repository identity comparison uses `host[:port]/full/nested/path`, so the remote host, port, and every path segment must match. Repository matching uses `origin` only. For a paired fork/upstream workflow, supply `expectedRepository` as the owned upstream and `expectedOrigin` as the exact expected fork; both must match the named remotes. A good `upstream` cannot hide an unexpected `origin`. Without a readable `origin`, the repository result is `unverified`. `expectedBranch` and `expectedHead` are checked when supplied; an expected head must be 7 to 40 hexadecimal characters.

The receipt keeps raw working-tree hashes separate from the Git blob recorded at `HEAD`. For valid UTF-8 text it also reports an LF-normalized hash and line-ending description, so a CRLF checkout does not get confused with the committed blob. Binary and non-UTF-8 files have no normalized text hash. Expected source hashes are compared only to the current working-tree hash. Source files over 25 MiB are reported as too large without hashing.

## Run

Save input to a JSON file, then run:

```text
just delivery-receipt --input preflight.json --repo .
```

Use `--input -` to read JSON from standard input. `--expected-account NAME` supplies the expected account explicitly; otherwise the input can include `expectedAccount` or an `accountFolder` whose final path component is the expected account. An observed account is considered only when `observedAccountSnapshot` includes `account`, `approved: true`, `sanitized: true`, and explicit `provenance`. Missing or incomplete account evidence is `unverified`.

The input accepts `typedCommand.text` or `typedCommand.sha256`; text is hashed as data and never appears in the receipt or CLI output. A supplied text/hash disagreement affects `evidenceStatus`. `hostObservedInputHash` is separate, hash-only, and remains `unobserved` when omitted; any host-input body field is ignored. Planned route data and actual execution evidence are distinct; without explicitly supplied external evidence, actual execution is `unknown`.

Provide proposed source paths explicitly in `proposedSourcePaths`; each can include an `expectedCurrentHash`. Every supplied hash field must be a 64-character SHA-256 hex digest. Optional `installedHelperPaths` are hashed as installed-helper scope. Optional `tools` entries use an explicit `path` or resolve a `name` from `PATH`; output records only a hash and presence flag for the tool name and its availability. It never includes the name or absolute path. Missing tools are recorded and no tool is installed. Tool version commands are not run.

An optional `externalDecision` is labeled caller-supplied and unverified as authority. The receipt checks its scope against `expectedRepository`, then reports whether its supplied `effectiveLevel` is `full` for standing `publish` or `activate` operations. This is evidence consistency only; the receipt does not resolve authorization or raise a level. The top-level `evidenceStatus` is `consistent`, `mismatch`, or `unverified`; the consistency object explicitly says this is caller-supplied evidence consistency, with no live verification or authorization.

## Output contract

Output uses an allowlisted schema. Caller text used for comparisons is not copied into the receipt. Free-text values such as account names, branch names, repository expectations, routes, provenance, decision scope, tool names, and requested file paths are represented only by `{ "present": boolean, "sha256": string|null }`. Decision level is the closed value `full`, `other`, or `null`; statuses and remote names are closed enums. Command and source hashes remain SHA-256 values. Repository identity comparison retains the complete host, optional port, and nested path internally, while output carries only its presence and SHA-256. Raw remote URLs, local filesystem paths, and tool paths are omitted. Malformed JSON, unreadable input files, invalid path types, and unknown options produce fixed messages without printing input fragments or machine paths.

Input is limited to 1 MiB, 50 proposed sources, 20 installed-helper paths, 30 tools, 4,096 characters per path, and 65,536 command-text characters. Git blob sizes are checked before content reads; blobs over 25 MiB are reported as too large. Other blob reads have an explicit buffer limit and report missing or unreadable blobs. A missing working-tree path is recognized only by `ENOENT`; other metadata failures are `unreadable` with the fixed reason `file-metadata-read-failed`, and make receipt evidence unverified. The receipt does not read authentication state, scan environment/configuration/secret stores, execute the typed command, or scan secrets. It does not call remote services. Hashes of caller-named files can still reveal low-entropy values through guessing; only provide paths appropriate for a hash-only receipt.
