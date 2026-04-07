export interface TurnNarrative {
  what: string;
  why: string;
  impact: string;
  action: string;
  drillSignal: string;
  primaryCount: number;
}

interface NarrativeInput {
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  primaryBottleneckStage?: string | null;
  propertyCount?: number;
  hasData: boolean;
}

export function generateFlowNarrative(ts: NarrativeInput | null | undefined): TurnNarrative | null {
  if (!ts?.hasData) return null;

  const stage = ts.primaryBottleneckStage ?? "primary stage";
  const blocked = ts.blockedTurns;
  const active = ts.activeTurns;
  const rework = ts.reworkTurns;
  const nrr = ts.notRentReadyCount;
  const pct = ts.avgCompletionPct;
  const blockedPct = active > 0 ? Math.round((blocked / active) * 100) : 0;

  if (blocked === 0) {
    return {
      what: `Flow is healthy — ${pct}% avg turn completion with no turns currently blocked`,
      why: `All ${active} active turns are progressing through stages without sustained congestion`,
      impact: `Current flow velocity supports throughput — turns are advancing toward completion`,
      action: `Monitor stage progression and watch for emerging bottlenecks as volume grows`,
      drillSignal: "stage_congestion",
      primaryCount: 0,
    };
  }

  return {
    what: `Flow is constrained — ${blocked} turns are stalled at ${stage} with ${pct}% avg stage completion`,
    why: `${stage} is the primary congestion point — ${blocked} of ${active} active turns (${blockedPct}%) have been in stage ≥7 days without progression${rework > 0 ? `, and ${rework} are looping back through rework` : ""}`,
    impact: `Stage congestion at ${stage} is blocking downstream stages and preventing ${nrr} unit${nrr !== 1 ? "s" : ""} from advancing toward rent-ready status`,
    action: `Clear ${blocked} stalled turn${blocked !== 1 ? "s" : ""} at ${stage} — assign resources, resolve vendor dependencies, and escalate aged gates immediately`,
    drillSignal: "blocked_turns",
    primaryCount: blocked,
  };
}

export function generateRiskNarrative(ts: NarrativeInput | null | undefined): TurnNarrative | null {
  if (!ts?.hasData) return null;

  const stage = ts.primaryBottleneckStage ?? "primary stage";
  const blocked = ts.blockedTurns;
  const rework = ts.reworkTurns;
  const nrr = ts.notRentReadyCount;
  const total = ts.totalTurns;
  const nrrPct = total > 0 ? Math.round((nrr / total) * 100) : 0;
  const riskLevel = blocked > 10 || nrrPct > 60 ? "critical" : blocked > 0 || nrrPct > 30 ? "elevated" : "low";

  if (riskLevel === "low") {
    return {
      what: `Risk is low — ${nrr} units not rent-ready with no significant blocking pattern`,
      why: `Turn volume is progressing with minimal obstruction — blocked and rework counts are within acceptable range`,
      impact: `Operational exposure is contained — units are moving toward leasable status`,
      action: `Continue clearing the remaining ${nrr} unit${nrr !== 1 ? "s" : ""} to achieve full rent-ready status`,
      drillSignal: "not_rent_ready",
      primaryCount: nrr,
    };
  }

  return {
    what: `Risk is ${riskLevel} — ${blocked} turns blocked and ${nrr} units (${nrrPct}%) not yet rent-ready`,
    why: `Blocked turns at ${stage}${rework > 0 ? ` and ${rework} turns in rework loop` : ""} are the primary risk drivers — units cannot advance to leasable status until gates are cleared`,
    impact: `${nrr} unit${nrr !== 1 ? "s" : ""} are unleasable today — each additional day of delay extends vacancy time and reduces revenue realization`,
    action: `Resolve ${blocked} blocked turn${blocked !== 1 ? "s" : ""} first, then drive ${nrr} unit${nrr !== 1 ? "s" : ""} through inspection to achieve rent-ready status`,
    drillSignal: "blocked_turns",
    primaryCount: blocked,
  };
}

