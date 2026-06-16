import { useEffect, useState } from "react";
import { Bell, X, AlertTriangle, AlertCircle, Info, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface Notification {
  notificationId: string;
  type: "warranty_expiring" | "high_risk_asset" | "coach_insight" | "upload_reminder" | "data_gap";
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  actionLabel?: string;
  actionHref?: string;
  createdAt: string;
  dismissed?: boolean;
}

const severityMeta: Record<Notification["severity"], { icon: React.ElementType; color: string; bg: string }> = {
  critical: { icon: AlertCircle, color: "text-status-red", bg: "bg-status-red/10" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-400/10" },
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d: { notifications: Notification[] }) => setNotifications(d.notifications ?? []))
      .catch(() => {});
  }, []);

  const active = notifications.filter((n) => !dismissed.has(n.notificationId));
  const criticalCount = active.filter((n) => n.severity === "critical").length;
  const unreadCount = active.length;

  const dismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center h-8 w-8 rounded-md hover:bg-secondary transition-colors"
        aria-label="Notifications"
        data-testid="notification-bell"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full text-[10px] font-bold text-white ${criticalCount > 0 ? "bg-status-red" : "bg-amber-500"}`}
            data-testid="notification-badge"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-10 z-50 w-80 rounded-lg border border-border bg-card shadow-xl"
            data-testid="notification-dropdown"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="outline" className="text-xs">{unreadCount} active</Badge>
              )}
            </div>

            {active.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No active notifications.
              </div>
            )}

            <ul className="divide-y divide-border max-h-96 overflow-y-auto">
              {active.map((n) => {
                const meta = severityMeta[n.severity];
                const SevIcon = meta.icon;
                return (
                  <li key={n.notificationId} className="px-4 py-3" data-testid={`notification-${n.notificationId}`}>
                    <div className="flex items-start gap-2.5">
                      <div className={`mt-0.5 rounded-md p-1 ${meta.bg}`}>
                        <SevIcon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                        {n.actionLabel && n.actionHref && (
                          <Link href={n.actionHref}>
                            <button
                              type="button"
                              className="mt-1.5 text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                              onClick={() => setOpen(false)}
                            >
                              {n.actionLabel}
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          </Link>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => dismiss(n.notificationId)}
                        className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
