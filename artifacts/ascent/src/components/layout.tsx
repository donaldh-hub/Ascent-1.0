import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, GitBranch, Server, TrendingUp, Bell, Building2, FileText, ClipboardCheck, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListAlerts } from "@workspace/api-client-react";

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: unreadAlerts } = useListAlerts({ unreadOnly: true });
  
  const navItems = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/workflows", label: "Workflows", icon: GitBranch },
    { href: "/properties", label: "Properties", icon: MapPin },
    { href: "/documents", label: "Documents", icon: FileText },
    { href: "/assignments", label: "Assignments", icon: ClipboardCheck },
    { href: "/assets", label: "Assets", icon: Server },
    { href: "/analytics", label: "Analytics", icon: TrendingUp },
    { 
      href: "/alerts", 
      label: "Alerts", 
      icon: Bell,
      badge: unreadAlerts && unreadAlerts.length > 0 ? unreadAlerts.length : undefined
    },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col z-10 shadow-xl">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Link href="/" className="flex items-center gap-2 cursor-pointer">
            <Activity className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg tracking-wider text-primary">ASCENT <span className="text-muted-foreground text-sm font-normal">1.0</span></span>
          </Link>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-4 px-3">
            Operations
          </div>
          {navItems.map((item) => {
            const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors group",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className={cn("h-5 w-5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span className="bg-destructive text-destructive-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center border border-border">
              <span className="text-xs font-bold text-muted-foreground">OP</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Ops Director</span>
              <span className="text-xs text-status-green flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-status-green inline-block animate-pulse"></span>
                System Online
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-y-auto">
        {/* Subtle grid pattern overlay for war room vibe */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] z-0"></div>
        <div className="relative z-10 flex-1 flex flex-col p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
