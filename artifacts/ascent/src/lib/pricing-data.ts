export interface PricingPlan {
  name: string;
  monthly: number;
  annual: number;
}

export const PRICING_PLANS = {
  site: { name: "Site Plan", monthly: 149, annual: 129 },
} satisfies Record<string, PricingPlan>;

export const PRICING_BUNDLES: PricingPlan[] = [
  { name: "3-Site Bundle", monthly: 399, annual: 359 },
  { name: "5-Site Bundle", monthly: 599, annual: 539 },
  { name: "10-Site Bundle", monthly: 1099, annual: 989 },
];
