import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { ApiEnv } from "@minthouse/config";
import { API_ENV } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DeploymentsService } from "../deployments/deployments.service.js";
import { OperationsService } from "../operations/operations.service.js";

const BATCH_SIZE = 20;
/** Deployments needing recovery are still watched, but less often. */
const RECOVERY_RECHECK_MS = 5 * 60_000;
/** Client-reported operations older than this are no longer polled. */
const OPERATION_WATCH_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Periodically re-checks deployments and operations whose on-chain outcome is
 * still open, so a closed browser tab never leaves a record stuck.
 */
@Injectable()
export class ReconcileWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconcileWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly prisma: PrismaService,
    private readonly deployments: DeploymentsService,
    private readonly operations: OperationsService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.env.RECONCILE_INTERVAL_MS;
    if (interval === 0) {
      return;
    }
    this.timer = setInterval(() => {
      if (!this.running) {
        this.running = this.tick().finally(() => {
          this.running = null;
        });
      }
    }, interval);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.running;
  }

  /** One reconciliation pass. Public so tests and operators can run it on demand. */
  async tick(now = new Date()): Promise<{ deployments: number; operations: number }> {
    const interval = this.env.RECONCILE_INTERVAL_MS || 15_000;
    const enabled = this.env.ENABLED_NETWORKS;
    const due = new Date(now.getTime() - interval);
    const recoveryDue = new Date(now.getTime() - RECOVERY_RECHECK_MS);

    const deployments = await this.prisma.deployment.findMany({
      where: {
        network: { in: enabled },
        txId: { not: null },
        OR: [
          { status: { in: ["submitted", "confirming", "verifying"] }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: due } }] },
          { status: "requires-recovery", OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: recoveryDue } }] },
        ],
      },
      orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
      take: BATCH_SIZE,
    });
    for (const row of deployments) {
      try {
        await this.deployments.refresh(row);
      } catch (error) {
        this.logger.warn({ err: error, deploymentId: row.id }, "Deployment reconciliation failed");
      }
    }

    const operations = await this.prisma.operation.findMany({
      where: {
        network: { in: enabled },
        txId: { not: null },
        chainStatus: { in: ["unknown", "pending"] },
        createdAt: { gt: new Date(now.getTime() - OPERATION_WATCH_WINDOW_MS) },
        OR: [{ chainCheckedAt: null }, { chainCheckedAt: { lt: due } }],
      },
      orderBy: { chainCheckedAt: { sort: "asc", nulls: "first" } },
      take: BATCH_SIZE,
    });
    for (const row of operations) {
      await this.operations.refreshChainStatus(row);
    }
    return { deployments: deployments.length, operations: operations.length };
  }
}
