-- CreateTable
CREATE TABLE "MetadataAsset" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "persistent" BOOLEAN NOT NULL,
    "uri" TEXT NOT NULL,
    "trustWalletUri" TEXT,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "document" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "tokenAddress" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "initialSupply" TEXT NOT NULL,
    "recipient" TEXT,
    "config" JSONB NOT NULL,
    "metadataId" UUID,
    "metadataUri" TEXT,
    "imageUri" TEXT,
    "txId" TEXT,
    "evmNonce" INTEGER,
    "lastValidBlockHeight" BIGINT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "verification" JSONB,
    "checkAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" UUID NOT NULL,
    "family" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "totalSupply" TEXT,
    "mode" TEXT,
    "imageUri" TEXT,
    "metadataUri" TEXT,
    "source" TEXT NOT NULL,
    "deploymentId" UUID,
    "onchainVerifiedAt" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "txId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "summary" TEXT NOT NULL,
    "chainStatus" TEXT NOT NULL DEFAULT 'unknown',
    "chainCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetadataAsset_kind_storage_sha256_key" ON "MetadataAsset"("kind", "storage", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_idempotencyKey_key" ON "Deployment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_txId_key" ON "Deployment"("txId");

-- CreateIndex
CREATE INDEX "Deployment_status_lastCheckedAt_idx" ON "Deployment"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "Deployment_creator_network_idx" ON "Deployment"("creator", "network");

-- CreateIndex
CREATE UNIQUE INDEX "Token_deploymentId_key" ON "Token"("deploymentId");

-- CreateIndex
CREATE INDEX "Token_createdAt_id_idx" ON "Token"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Token_symbol_idx" ON "Token"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Token_network_address_key" ON "Token"("network", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_idempotencyKey_key" ON "Operation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Operation_wallet_network_createdAt_idx" ON "Operation"("wallet", "network", "createdAt");

-- CreateIndex
CREATE INDEX "Operation_chainStatus_chainCheckedAt_idx" ON "Operation"("chainStatus", "chainCheckedAt");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_metadataId_fkey" FOREIGN KEY ("metadataId") REFERENCES "MetadataAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
