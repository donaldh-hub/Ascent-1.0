import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Canonical unit identity display format used across ALL surfaces.
 * Never display a unit by number alone — always include property context.
 *   "Unit 10 — Cedar Heights"
 */
export function formatUnitIdentity(
  unitNumber: string | number | undefined | null,
  propertyName: string | undefined | null
): string {
  const num = unitNumber ?? "—";
  const prop = propertyName ?? "Unknown Property";
  return `Unit ${num} — ${prop}`;
}
