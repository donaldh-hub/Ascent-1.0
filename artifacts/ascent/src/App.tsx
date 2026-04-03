import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import Layout from "@/components/layout";

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

function Router() {
  const [location] = useLocation();
  const isSetup = location === "/setup" || location.startsWith("/setup?");

  if (isSetup) {
    return <Setup />;
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
