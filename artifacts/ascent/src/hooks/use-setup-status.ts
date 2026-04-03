/**
 * Build 1.5 (Activation Flow Patch)
 *
 * Derives setup completion from REAL data — not localStorage.
 * Setup is complete only when:
 *   - at least one property exists
 *   - at least one unit exists
 *
 * This is the single source of truth for gate decisions.
 */

import { useListProperties, useListUnits } from "@workspace/api-client-react";

export interface SetupStatus {
  isComplete: boolean;
  isLoading: boolean;
  hasProperty: boolean;
  hasUnit: boolean;
  propertyCount: number;
  unitCount: number;
}

export function useSetupStatus(): SetupStatus {
  const { data: properties, isLoading: propLoading } = useListProperties({
    query: { staleTime: 30_000 },
  });
  const { data: units, isLoading: unitsLoading } = useListUnits(
    {},
    { query: { staleTime: 30_000 } }
  );

  const isLoading = propLoading || unitsLoading;
  const propertyCount = properties?.length ?? 0;
  const unitCount = units?.length ?? 0;
  const hasProperty = propertyCount > 0;
  const hasUnit = unitCount > 0;
  const isComplete = !isLoading && hasProperty && hasUnit;

  return { isComplete, isLoading, hasProperty, hasUnit, propertyCount, unitCount };
}
