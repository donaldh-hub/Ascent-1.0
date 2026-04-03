import { useLocation, useParams } from "wouter";
import { ArrowLeft, Hash, Building2, Calendar, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useListUnits, useListProperties } from "@workspace/api-client-react";

export default function UnitDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const unitId = parseInt(id, 10);

  const { data: units = [] } = useListUnits({});
  const { data: properties = [] } = useListProperties();

  const unit = units.find((u) => u.id === unitId);
  const property = properties.find((p) => p.id === unit?.propertyId);

  if (!unit) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Hash className="h-10 w-10 mb-4 opacity-30" />
        <p className="font-medium">Unit not found</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/units")}>
          Back to Units
        </Button>
      </div>
    );
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">
      {/* Back nav */}
      <button
        onClick={() => navigate("/units")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm w-fit"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Units
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
          <Hash className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Unit {unit.unitNumber}</h1>
          <div className="flex items-center gap-2 text-muted-foreground text-sm mt-0.5">
            <Building2 className="h-4 w-4" />
            <span>{property?.name ?? `Property ${unit.propertyId}`}</span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-secondary/20 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unit Details</span>
        </div>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-muted-foreground">Unit number</span>
            <span className="text-sm font-medium">{unit.unitNumber}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-muted-foreground">Property</span>
            <span className="text-sm font-medium">{property?.name ?? "—"}</span>
          </div>
          {property?.address && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-sm text-muted-foreground">Address</span>
              <span className="text-sm font-medium">{property.address}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Date added
            </span>
            <span className="text-sm font-medium">{formatDate(unit.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Placeholder future sections */}
      <div className="border border-dashed border-border rounded-xl p-8 text-center text-muted-foreground">
        <LayoutGrid className="h-8 w-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium mb-1">Workflows, documents &amp; history</p>
        <p className="text-xs">Coming in a future build — this unit is already linked to your system.</p>
      </div>
    </div>
  );
}
