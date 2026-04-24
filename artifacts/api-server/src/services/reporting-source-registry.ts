/**
 * Ascent 7.1 — Reporting Source Registry
 *
 * One declarative list of every reportable source type. Reports, the Reporting
 * Readiness panel, drill-downs, and strict-mode validation all read from this
 * registry so there is exactly one operational language across the app.
 *
 * Add a new source by adding an entry here — never by hand-rolling source
 * definitions inside report components.
 */

import type { ReportingSourceType, ReportingResolutionStatus } from "./reporting-record-contract";

export interface ReportingSourceDefinition {
  sourceType: ReportingSourceType;
  displayName: string;
  /** Fields that MUST be present for a record to be FULLY_REPORTABLE. */
  requiredFields: string[];
  /** Fields surfaced on drill-downs but not required for eligibility. */
  optionalFields: string[];
  /** Resolution states accepted into reporting at all (anything else => not_reportable). */
  acceptedResolutionStates: ReportingResolutionStatus[];
  /** Minimum assignment confidence required to be FULLY_REPORTABLE. */
  assignmentRequirements: "high" | "medium" | "any" | "none";
  /** Which rollup scopes this source supports. */
  reportingScopeSupport: ("organization" | "property" | "unit" | "asset")[];
  /** Report families this source feeds (informational; reports already exist via reporting-service). */
  supportedReportFamilies: string[];
  /** Where the drill-down should land for an individual record. */
  drillDownTarget: string;
  /** Copy shown when no records exist for this source yet. */
  lowDataMessage: string;
  /** True if this source is wired today; false for placeholder/low-data sources. */
  isWiredToday: boolean;
}

export const REPORTING_SOURCE_REGISTRY: Record<ReportingSourceType, ReportingSourceDefinition> = {
  work_orders: {
    sourceType: "work_orders",
    displayName: "Work Orders",
    requiredFields: ["propertyId", "unitId", "category", "status", "priority", "createdDate"],
    optionalFields: ["assignedTo", "vendor", "completedDate", "firstResponseDate", "slaStatus", "slaResponseDelayHours"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "medium",
    reportingScopeSupport: ["organization", "property", "unit"],
    supportedReportFamilies: ["operational_health", "sla_performance", "bottlenecks", "vendor_performance"],
    drillDownTarget: "/work-orders",
    lowDataMessage: "No reportable work order records are available yet.",
    isWiredToday: true,
  },
  turns: {
    sourceType: "turns",
    displayName: "Turns / Make-Ready",
    requiredFields: ["propertyId", "unitId", "currentStage", "turnStatus"],
    optionalFields: ["completionPercentage", "daysInStage", "totalDaysOpen", "isBlocked", "blockReason"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "medium",
    reportingScopeSupport: ["organization", "property", "unit"],
    supportedReportFamilies: ["turn_performance", "stage_durations", "block_analysis"],
    drillDownTarget: "/turns",
    lowDataMessage: "No reportable turn records are available yet.",
    isWiredToday: true,
  },
  preventative_maintenance: {
    sourceType: "preventative_maintenance",
    displayName: "Preventative Maintenance",
    requiredFields: ["propertyId", "pmType", "scheduledDate"],
    optionalFields: ["unitId", "assetId", "completedDate", "status"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property", "unit", "asset"],
    supportedReportFamilies: ["pm_compliance", "pm_overdue"],
    drillDownTarget: "/work-orders?category=PM",
    lowDataMessage: "PM reporting will activate after PM source data is uploaded or created.",
    isWiredToday: false,
  },
  assets: {
    sourceType: "assets",
    displayName: "Assets",
    requiredFields: ["propertyId", "name", "assetType"],
    optionalFields: ["unitId", "manufacturer", "model", "serial", "installDate", "warrantyStart", "warrantyExpiration"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property", "unit", "asset"],
    supportedReportFamilies: ["asset_inventory", "warranty_status"],
    drillDownTarget: "/assets",
    lowDataMessage: "No reportable asset records are available yet.",
    isWiredToday: true,
  },
  warranties: {
    sourceType: "warranties",
    displayName: "Warranties",
    requiredFields: ["propertyId", "assetId", "warrantyExpiration"],
    optionalFields: ["unitId", "warrantyStart", "manufacturer"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property", "asset"],
    supportedReportFamilies: ["warranty_status", "expiring_warranties"],
    drillDownTarget: "/assets",
    lowDataMessage: "Warranty reporting is derived from asset records.",
    isWiredToday: true,
  },
  documents: {
    sourceType: "documents",
    displayName: "Documents & Evidence",
    requiredFields: ["linkedEntityType", "linkedEntityId", "fileName"],
    optionalFields: ["documentType", "uploadedBy", "uploadedAt", "linkedWorkflowId"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property", "unit", "asset"],
    supportedReportFamilies: ["evidence_coverage", "documentation_gaps"],
    drillDownTarget: "/documents",
    lowDataMessage: "No documents have been uploaded yet.",
    isWiredToday: true,
  },
  assignments: {
    sourceType: "assignments",
    displayName: "Assignment Coverage",
    requiredFields: ["sourceType", "confidenceLevel", "status"],
    optionalFields: ["targetEntityType", "targetEntityId", "explanation", "assignmentMethod"],
    // Ascent 7.1 (architect review fix) — rejected/abandoned assignments must
    // not be promotable to reportable. Only assigned/pending states qualify.
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization"],
    supportedReportFamilies: ["assignment_coverage", "data_quality"],
    drillDownTarget: "/assignments-review",
    lowDataMessage: "No assignment records have been generated yet.",
    isWiredToday: true,
  },
  workflow_items: {
    sourceType: "workflow_items",
    displayName: "Workflow Items",
    requiredFields: ["workflowId", "status"],
    optionalFields: ["category", "priority"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property"],
    supportedReportFamilies: ["workflow_throughput"],
    drillDownTarget: "/workflows",
    lowDataMessage: "No workflow items are present yet.",
    isWiredToday: false,
  },
  alerts: {
    sourceType: "alerts",
    displayName: "Alerts",
    requiredFields: ["type", "level", "status"],
    optionalFields: ["workflowId", "assetId", "ruleKey"],
    acceptedResolutionStates: ["fully_resolved", "partially_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization"],
    supportedReportFamilies: ["alert_volume", "alert_aging"],
    drillDownTarget: "/alerts",
    lowDataMessage: "No alert records are available yet.",
    isWiredToday: false,
  },
  score_snapshots: {
    sourceType: "score_snapshots",
    displayName: "Score Snapshots",
    requiredFields: ["propertyId", "snapshotDate"],
    optionalFields: ["score"],
    acceptedResolutionStates: ["fully_resolved"],
    assignmentRequirements: "any",
    reportingScopeSupport: ["organization", "property"],
    supportedReportFamilies: ["score_trend"],
    drillDownTarget: "/control-tower",
    lowDataMessage: "Score snapshot reporting activates after the trending engine ships.",
    isWiredToday: false,
  },
};

export function getSourceDefinition(sourceType: ReportingSourceType): ReportingSourceDefinition {
  return REPORTING_SOURCE_REGISTRY[sourceType];
}

export function listAllSourceDefinitions(): ReportingSourceDefinition[] {
  return Object.values(REPORTING_SOURCE_REGISTRY);
}

export function listWiredSourceTypes(): ReportingSourceType[] {
  return listAllSourceDefinitions()
    .filter((s) => s.isWiredToday)
    .map((s) => s.sourceType);
}
