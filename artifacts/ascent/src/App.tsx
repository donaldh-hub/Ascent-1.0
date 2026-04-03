import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import Layout from "@/components/layout";
import { Activity } from "lucide-react";
import { useSetupStatus } from "@/hooks/use-setup-status";

// Pages
import Dashboard from "@/pages/dashboard";
import Workflows from "@/pages/workflows";
import WorkflowDetail from "@/pages/workflow-detail";
import Assets from "@/pages/assets";
import Analytics from "@/pages/analytics";
import Alerts from "@/pages/alerts";
import Units from "@/pages/units";
import UnitDetail from "@/pages/unit-detail";
import Setup from "@/pages/setup";

const queryClient = new QueryClient();

// ─── Gate loader ──────────────────────────────────────────────────────────────

function SetupCheckLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Activity className="h-5 w-5 text-primary animate-pulse" />
        <span className="text-sm">Loading...</span>
      </div>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  const [location, navigate] = useLocation();
  const isSetupRoute = location === "/setup" || location.startsWith("/setup?");

  const { isComplete, isLoading } = useSetupStatus();

  // /setup is always accessible
  if (isSetupRoute) {
    return <Setup />;
  }

  // Hold rendering while we check real data
  if (isLoading) {
    return <SetupCheckLoader />;
  }

  // Setup incomplete — gate ALL protected routes
  if (!isComplete) {
    // Use an effect-based redirect to avoid render-phase side effects
    return <SetupRedirect navigate={navigate} />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/workflows/:id" component={WorkflowDetail} />
        <Route path="/assets" component={Assets} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/units" component={Units} />
        <Route path="/units/:id" component={UnitDetail} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function SetupRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => {
    navigate("/setup");
  }, [navigate]);
  return <SetupCheckLoader />;
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
