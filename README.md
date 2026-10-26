# Minthouse

Open-source multi-chain token launchpad. It launches three kinds of token, and it records a launch only after it has verified the result on chain:

| Mode | What you get |
| --- | --- |
| `bsc-erc20` | A non-upgradeable ERC-20 on BNB Smart Chain. You choose decimals and the initial supply. The owner can mint more until minting is permanently disabled. |
| `solana-spl` | An SPL token with Metaplex metadata. You choose decimals and the initial supply. The mint authority can mint more until it is revoked. |
| `pumpfun` | A real Pump.fun bonding-curve launch through the official Pump program. Supply and decimals are fixed by the program, and mint authority is removed. |

The chain is the source of truth. PostgreSQL is an index and an audit trail: a deployment is completed, and a token is listed, only after the API has checked the on-chain state itself.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `packages/shared` | `@minthouse/shared` | Domain types, validation, amount math, launch-mode rules |
| `packages/config` | `@minthouse/config` | Environment schemas for the API and operator scripts |
| `packages/blockchain` | `@minthouse/blockchain` | BSC, Solana, and Pump.fun clients |
| `chains/bsc` | `@minthouse/chain-bsc` | `LaunchpadToken` contract, Hardhat tests, and operator scripts |
| `chains/solana` | `@minthouse/chain-solana` | SPL and Pump.fun operator scripts |
| `apps/api` | `@minthouse/api` | HTTP API for metadata, deployments, and reconciliation |

Packages are marked `private` so they are not published to npm by accident. The source is MIT licensed; publishing individual packages is a separate step.

## Requirements

- Node.js 22.21 (see `.nvmrc`), or any 22.12+ below 23, or 24+
- pnpm 10.15
- PostgreSQL server binaries, for the local database script

## Develop

```bash
pnpm install
pnpm db:local:start
pnpm api:dev
```

`pnpm db:local:start` creates a PostgreSQL cluster in `.local-postgres/` that listens on `127.0.0.1:54329` only. Copy `apps/api/.env.example` to `apps/api/.env` if you want to override the defaults. Production storage uses Pinata (`STORAGE_PROVIDER=pinata` and `PINATA_JWT`); local file storage is for development.

```bash
pnpm run build:packages
pnpm --filter @minthouse/shared --filter @minthouse/config --filter @minthouse/blockchain test
pnpm --filter @minthouse/chain-bsc test
pnpm api:test
```

API tests migrate `minthouse_test` and delete every row in it. Point `TEST_DATABASE_URL` at a database whose name ends in `_test`.

Operator scripts live in `chains/bsc` and `chains/solana` (`deploy`, `mint`, `burn`, and the `pump:*` commands). They read the same environment schemas as the API. Do not commit keypairs, `.env` files, or deployment receipts.

## License

[MIT](LICENSE)
