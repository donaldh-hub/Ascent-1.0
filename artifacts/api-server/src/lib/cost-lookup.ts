/**
 * Asset Cost Lookup — Build 1.9 Financial Intelligence Engine
 *
 * Maps asset_type → replacement cost from the asset_costs input (Excel source).
 * All costs are replacement cost values (installed, benchmark-grade).
 *
 * Source: ascent_1_9_asset_cost_inputs — "Cost" column
 * Data types in DB: Stove, HVAC Unit, Refrigerator, Water Heater
 */

export interface AssetCostRecord {
  assetType: string;
  category: string;
  replacementCost: number;
}

// ── Cost table from Excel input ────────────────────────────────────────────────
// DB asset_type values mapped to their cost benchmarks.
// Where multiple variants exist (Electric/Gas), we use the average.

const COST_TABLE: AssetCostRecord[] = [
  { assetType: "Water Heater", category: "Plumbing",   replacementCost: 875  }, // avg($750 elec, $1000 gas)
  { assetType: "Refrigerator", category: "Appliance",  replacementCost: 850  },
  { assetType: "Stove",        category: "Appliance",  replacementCost: 825  }, // avg($800 elec, $850 gas)
  { assetType: "HVAC Unit",    category: "HVAC",       replacementCost: 5000 },
  { assetType: "Dishwasher",   category: "Appliance",  replacementCost: 650  },
  { assetType: "Microwave",    category: "Appliance",  replacementCost: 400  },
  { assetType: "Washer",       category: "Laundry",    replacementCost: 750  },
  { assetType: "Dryer",        category: "Laundry",    replacementCost: 750  },
];

// Normalize to lowercase for case-insensitive matching
const _lookup = new Map<string, AssetCostRecord>(
  COST_TABLE.map((r) => [r.assetType.toLowerCase().trim(), r]),
);

/**
 * Returns the cost record for a given asset_type, or null if no match.
 * Matching is case-insensitive and trims whitespace.
 */
export function lookupAssetCost(assetType: string | null | undefined): AssetCostRecord | null {
  if (!assetType) return null;
  return _lookup.get(assetType.toLowerCase().trim()) ?? null;
}

/**
 * Returns the replacement cost for a given asset_type, or null if unknown.
 */
export function getReplacementCost(assetType: string | null | undefined): number | null {
  return lookupAssetCost(assetType)?.replacementCost ?? null;
}

/**
 * Sums replacement costs for an array of asset types.
 * Assets with no match contribute 0 (not null) to the sum.
 * Returns { total, matched, unmatched }.
 */
export function sumReplacementCosts(assetTypes: (string | null | undefined)[]): {
  total: number;
  matched: number;
  unmatched: number;
} {
  let total = 0;
  let matched = 0;
  let unmatched = 0;
  for (const t of assetTypes) {
    const cost = getReplacementCost(t);
    if (cost !== null) {
      total += cost;
      matched++;
    } else {
      unmatched++;
    }
  }
  return { total, matched, unmatched };
}

export { COST_TABLE };
