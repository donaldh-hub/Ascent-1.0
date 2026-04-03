import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Building2, Hash, Calendar, Plus, ChevronRight, Layers, Paperclip } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useListUnits, useListProperties } from "@workspace/api-client-react";
import { useDocCounts } from "@/hooks/use-doc-counts";
import { cn } from "@/lib/utils";

export default function Units() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");

  const { data: units = [], isLoading: unitsLoading } = useListUnits({});
  const { data: properties = [] } = useListProperties();

  const unitIds = units.map((u) => u.id);
  const { data: docCounts = {} } = useDocCounts("unit", unitIds, { enabled: unitIds.length > 0 });

  const propMap = Object.fromEntries(properties.map((p) => [p.id, p]));

  const filtered = units.filter((u) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const prop = propMap[u.propertyId];
    return (
      u.unitNumber.toLowerCase().includes(q) ||
      prop?.name?.toLowerCase().includes(q) ||
      prop?.address?.toLowerCase().includes(q)
    );
  });

  const grouped = filtered.reduce<Record<number, typeof filtered>>((acc, u) => {
    if (!acc[u.propertyId]) acc[u.propertyId] = [];
    acc[u.propertyId].push(u);
    return acc;
  }, {});

  const sortedPropertyIds = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => (propMap[a]?.name ?? "").localeCompare(propMap[b]?.name ?? ""));

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Units</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {units.length} unit{units.length !== 1 ? "s" : ""} across {properties.length} {properties.length !== 1 ? "properties" : "property"}
          </p>
        </div>
        <Button onClick={() => navigate("/setup")}>
          <Plus className="h-4 w-4 mr-2" /> Add Units
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search units or properties..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      {unitsLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <div className="text-center">
            <Layers className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>Loading units...</p>
          </div>
        </div>
      ) : units.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <Building2 className="h-10 w-10 mx-auto mb-4 text-muted-foreground opacity-40" />
          <h3 className="font-semibold text-lg mb-2">No units yet</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Add your first property and units to get started.
          </p>
          <Button onClick={() => navigate("/setup")}>
            Run Setup Wizard
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-border rounded-xl p-12 text-center text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p>No units match "{search}"</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedPropertyIds.map((propertyId) => {
            const prop = propMap[propertyId];
            const propUnits = grouped[propertyId] ?? [];
            return (
              <div key={propertyId} className="border border-border rounded-xl overflow-hidden">
                {/* Property header */}
                <div className="bg-secondary/30 px-5 py-3 flex items-center gap-3 border-b border-border">
                  <Building2 className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{prop?.name ?? `Property ${propertyId}`}</span>
                    {prop?.address && (
                      <span className="text-xs text-muted-foreground ml-2">{prop.address}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {propUnits.length} unit{propUnits.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Unit rows */}
                <div className="divide-y divide-border">
                  {propUnits.map((unit) => {
                    const docs = docCounts[unit.id];
                    const hasDoc = docs?.hasDocuments;
                    const docCount = docs?.count ?? 0;
                    return (
                      <button
                        key={unit.id}
                        onClick={() => navigate(`/units/${unit.id}`)}
                        className="w-full flex items-center px-5 py-3.5 hover:bg-secondary/20 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Hash className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{unit.unitNumber}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Added {formatDate(unit.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* Doc signal */}
                        {hasDoc ? (
                          <span className={cn(
                            "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium mr-2",
                            "bg-primary/10 text-primary"
                          )}>
                            <Paperclip className="h-3 w-3" />
                            {docCount}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50 mr-2 flex items-center gap-1">
                            <Paperclip className="h-3 w-3" />
                          </span>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
