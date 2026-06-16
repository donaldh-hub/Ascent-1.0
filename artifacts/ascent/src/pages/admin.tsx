import { Link } from "wouter";
import { Server, ExternalLink } from "lucide-react";
import { SystemHealthPanel } from "@/components/admin/system-health-panel";
import { LaunchReadinessPanel } from "@/components/admin/launch-readiness-panel";

export default function AdminPage() {
  return (
    <div className="space-y-6" data-testid="admin-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time observability — database connectivity, record counts, and service latency.
          </p>
        </div>
        <Link href="/dev/build-auditor">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5"
          >
            Build Auditor
            <ExternalLink className="h-3 w-3" />
          </button>
        </Link>
      </div>

      <SystemHealthPanel />
      <LaunchReadinessPanel />
    </div>
  );
}
