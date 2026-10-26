import { z } from "zod";
import { NETWORK_IDS } from "@minthouse/shared";

/**
 * URL state for the explore page. Invalid values are dropped instead of
 * failing the route, so a hand-edited or stale link still opens the page.
 */
export const exploreSearchSchema = z.object({
  q: z.string().trim().min(1).max(64).optional().catch(undefined),
  network: z.enum(NETWORK_IDS).optional().catch(undefined),
  /** Address of the token open in the inspector, paired with `tokenNetwork`. */
  token: z.string().trim().min(32).max(44).optional().catch(undefined),
  tokenNetwork: z.enum(NETWORK_IDS).optional().catch(undefined),
});

export type ExploreSearch = z.infer<typeof exploreSearchSchema>;
