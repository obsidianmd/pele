# Contributing

## Parser tests

Each diagram type has its own parser. We test these against Mermaid's parser specs and with differential fuzzing.

The tests compare accepted syntax and parsed diagram data. Find parser specs in `tests/compat/<type>/` and reasons for skipped cases in each directory's `SKIPPED.md`.

Run the library tests with `npm test`. Run `npm run test:website` after installing the website dependencies to check the playground.

## AI policy

Use of AI in contributions is neither encouraged nor prohibited. Code changes will be evaluated on their own merits. However, all PRs should be thoroughly human-tested and reviewed before submitting. We expect that you stand by the code and will close low-effort AI-generated submissions.
