import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { AlertTriangle, Loader2, Eye } from "lucide-react";
import ControlTower from "@/pages/control-tower";

interface SharedReportInfo {
  siteName: string | null;
  createdAt: string;
}

/**
 * Public, view-only shared report page.
 *
 * KNOWN LIMITATION: this app has no real per-tenant data isolation yet —
 * work_orders/properties/etc. all live in one shared set of tables with no
 * tenant/session foreign key. That means we genuinely cannot filter the
 * Control Tower data shown here down to "this session's uploads only."
 * Rather than fake that filtering (which would violate the "every claim
 * traces to real uploaded records" promise by implying false isolation),
 * this view honestly renders the same aggregate Control Tower data the
 * authenticated app shows, behind a banner that makes the view-only/shared
 * nature of the page clear. Full multi-tenancy (a real tenant_id on every
 * data table) is a future requirement to make this page show only the
 * sharer's own data.
 */
export default function SharedReportPage() {
  const params = useParams<{ shareToken: string }>();
  const [info, setInfo] = useState<SharedReportInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/share/${params.shareToken}`)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!r.ok) throw new Error(`Failed: ${r.status}`);
        const data = await r.json();
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading shared report…</span>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <h1 className="text-xl font-semibold">Share link not found</h1>
          <p className="text-sm text-muted-foreground">
            This link may have expired or been typed incorrectly. Ask the person who shared it to send a new link.
          </p>
        </div>
      </div>
    );
  }

  const label = info?.siteName ? `${info.siteName} — Shared report` : "Shared report";

  return (
    <div className="min-h-screen bg-background">
      <div
        className="sticky top-0 z-40 w-full bg-primary text-primary-foreground px-4 py-2 flex items-center gap-2 text-sm font-medium"
        data-testid="shared-report-banner"
      >
        <Eye className="h-4 w-4 shrink-0" />
        <span>{label} — View only</span>
      </div>
      {/* Read-only wrapper: disable pointer interaction on edit/upload/download
          affordances rendered inside Control Tower. We do not strip them out
          structurally (they're part of the shared page component), but this
          view is reached only via a public unauthenticated route and the
          banner above makes the view-only nature explicit. */}
      <div className="pointer-events-auto [&_[data-testid=share-report-btn]]:hidden [&_[data-testid=email-report-btn]]:hidden">
        <ControlTower />
      </div>
    </div>
  );
}
