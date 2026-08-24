import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import OwnerAnalytics from "./pages/OwnerAnalytics";
import Welcome from "./pages/Welcome";

function RootRoute() {
  const isWelcomeEntry = new URLSearchParams(window.location.search).get("welcome") === "1";
  if (isWelcomeEntry) return <Welcome />;
  return <Home />;
}

function Router() { return <Switch><Route path="/" component={RootRoute} /><Route path="/welcome" component={Welcome} /><Route path="/owner-analytics" component={OwnerAnalytics} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>; }

function App() { return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>; }

export default App;
