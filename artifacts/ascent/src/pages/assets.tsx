import { useListAssets, useListProperties } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { StoplightIndicator } from "@/components/stoplight";
import { Server, AlertTriangle, ShieldCheck, Building2, Hash, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Assets() {
  const { data: assets, isLoading } = useListAssets();
  const { data: properties = [] } = useListProperties();
  const [search, setSearch] = useState("");
  const [filterPropertyId, setFilterPropertyId] = useState<number | null>(null);

  const filteredAssets = useMemo(() => {
    if (!assets) return [];
    return assets.filter((asset) => {
      const matchesSearch =
        asset.name.toLowerCase().includes(search.toLowerCase()) ||
        (asset.model && asset.model.toLowerCase().includes(search.toLowerCase())) ||
        (asset.serial && asset.serial.toLowerCase().includes(search.toLowerCase())) ||
        (asset.location && asset.location.toLowerCase().includes(search.toLowerCase()));
      const matchesProp = filterPropertyId === null || asset.propertyId === filterPropertyId;
      return matchesSearch && matchesProp;
    });
  }, [assets, search, filterPropertyId]);

  // ── Compute summary stats from the SAME dataset ────────────────────────────
  const totalAssets = assets?.length ?? 0;
  const atRiskCount = assets?.filter((a) => (a.warrantyDaysRemaining ?? 1) <= 0).length ?? 0;
  const expiringSoonCount = assets?.filter(
    (a) => a.warrantyDaysRemaining !== null && a.warrantyDaysRemaining > 0 && a.warrantyDaysRemaining <= 90
  ).length ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Asset Registry</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Physical infrastructure · all records from persisted unit linkage
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Input
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card w-full sm:w-64"
          />
          <Button variant="outline">Register Asset</Button>
        </div>
      </div>

      {/* Summary strip — same query as Control Tower */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-3">
          <Server className="h-4 w-4 text-primary shrink-0" />
          <div>
            <div className="text-xl font-black">{isLoading ? "—" : totalAssets}</div>
            <div className="text-xs text-muted-foreground">Total assets</div>
          </div>
        </div>
        <div className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
          <div>
            <div className={cn("text-xl font-black", atRiskCount > 0 ? "text-red-400" : "")}>{isLoading ? "—" : atRiskCount}</div>
            <div className="text-xs text-muted-foreground">At risk (expired)</div>
          </div>
        </div>
        <div className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <div>
            <div className={cn("text-xl font-black", expiringSoonCount > 0 ? "text-amber-400" : "")}>{isLoading ? "—" : expiringSoonCount}</div>
            <div className="text-xs text-muted-foreground">Expiring ≤ 90d</div>
          </div>
        </div>
      </div>

      {/* Property filter pills */}
      {properties.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterPropertyId(null)}
            className={cn(
              "text-xs px-3 py-1 rounded-full border font-medium transition-colors",
              filterPropertyId === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            All properties
          </button>
          {properties.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterPropertyId(filterPropertyId === p.id ? null : p.id)}
              className={cn(
                "text-xs px-3 py-1 rounded-full border font-medium transition-colors",
                filterPropertyId === p.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Asset cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-card">
              <CardContent className="p-6">
                <Skeleton className="h-6 w-3/4 mb-4" />
                <Skeleton className="h-4 w-1/2 mb-2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))
        ) : filteredAssets.length === 0 ? (
          <div className="col-span-full py-12 text-center border border-dashed border-border rounded-lg">
            <Server className="h-12 w-12 text-muted-foreground opacity-20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No assets found</h3>
          </div>
        ) : (
          filteredAssets.map((asset, index) => {
            const isAtRisk = (asset.warrantyDaysRemaining ?? 1) <= 0;
            const isExpiring =
              asset.warrantyDaysRemaining !== null &&
              asset.warrantyDaysRemaining > 0 &&
              asset.warrantyDaysRemaining <= 90;

            return (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                key={asset.id}
              >
                <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors h-full flex flex-col">
                  <CardContent className="p-5 flex-1 flex flex-col">
                    {/* Header row */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded bg-secondary">
                          <Server className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-bold text-base leading-tight">{asset.name}</h3>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">
                            {asset.model || "Unknown Model"}
                          </div>
                        </div>
                      </div>
                      <StoplightIndicator status={asset.stoplight} size="md" pulse={asset.stoplight === "red"} />
                    </div>

                    {/* Unit linkage badge — single source of truth */}
                    {asset.location && (
                      <div className="flex items-center gap-1.5 mb-3 px-2 py-1 rounded-md bg-secondary/50 border border-border/40 w-fit max-w-full">
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground truncate">{asset.location}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-y-2.5 gap-x-2 text-sm mt-1 mb-3 flex-1">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Status</div>
                        <div className="font-medium capitalize text-sm">{asset.status.replace("_", " ")}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Health</div>
                        <div className="font-mono text-sm">{asset.healthScore}/100</div>
                      </div>
                      {asset.serial && (
                        <div className="col-span-2">
                          <div className="text-muted-foreground text-xs uppercase tracking-wider mb-0.5">Serial</div>
                          <div className="font-mono text-xs truncate">{asset.serial}</div>
                        </div>
                      )}
                    </div>

                    {/* Warranty bar */}
                    <div className="pt-3 border-t border-border/50 flex items-center justify-between mt-auto">
                      {asset.warrantyDaysRemaining !== null ? (
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          {isAtRisk ? (
                            <ShieldAlert className="h-4 w-4 text-red-400" />
                          ) : isExpiring ? (
                            <AlertTriangle className="h-4 w-4 text-amber-400" />
                          ) : (
                            <ShieldCheck className="h-4 w-4 text-status-green" />
                          )}
                          <span className={cn(
                            isAtRisk ? "text-red-400" : isExpiring ? "text-amber-400" : "text-muted-foreground"
                          )}>
                            {isAtRisk
                              ? `Expired ${Math.abs(asset.warrantyDaysRemaining)}d ago`
                              : `${asset.warrantyDaysRemaining}d remaining`}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No warranty data</div>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 font-mono">
                        A-{String(asset.id).padStart(4, "0")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
