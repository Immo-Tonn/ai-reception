import "server-only";
import { isFeatureEnabled, type ProductFeature } from "@/lib/config/features";
import { RepositoryNotFoundError } from "@/server/repository/errors";

/** Server Actions of a switched-off module answer exactly like a missing record ("not_found"). */
export function assertFeatureEnabled(feature: ProductFeature): void {
  if (!isFeatureEnabled(feature)) throw new RepositoryNotFoundError(`feature.${feature}`);
}
