# ADR-0002: Pinned toolchain versions

Status: Accepted (2026-11-03)

## Decision

All dependencies are pinned to exact versions (`save-exact=true`) and `pnpm-lock.yaml` is committed.

| Tool               | Version       | Notes                                              |
| ------------------ | ------------- | -------------------------------------------------- |
| Node.js            | 26 LTS        | `.nvmrc` and `engines`                             |
| pnpm               | 10.28.2       | `packageManager`                                   |
| TypeScript         | 6.0.3         | not 7, see below                                   |
| Prisma             | 7.10.x stable | not 8.0 release candidates                         |
| Vitest             | 5.1.0         | with `unplugin-swc` for NestJS decorators          |
| ESLint             | 10.4.0        | flat config, typescript-eslint strict-type-checked |
| dependency-cruiser | 18.7.2        | boundary rules                                     |
| Prettier           | 3.9.10        |                                                    |

## Why TypeScript 6, not 7

TypeScript 7 is available, but NestJS decorator support and the surrounding toolchain (typescript-eslint, SWC transform, Prisma generator output) are not verified against it. typescript-eslint currently supports TypeScript below 6.1. We stay on 6.0.x and revisit when the whole chain is verified.

## Why Prisma 7

Prisma 7.10.x is the latest stable line. The `latest` npm tag currently points at an 8.0 release candidate, which must not be used. Pin 7.10.x exactly and upgrade deliberately.
