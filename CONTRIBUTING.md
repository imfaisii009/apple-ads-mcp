# Contributing

Thanks for helping out.

## Setup

```bash
bun install
bun run typecheck
bun run smoke
```

## The tool catalog is generated

`generated/tools.json` and `generated/manifest.json` are built from
`openapi/apple-ads.openapi.json`. Never hand-edit them. Change the generator or
the spec, then run:

```bash
bun run generate
```

CI fails if the committed catalog does not match a fresh generation.

## Pull requests

- One logical change per pull request.
- Run `bun run typecheck` and `bun run smoke` before pushing.
- Do not commit credentials, `.env` files, or `.p8` keys.
