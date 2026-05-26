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
import Properties from "@/pages/properties";
import PropertyDetail from "@/pages/property-detail";
import Documents from "@/pages/documents";
import Assignments from "@/pages/assignments";
import AssignmentsReview from "@/pages/assignments-review";
import WorkOrders from "@/pages/work-orders";
import Turns from "@/pages/turns";
import Setup from "@/pages/setup";
import ControlTower from "@/pages/control-tower";
import Governance from "@/pages/governance";
import Reports from "@/pages/reports";
import BuildAuditor from "@/pages/build-auditor";

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
  // Internal /dev/* routes (e.g. Build Auditor) must work regardless of setup
  // status — they are diagnostic tools, not customer flows.
  const isDevRoute = location.startsWith("/dev/");

  const { isComplete, isLoading } = useSetupStatus();

  // /setup is always accessible
  if (isSetupRoute) {
    return <Setup />;
  }

  // Internal dev tooling is always accessible — never gated by setup.
  if (isDevRoute) {
    return (
      <Switch>
        <Route path="/dev/build-auditor" component={BuildAuditor} />
        <Route component={NotFound} />
      </Switch>
    );
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
        {/*
          Ascent 1.12.6 — Control Tower is the default landing page.
          The legacy Overview/Dashboard remains accessible at /overview
          for admin debugging only. The root path always redirects to
          /control-tower so there is exactly one entry point.
        */}
        <Route path="/" component={ControlTowerRedirect} />
        <Route path="/overview" component={Dashboard} />
        <Route path="/control-tower" component={ControlTower} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/workflows/:id" component={WorkflowDetail} />
        <Route path="/assets" component={Assets} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/properties" component={Properties} />
        <Route path="/properties/:id" component={PropertyDetail} />
        <Route path="/units" component={Units} />
        <Route path="/units/:id" component={UnitDetail} />
        <Route path="/documents" component={Documents} />
        <Route path="/assignments" component={Assignments} />
        <Route path="/assignments/review" component={AssignmentsReview} />
        <Route path="/work-orders" component={WorkOrders} />
        <Route path="/turns" component={Turns} />
        <Route path="/governance" component={Governance} />
        <Route path="/reports" component={Reports} />
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

function ControlTowerRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/control-tower", { replace: true });
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
