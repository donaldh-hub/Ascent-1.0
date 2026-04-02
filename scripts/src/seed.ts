import { db } from "@workspace/db";
import {
  workflowsTable,
  stagesTable,
  assetsTable,
  alertsTable,
  documentsTable,
  impactEventsTable,
} from "@workspace/db/schema";

async function seed() {
  console.log("Seeding Ascent 1.0 data...");

  await db.delete(impactEventsTable);
  await db.delete(documentsTable);
  await db.delete(alertsTable);
  await db.delete(stagesTable);
  await db.delete(workflowsTable);
  await db.delete(assetsTable);

  const [wf1] = await db.insert(workflowsTable).values({
    title: "HVAC System Replacement — Tower B",
    description: "Full replacement of HVAC units across floors 4-8 of Tower B including ductwork and controls.",
    status: "active",
    stoplight: "red",
    flowScore: 38,
    riskScore: 42,
    improvementScore: 55,
    executionScore: 40,
    healthScore: 44,
    owner: "Marcus Chen",
    dueDate: "2025-05-15",
  }).returning();

  const [wf2] = await db.insert(workflowsTable).values({
    title: "Electrical Panel Upgrade — Warehouse 3",
    description: "Upgrade main electrical panels to support expanded production capacity.",
    status: "active",
    stoplight: "yellow",
    flowScore: 62,
    riskScore: 68,
    improvementScore: 72,
    executionScore: 65,
    healthScore: 67,
    owner: "Sarah Kim",
    dueDate: "2025-06-01",
  }).returning();

  const [wf3] = await db.insert(workflowsTable).values({
    title: "Fire Suppression Inspection — Campus",
    description: "Annual fire suppression system testing and compliance certification for all campus buildings.",
    status: "active",
    stoplight: "green",
    flowScore: 88,
    riskScore: 90,
    improvementScore: 85,
    executionScore: 92,
    healthScore: 89,
    owner: "David Reyes",
    dueDate: "2025-07-30",
  }).returning();

  const [wf4] = await db.insert(workflowsTable).values({
    title: "Plumbing Retrofit — Building A",
    description: "Replace aging copper piping with PEX across all restrooms and utility areas.",
    status: "paused",
    stoplight: "yellow",
    flowScore: 55,
    riskScore: 60,
    improvementScore: 50,
    executionScore: 58,
    healthScore: 56,
    owner: "Jennifer Park",
    dueDate: "2025-08-15",
  }).returning();

  const stagesData: Parameters<typeof db.insert>[0] extends typeof stagesTable ? never : any[] = [
    {
      workflowId: wf1.id,
      name: "Site Survey & Assessment",
      order: 1,
      status: "completed",
      stoplight: "green",
      owner: "Marcus Chen",
      isBottleneck: false,
      startedAt: new Date("2025-03-01"),
      completedAt: new Date("2025-03-08"),
    },
    {
      workflowId: wf1.id,
      name: "Equipment Procurement",
      order: 2,
      status: "blocked",
      stoplight: "red",
      owner: "Procurement Team",
      isBottleneck: true,
      startedAt: new Date("2025-03-10"),
      dueDate: "2025-04-01",
      notes: "Supplier delayed — awaiting delivery confirmation from HVAC manufacturer.",
    },
    {
      workflowId: wf1.id,
      name: "Demolition & Removal",
      order: 3,
      status: "pending",
      stoplight: "yellow",
      owner: "Field Crew A",
      isBottleneck: false,
      dueDate: "2025-04-15",
    },
    {
      workflowId: wf1.id,
      name: "Installation",
      order: 4,
      status: "pending",
      stoplight: "green",
      owner: "HVAC Contractor",
      isBottleneck: false,
      dueDate: "2025-05-01",
    },
    {
      workflowId: wf1.id,
      name: "Testing & Commissioning",
      order: 5,
      status: "pending",
      stoplight: "green",
      owner: "Marcus Chen",
      isBottleneck: false,
      dueDate: "2025-05-10",
    },
    {
      workflowId: wf2.id,
      name: "Engineering Design",
      order: 1,
      status: "completed",
      stoplight: "green",
      owner: "Engineering",
      isBottleneck: false,
      startedAt: new Date("2025-02-15"),
      completedAt: new Date("2025-02-28"),
    },
    {
      workflowId: wf2.id,
      name: "Permit Approval",
      order: 2,
      status: "in_progress",
      stoplight: "yellow",
      owner: "Sarah Kim",
      isBottleneck: false,
      startedAt: new Date("2025-03-01"),
      dueDate: "2025-04-01",
      notes: "Permit under review by city inspector.",
    },
    {
      workflowId: wf2.id,
      name: "Panel Installation",
      order: 3,
      status: "pending",
      stoplight: "green",
      owner: "Electrical Contractor",
      isBottleneck: false,
      dueDate: "2025-05-01",
    },
    {
      workflowId: wf3.id,
      name: "Scheduling & Coordination",
      order: 1,
      status: "completed",
      stoplight: "green",
      owner: "David Reyes",
      isBottleneck: false,
      startedAt: new Date("2025-03-01"),
      completedAt: new Date("2025-03-05"),
    },
    {
      workflowId: wf3.id,
      name: "Building A Inspection",
      order: 2,
      status: "completed",
      stoplight: "green",
      owner: "Inspection Team",
      isBottleneck: false,
      startedAt: new Date("2025-03-06"),
      completedAt: new Date("2025-03-10"),
    },
    {
      workflowId: wf3.id,
      name: "Building B Inspection",
      order: 3,
      status: "in_progress",
      stoplight: "green",
      owner: "Inspection Team",
      isBottleneck: false,
      startedAt: new Date("2025-03-11"),
      dueDate: "2025-03-20",
    },
    {
      workflowId: wf3.id,
      name: "Certification Filing",
      order: 4,
      status: "pending",
      stoplight: "green",
      owner: "David Reyes",
      isBottleneck: false,
      dueDate: "2025-04-01",
    },
  ];

  for (const stage of stagesData) {
    await db.insert(stagesTable).values(stage);
  }

  const [a1] = await db.insert(assetsTable).values({
    name: "HVAC Unit — Tower B Floor 4",
    model: "Carrier 50XCQ Series",
    serial: "XCQ-2018-004721",
    status: "critical",
    stoplight: "red",
    healthScore: 28,
    installDate: "2018-06-15",
    warrantyStart: "2018-06-15",
    warrantyExpiration: "2021-06-15",
    lifeExpectancyYears: 15,
    maintenanceSchedule: "Quarterly",
    location: "Tower B — Floor 4 Mechanical Room",
  }).returning();

  const [a2] = await db.insert(assetsTable).values({
    name: "Main Electrical Panel — Warehouse 3",
    model: "Siemens P1 Series",
    serial: "SIE-P1-2019-002341",
    status: "maintenance",
    stoplight: "yellow",
    healthScore: 62,
    installDate: "2019-03-20",
    warrantyStart: "2019-03-20",
    warrantyExpiration: "2025-06-20",
    lifeExpectancyYears: 25,
    maintenanceSchedule: "Annual",
    location: "Warehouse 3 — Main Utility Room",
  }).returning();

  const [a3] = await db.insert(assetsTable).values({
    name: "Fire Suppression System — Campus",
    model: "Kidde FM-200",
    serial: "KID-FM200-2020-009142",
    status: "active",
    stoplight: "green",
    healthScore: 91,
    installDate: "2020-09-01",
    warrantyStart: "2020-09-01",
    warrantyExpiration: "2027-09-01",
    lifeExpectancyYears: 20,
    maintenanceSchedule: "Annual",
    location: "Campus Wide — Server Rooms & Common Areas",
  }).returning();

  await db.insert(alertsTable).values([
    {
      type: "bottleneck",
      severity: "critical",
      title: "Critical Bottleneck: HVAC Equipment Delivery Delayed",
      message: "Equipment Procurement stage in 'HVAC System Replacement — Tower B' has been blocked for 12 days. Delivery from supplier is overdue. Project deadline at risk.",
      workflowId: wf1.id,
      isRead: false,
    },
    {
      type: "warranty_expiration",
      severity: "critical",
      title: "Warranty Expired: HVAC Unit — Tower B Floor 4",
      message: "Warranty for 'HVAC Unit — Tower B Floor 4' expired on 2021-06-15. Asset is now running without warranty coverage. Replacement in progress.",
      assetId: a1.id,
      isRead: false,
    },
    {
      type: "due_date",
      severity: "warning",
      title: "Permit Approval Approaching Deadline",
      message: "Permit Approval stage in 'Electrical Panel Upgrade — Warehouse 3' is due in 5 days. Current status: Under Review. Follow up with city inspector.",
      workflowId: wf2.id,
      isRead: false,
    },
    {
      type: "warranty_expiration",
      severity: "warning",
      title: "Warranty Expiring: Main Electrical Panel — Warehouse 3",
      message: "Warranty for 'Main Electrical Panel — Warehouse 3' expires on 2025-06-20 (83 days remaining). Schedule maintenance review.",
      assetId: a2.id,
      isRead: false,
    },
    {
      type: "status_change",
      severity: "info",
      title: "Workflow Paused: Plumbing Retrofit — Building A",
      message: "'Plumbing Retrofit — Building A' has been paused pending material delivery. Expected resumption: 2025-05-01.",
      workflowId: wf4.id,
      isRead: true,
    },
  ]);

  await db.insert(documentsTable).values([
    {
      filename: "HVAC_Survey_Report_Mar2025.pdf",
      detectedType: "Survey Report",
      workflowId: wf1.id,
      notes: "Initial site survey and assessment findings.",
    },
    {
      filename: "Equipment_PO_Carrier_XCQ.pdf",
      detectedType: "Purchase Order",
      workflowId: wf1.id,
      notes: "Purchase order for replacement HVAC units.",
    },
    {
      filename: "Electrical_Engineering_Design.pdf",
      detectedType: "Engineering Drawing",
      workflowId: wf2.id,
      notes: "Approved engineering design for panel upgrade.",
    },
    {
      filename: "Fire_Inspection_Certificate_2024.pdf",
      detectedType: "Compliance Certificate",
      workflowId: wf3.id,
      assetId: a3.id,
      notes: "Prior year inspection certificate for reference.",
    },
  ]);

  await db.insert(impactEventsTable).values([
    {
      workflowId: wf1.id,
      eventType: "delay",
      description: "Supplier delivery delay — HVAC units backordered by 3 weeks",
      costImpact: 15000,
      timeImpactDays: 21,
    },
    {
      workflowId: wf2.id,
      eventType: "approval",
      description: "City permit approval pending — additional documentation requested by inspector",
      costImpact: 2500,
      timeImpactDays: 7,
    },
  ]);

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
