import { useListAssets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { StoplightIndicator, StoplightBadge } from "@/components/stoplight";
import { Server, Settings, AlertTriangle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Assets() {
  const { data: assets, isLoading } = useListAssets();
  const [search, setSearch] = useState("");

  const filteredAssets = assets?.filter(asset => 
    asset.name.toLowerCase().includes(search.toLowerCase()) ||
    (asset.model && asset.model.toLowerCase().includes(search.toLowerCase())) ||
    (asset.serial && asset.serial.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Asset Registry</h1>
          <p className="text-muted-foreground mt-1 text-sm">Physical and digital infrastructure health</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Input 
            placeholder="Search assets..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card w-full sm:w-64"
          />
          <Button>Register Asset</Button>
        </div>
      </div>

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
        ) : filteredAssets?.length === 0 ? (
          <div className="col-span-full py-12 text-center border border-dashed border-border rounded-lg">
            <Server className="h-12 w-12 text-muted-foreground opacity-20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No assets found</h3>
          </div>
        ) : (
          filteredAssets?.map((asset, index) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              key={asset.id}
            >
              <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors h-full flex flex-col">
                <CardContent className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded bg-secondary">
                        <Server className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg leading-tight">{asset.name}</h3>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">{asset.model || 'Unknown Model'}</div>
                      </div>
                    </div>
                    <StoplightIndicator status={asset.stoplight} size="md" pulse={asset.stoplight === 'red'} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2 mb-4 flex-1">
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Status</div>
                      <div className="font-medium capitalize">{asset.status.replace('_', ' ')}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Health</div>
                      <div className="font-mono">{asset.healthScore}/100</div>
                    </div>
                    {asset.location && (
                      <div className="col-span-2">
                        <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Location</div>
                        <div className="truncate">{asset.location}</div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-border/50 flex items-center justify-between mt-auto">
                    {asset.warrantyDaysRemaining !== null ? (
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {asset.warrantyDaysRemaining < 30 ? (
                          <AlertTriangle className="h-4 w-4 text-status-red" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-status-green" />
                        )}
                        <span className={asset.warrantyDaysRemaining < 30 ? "text-status-red" : "text-muted-foreground"}>
                          {asset.warrantyDaysRemaining} days warranty
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No warranty data</div>
                    )}
                    
                    {asset.maintenanceSchedule && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground" title="Maintenance Schedule">
                        <Settings className="h-3 w-3" />
                        {asset.maintenanceSchedule}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
