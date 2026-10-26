import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { ApiEnv } from "@minthouse/config";
import {
  LAUNCH_MODE_CAPABILITIES,
  type PublicConfig,
} from "@minthouse/shared";
import { API_ENV } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ObjectStorage } from "../storage/object-storage.js";

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get("health/live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("health/ready")
  async ready(): Promise<{ status: "ok"; database: "ok"; storage: "ok" }> {
    const [database, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.storage.ready(),
    ]);
    if (!database || !storage) {
      throw new ServiceUnavailableException(`Not ready: database ${database ? "ok" : "down"}, storage ${storage ? "ok" : "down"}.`);
    }
    return { status: "ok", database: "ok", storage: "ok" };
  }

  /** Public, non-secret server capabilities the web app adapts to. */
  @Get("config")
  config(): PublicConfig {
    const pumpNetworks: readonly string[] = LAUNCH_MODE_CAPABILITIES.pumpfun.networks;
    return {
      networks: this.env.ENABLED_NETWORKS,
      storage: {
        provider: this.storage.provider,
        persistent: this.storage.persistent,
        maxLogoBytes: this.env.MAX_LOGO_BYTES,
      },
      pumpfunNetworks: this.env.ENABLED_NETWORKS.filter((network) => pumpNetworks.includes(network)),
    };
  }
}
