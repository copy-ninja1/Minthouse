import { Controller, Get, Param, Query } from "@nestjs/common";
import { NETWORK_IDS, type TokenLookup, type TokenPage, tokenSearchQuerySchema } from "@minthouse/shared";
import { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { TokensService } from "./tokens.service.js";

const lookupParams = {
  network: z.enum(NETWORK_IDS),
  address: z.string().trim().min(32).max(44),
};

@Controller("tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  /** Verified platform tokens. Without `q` this is the "recent launches" list. */
  @Get()
  search(@Query(new ZodValidationPipe(tokenSearchQuerySchema)) query: z.output<typeof tokenSearchQuerySchema>): Promise<TokenPage> {
    return this.tokens.search(query);
  }

  @Get(":network/:address")
  lookup(
    @Param("network", new ZodValidationPipe(lookupParams.network)) network: z.output<typeof lookupParams.network>,
    @Param("address", new ZodValidationPipe(lookupParams.address)) address: string,
  ): Promise<TokenLookup> {
    return this.tokens.lookup(network, address);
  }
}
