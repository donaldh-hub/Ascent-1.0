import { db } from "@workspace/db";
import { workOrdersTable, assetsTable, propertiesTable } from "@workspace/db/schema";
import { eq, like, sql } from "drizzle-orm";

const DEMO_PROPERTIES = [
  { name: "Oakwood Apartments", address: "1200 Oakwood Drive, Atlanta, GA 30301" },
  { name: "Riverside Commons", address: "450 River Bend Blvd, Atlanta, GA 30310" },
];

const CATEGORIES = ["plumbing", "HVAC", "electrical", "appliances", "general"];
const STATUSES = ["completed", "completed", "completed", "in_progress", "pending"] as const;
const PRIORITIES = ["low", "medium", "medium", "high", "critical"] as const;

const DESCRIPTIONS: Record<string, string[]> = {
  plumbing: [
    "Leaking faucet in bathroom",
    "Clogged drain in kitchen sink",
    "Running toilet — needs flapper replacement",
    "Low water pressure in unit",
    "Water heater pilot light out",
    "Garbage disposal not working",
  ],
  HVAC: [
    "AC not cooling — filter replacement needed",
    "Thermostat unresponsive",
    "HVAC unit making loud noise",
    "Heat not working in unit",
    "Air handler leaking condensation",
    "Duct work disconnected in hallway",
  ],
  electrical: [
    "Circuit breaker tripping repeatedly",
    "Outlet not working in bedroom",
    "Light fixture flickering",
    "Smoke detector battery replacement",
    "Ceiling fan not working",
    "GFCI outlet tripped — bathroom",
  ],
  appliances: [
    "Refrigerator not cooling",
    "Dishwasher not draining",
    "Dryer not heating",
    "Washer making grinding noise",
    "Stove burner not igniting",
    "Microwave door latch broken",
  ],
  general: [
    "Door lock difficult to operate",
    "Window screen torn",
    "Blinds broken in living room",
    "Grout cracking in bathroom",
    "Pest control — cockroach sighting",
    "Sliding glass door off track",
  ],
};

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function seededIndex(externalId: string, len: number): number {
  let hash = 0;
  for (let i = 0; i < externalId.length; i++) {
    hash = (hash * 31 + externalId.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % len;
}

export async function loadDemoDataset(): Promise<{ workOrders: number; assets: number; properties: number }> {
  let propertiesCreated = 0;
  const propertyIds: number[] = [];

  for (const prop of DEMO_PROPERTIES) {
    const existing = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.name, prop.name))
      .limit(1);

    if (existing.length > 0) {
      propertyIds.push(existing[0].id);
    } else {
      const [inserted] = await db
        .insert(propertiesTable)
        .values({ name: prop.name, address: prop.address })
        .returning({ id: propertiesTable.id });
      propertyIds.push(inserted.id);
      propertiesCreated++;
    }
  }

  const existingAssets = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .limit(1);

  let assetsCreated = 0;
  const demoAssetTypes = ["HVAC Unit", "Water Heater", "Refrigerator", "Washer/Dryer", "Dishwasher"];
  const assetIdByIndex: number[] = [];

  if (existingAssets.length === 0) {
    for (let pi = 0; pi < propertyIds.length; pi++) {
      for (let ai = 0; ai < demoAssetTypes.length; ai++) {
        const externalId = `DEMO-ASSET-${pi + 1}-${ai + 1}`;
        const existing = await db
          .select({ id: assetsTable.id })
          .from(assetsTable)
          .where(eq(assetsTable.serial, externalId))
          .limit(1);

        if (existing.length > 0) {
          assetIdByIndex.push(existing[0].id);
        } else {
          const [ins] = await db
            .insert(assetsTable)
            .values({
              name: `${demoAssetTypes[ai]} — ${DEMO_PROPERTIES[pi].name}`,
              assetType: demoAssetTypes[ai],
              status: "active",
              stoplight: "green",
              healthScore: 80 + Math.floor(Math.random() * 20),
              propertyId: propertyIds[pi],
              serial: externalId,
            })
            .returning({ id: assetsTable.id });
          assetIdByIndex.push(ins.id);
          assetsCreated++;
        }
      }
    }
  }

  let workOrdersCreated = 0;
  const TOTAL_WO = 150;

  for (let i = 1; i <= TOTAL_WO; i++) {
    const externalId = `DEMO-WO-${String(i).padStart(3, "0")}`;

    const existing = await db
      .select({ id: workOrdersTable.id })
      .from(workOrdersTable)
      .where(eq(workOrdersTable.externalId, externalId))
      .limit(1);

    const propIndex = seededIndex(externalId + "prop", propertyIds.length);
    const propertyId = propertyIds[propIndex];
    const propertyName = DEMO_PROPERTIES[propIndex].name;

    const catIndex = seededIndex(externalId + "cat", CATEGORIES.length);
    const category = CATEGORIES[catIndex];

    const descList = DESCRIPTIONS[category];
    const descIndex = seededIndex(externalId + "desc", descList.length);
    const description = descList[descIndex];

    const statusIndex = seededIndex(externalId + "status", STATUSES.length);
    const status = STATUSES[statusIndex];

    const priorityIndex = seededIndex(externalId + "prio", PRIORITIES.length);
    const priority = PRIORITIES[priorityIndex];

    const daysBack = seededIndex(externalId + "days", 90) + 1;
    const createdDate = daysAgo(daysBack);
    const completedDate =
      status === "completed" ? daysAgo(Math.max(0, daysBack - seededIndex(externalId + "close", 10))) : null;

    const unitNumber = `${100 + seededIndex(externalId + "unit", 50)}`;

    let assetId: number | null = null;
    if (assetIdByIndex.length > 0 && seededIndex(externalId + "asset", 3) === 0) {
      assetId = assetIdByIndex[seededIndex(externalId + "assetid", assetIdByIndex.length)];
    }

    const woData = {
      externalId,
      propertyId,
      assetId,
      category,
      description,
      priority,
      status,
      propertyNameRaw: propertyName,
      unitNumberRaw: unitNumber,
      createdDate,
      completedDate,
      importBatchId: "demo-dataset",
      sourceFileName: "demo-data-service",
      importedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(workOrdersTable)
        .set({ ...woData, updatedAt: new Date() })
        .where(eq(workOrdersTable.externalId, externalId));
    } else {
      await db.insert(workOrdersTable).values(woData);
      workOrdersCreated++;
    }
  }

  return {
    workOrders: workOrdersCreated,
    assets: assetsCreated,
    properties: propertiesCreated,
  };
}

export async function clearDemoDataset(): Promise<{ workOrdersDeleted: number }> {
  const deleted = await db
    .delete(workOrdersTable)
    .where(like(workOrdersTable.externalId, "DEMO-%"))
    .returning({ id: workOrdersTable.id });

  return { workOrdersDeleted: deleted.length };
}
