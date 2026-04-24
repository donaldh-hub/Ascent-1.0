/**
 * Ascent 1.12.7 — Governance Routes
 *
 * Public surfaces for the governance enforcement layer:
 *
 *   GET /api/governance/contracts
 *     Returns the static metric-contract registry. Useful for the
 *     frontend Governance page and for any future build that wants to
 *     introspect "which signals exist and what is allowed to consume them."
 *
 *   GET /api/governance/audit
 *     Runs the live symmetry audit across every locked signal and returns
 *     a single report. Pass = system invariant intact. Fail = the contract
 *     between Control Tower / drill / list endpoint has drifted.
 *
 *   GET /api/governance/validate?signal=…
 *     One-off validity + symmetry check for a single signal. Used by the
 *     symmetry banner in detail pages and by future auto-trigger hooks.
 */

import { Router, type IRouter } from "express";
import {
  validateControlTowerSymmetry,
  runFullAudit,
  validateSignal,
} from "../services/governance-validator.js";
import { METRIC_CONTRACTS } from "../services/operational-contracts.js";

const router: IRouter = Router();

router.get("/governance/contracts", (_req, res) => {
  res.json({
    contracts: METRIC_CONTRACTS,
    count: METRIC_CONTRACTS.length,
  });
});

router.get("/governance/audit", async (req, res) => {
  try {
    const report = await runFullAudit();
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Governance audit failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/governance/validate", async (req, res) => {
  const signal = (req.query.signal as string | undefined) ?? "";
  const validity = validateSignal(signal);
  if (!validity.valid) {
    return res.status(400).json({
      signal,
      valid: false,
      reason: validity.reason ?? "Unknown",
    });
  }
  try {
    const symmetry = await validateControlTowerSymmetry(signal);
    return res.json({
      signal,
      valid: true,
      contract: validity.contract,
      symmetry,
    });
  } catch (err) {
    req.log.error({ err, signal }, "Signal validation failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
