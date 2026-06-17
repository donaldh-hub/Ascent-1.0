/**
 * Riverside Commons — static demo dataset for the public landing page.
 *
 * This is intentionally NOT inserted into the real database. It exists only
 * to power the landing page's interactive demo dashboard and Coach. Never
 * mix this with real customer data — every surface that uses it must show
 * the "Demo site — Riverside Commons" label.
 */

export interface DemoUnit {
  unitId: string;
  building: string;
  records: string[];
}

export const RIVERSIDE_COMMONS = {
  siteName: "Riverside Commons",
  unitCount: 48,
  buildings: ["Building A", "Building B", "Building C"],

  woStats: {
    total: 14,
    open: 14,
    completed: 0,
    slaMissedCount: 6,
    agingCount: 3,
    blockedCount: 0,
    topCategory: "HVAC",
  },

  woCategoryBreakdown: {
    HVAC: 4,
    Plumbing: 3,
    Appliance: 3,
    General: 4,
  },

  turnStats: {
    totalTurns: 3,
    activeTurns: 3,
    completedTurns: 0,
    blockedTurns: 1,
    reworkTurns: 0,
    notRentReadyCount: 1,
    avgCompletionPct: 55,
    primaryBottleneckStage: "Carpet",
  },

  turns: [
    { unitId: "A-12", day: 18, stoplight: "red", status: "Stalled — no update in 9 days" },
    { unitId: "C-09", day: 7, stoplight: "green", status: "On track" },
    { unitId: "B-02", day: 4, stoplight: "green", status: "On track" },
  ],

  pmTasks: [
    { task: "HVAC filter inspection", building: "Building B", daysOverdue: 14 },
    { task: "Fire extinguisher check", building: "Building A", daysOverdue: 6 },
  ],

  assets: [
    {
      id: 1,
      unitId: "B-07",
      name: "Central air unit",
      installDate: null,
      warrantyExpiration: null,
      maintenanceSchedule: "Quarterly HVAC inspection",
      stoplight: "red" as const,
      warrantyStatus: "unknown",
    },
    {
      id: 2,
      unitId: "B-14",
      name: "Central air unit",
      installDate: null,
      warrantyExpiration: null,
      maintenanceSchedule: "Quarterly HVAC inspection",
      stoplight: "yellow" as const,
      warrantyStatus: "not_documented",
    },
  ],

  priorityActions: [
    {
      id: "pa-1",
      label: "Unit A-12 turn stalled at day 18",
      context: "Last update 9 days ago",
      severity: "critical" as const,
      unitId: "A-12",
    },
    {
      id: "pa-2",
      label: "Unit B-07 HVAC: 3 work orders in 60 days, no warranty record",
      context: "Repeat issue, no warranty on file",
      severity: "critical" as const,
      unitId: "B-07",
    },
    {
      id: "pa-3",
      label: "6 work orders past due",
      context: "3 missing documentation",
      severity: "warning" as const,
      unitId: null,
    },
    {
      id: "pa-4",
      label: "Building B HVAC filter inspection 14 days overdue",
      context: "Preventive maintenance gap",
      severity: "warning" as const,
      unitId: null,
    },
    {
      id: "pa-5",
      label: "Unit B-14 central air repair completed without warranty check",
      context: "$980 vendor repair, AirPro HVAC",
      severity: "warning" as const,
      unitId: "B-14",
    },
  ],

  units: {
    "B-07": {
      unitId: "B-07",
      building: "Building B",
      summary: "Recurring HVAC issue, 3 work orders in 60 days, no warranty record on file.",
      records: [
        "WO #1041 — HVAC not cooling — Opened 62 days ago — Closed — No warranty check",
        "WO #1067 — HVAC not cooling again — Opened 31 days ago — Closed — Vendor: AirPro HVAC",
        "WO #1089 — HVAC noise complaint — Opened 8 days ago — Open — No documentation attached",
        "Asset: Central air unit — Warranty status: Unknown",
      ],
    },
    "A-12": {
      unitId: "A-12",
      building: "Building A",
      summary: "Turn stalled at day 18, no update in 9 days.",
      records: [
        "Turn opened day 1",
        "Paint complete day 3",
        "Cleaning complete day 5",
        "Carpet — no update since day 9",
        "Final inspection — not scheduled",
        "Last activity: 9 days ago",
      ],
    },
    "C-03": {
      unitId: "C-03",
      building: "Building C",
      summary: "Open work order with no documentation attached, 11 days open.",
      records: [
        "WO #1091 — Leaking under sink — Opened 11 days ago — Open — No photos, no documentation",
        "Assigned: Maintenance Tech — No update in 7 days",
      ],
    },
    "B-14": {
      unitId: "B-14",
      building: "Building B",
      summary: "Central air repair completed without a documented warranty check.",
      records: [
        "WO #1044 — Central air not working — Opened 22 days ago — Closed",
        "Vendor repair: $980 — AirPro HVAC",
        "Warranty check: Not documented",
        "Asset record: No warranty on file",
      ],
    },
  } as Record<string, DemoUnit & { summary: string }>,
};

export type RiversideCommonsData = typeof RIVERSIDE_COMMONS;