export function generateExecutionNarrative(ts: NarrativeInput | null | undefined): TurnNarrative | null {
  if (!ts?.hasData) return null;

  const completed = ts.completedTurns;
  const total = ts.totalTurns;
  const active = ts.activeTurns;
  const blocked = ts.blockedTurns;
  const rework = ts.reworkTurns;
  const pct = ts.avgCompletionPct;
  const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const disruptors = blocked + rework;

  if (completedPct >= 50 && blocked === 0) {
    return {
      what: `Execution is strong — ${completed} of ${total} turns completed at ${pct}% avg stage progress`,
      why: `No blocked turns and low rework are enabling consistent completion velocity across ${active} active turns`,
      impact: `High completion rate drives rent-ready conversion and reduces vacancy time`,
      action: `Maintain momentum — push the remaining ${active} active turns through to completion`,
      drillSignal: "stage_congestion",
      primaryCount: active,
    };
  }

  return {
    what: `Execution at ${pct}% — ${completed} of ${total} turns completed with ${disruptors} turns disrupting flow`,
    why: `${blocked} blocked${rework > 0 ? ` and ${rework} rework` : ""} turns are reducing completion velocity — only ${completedPct}% of turns have fully closed out`,
    impact: `Low completion throughput means work is accumulating faster than it resolves, extending time-to-occupancy across the portfolio`,
    action: `Prioritize clearing ${blocked} blocked turn${blocked !== 1 ? "s" : ""} to unlock downstream completion and recover throughput`,
    drillSignal: "blocked_turns",
    primaryCount: blocked,
  };
}

export function generateImprovementNarrative(ts: NarrativeInput | null | undefined): TurnNarrative | null {
  if (!ts?.hasData) return null;

  const completed = ts.completedTurns;
  const total = ts.totalTurns;
  const rework = ts.reworkTurns;
  const nrr = ts.notRentReadyCount;
  const props = ts.propertyCount ?? 1;
  const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const rentReadyPct = total > 0 ? Math.round(((total - nrr) / total) * 100) : 0;
  const reworkPct = total > 0 ? Math.round((rework / total) * 100) : 0;

  if (rentReadyPct >= 60 && rework <= 3) {
    return {
      what: `Improvement trajectory is positive — ${rentReadyPct}% rent-ready rate with minimal rework across ${props} propert${props !== 1 ? "ies" : "y"}`,
      why: `Low rework (${rework} turns, ${reworkPct}%) and strong completion signal that operational corrections are holding`,
      impact: `Sustained improvement will compound over time — each cleared turn contributes to portfolio-wide performance`,
      action: `Close out remaining ${nrr} not-rent-ready unit${nrr !== 1 ? "s" : ""} to achieve peak improvement scores`,
      drillSignal: "not_rent_ready",
      primaryCount: nrr,
    };
  }

  return {
    what: `Improvement is limited — ${completedPct}% completion rate and ${rentReadyPct}% rent-ready rate across ${props} propert${props !== 1 ? "ies" : "y"}`,
    why: `Persistent rework (${rework} turns, ${reworkPct}% of total) and recurring blockers are preventing gains from compounding — root causes are not yet resolved`,
    impact: `Without reducing rework, improvement scores will plateau or decline — the same failures are cycling through the system`,
    action: `Target ${rework} rework turn${rework !== 1 ? "s" : ""} for root-cause resolution — identify recurring failure patterns and eliminate them to build momentum`,
    drillSignal: "rework_loop",
    primaryCount: rework,
  };
}

export function generateBottleneckNarrative(ts: NarrativeInput | null | undefined): TurnNarrative | null {
  if (!ts?.hasData || !ts.primaryBottleneckStage) return null;

  const stage = ts.primaryBottleneckStage;
  const blocked = ts.blockedTurns;
  const active = ts.activeTurns;
  const nrr = ts.notRentReadyCount;
  const rework = ts.reworkTurns;
  const blockedPct = active > 0 ? Math.round((blocked / active) * 100) : 0;

  return {
    what: `${stage} is the primary bottleneck — ${blocked} turn${blocked !== 1 ? "s" : ""} stalled with ${blockedPct}% of active turns blocked`,
    why: `Turns entering ${stage} are not progressing — likely causes include unresolved vendor dependencies, inspection failures, or insufficient staffing at this stage`,
    impact: `The ${stage} bottleneck is creating upstream congestion and preventing ${nrr} unit${nrr !== 1 ? "s" : ""} from advancing${rework > 0 ? `, with ${rework} turns cycling through rework` : ""}`,
    action: `Assign dedicated resources to ${stage} — unblock ${blocked} stalled turn${blocked !== 1 ? "s" : ""} and implement stage-level escalation to prevent recurrence`,
    drillSignal: "blocked_turns",
    primaryCount: blocked,
  };
}
