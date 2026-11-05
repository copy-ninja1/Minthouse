# Minthouse

An open-source token launchpad for BNB Smart Chain, Solana, and Pump.fun. You create a token from the web app or the API, and the launch is listed only after the chain confirms it.

Three launch modes:

| Mode | What you get |
| --- | --- |
| `bsc-erc20` | A non-upgradeable ERC-20 on BNB Smart Chain. Pick the decimals and the initial supply. The owner can mint more until minting is permanently disabled. |
| `solana-spl` | An SPL token with Metaplex metadata. Pick the decimals and the initial supply. The mint authority can issue more until it is revoked. |
| `pumpfun` | A real Pump.fun bonding-curve launch through the official Pump program. Supply and decimals come from the program, and mint authority is removed. |

The API marks a deployment complete only after it reads the on-chain state back. PostgreSQL keeps the index and the audit trail.

## Repository layout

| Path | Package | Role |
| --- | --- | --- |
| `packages/shared` | `@minthouse/shared` | Domain types, validation, amount math, launch-mode rules |
| `packages/config` | `@minthouse/config` | Environment schemas for the API and operator scripts |
| `packages/blockchain` | `@minthouse/blockchain` | BSC, Solana, and Pump.fun clients |
| `chains/bsc` | `@minthouse/chain-bsc` | `LaunchpadToken` contract, Hardhat tests, and operator scripts |
| `chains/solana` | `@minthouse/chain-solana` | SPL and Pump.fun operator scripts |
| `apps/api` | `@minthouse/api` | HTTP API for metadata, deployments, and reconciliation |
| `apps/web` | `@minthouse/web` | Browser client for creating and browsing launches |

Every workspace package is marked `private`, so `pnpm publish` will not push one to npm by accident. The source is MIT licensed; publishing individual packages is a separate decision.

## Requirements

- Node.js 22.21, the version in `.nvmrc`. `package.json` also accepts 22.12 up to but not including 23, or 24 and later
- pnpm 10.15
- PostgreSQL server binaries, for the local database script

## Run the API locally

```bash
pnpm install
pnpm db:local:start
pnpm api:dev
```

`pnpm db:local:start` creates a PostgreSQL cluster in `.local-postgres/` that listens on `127.0.0.1:54329` only. Copy `apps/api/.env.example` to `apps/api/.env` if you want to change the defaults.

Production uploads go to Pinata: set `STORAGE_PROVIDER=pinata` and `PINATA_JWT`. Local file storage is for development.

For the browser client, run `pnpm web:dev` and copy `apps/web/.env.example` to `apps/web/.env`. That file documents the API URL, the enabled networks, and the optional RPC endpoints.

## Run the tests

```bash
pnpm run build:packages
pnpm --filter @minthouse/shared --filter @minthouse/config --filter @minthouse/blockchain test
pnpm --filter @minthouse/chain-bsc test
pnpm api:test
pnpm web:test
```

The API tests migrate `minthouse_test` and delete every row in it. Point `TEST_DATABASE_URL` at a database whose name ends in `_test`, or the suite refuses to start.

## Operator scripts

BSC scripts live in `chains/bsc` and cover `deploy`, `mint`, `burn`, and ownership transfer. Solana scripts live in `chains/solana` and add `pump:launch`, `pump:buy`, and `pump:sell` on top of the SPL commands. Both sets read the same environment schemas as the API.

Do not commit keypairs, `.env` files, or deployment receipts.

## License

[MIT](LICENSE)
