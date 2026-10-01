import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Home from "./pages/Home";
import OwnerAnalytics from "./pages/OwnerAnalytics";
import AIProviders from "./pages/AIProviders";
import Terminal from "./pages/Terminal";
import Welcome from "./pages/Welcome";

export function VerifiedSessionRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: false });
  if (loading || !user) return <Welcome />;
  return <>{children}</>;
}

export function RootRoute() {
  const isWelcomeEntry = new URLSearchParams(window.location.search).get("welcome") === "1";
  if (isWelcomeEntry) return <Welcome />;
  return <VerifiedSessionRoute><Home /></VerifiedSessionRoute>;
}

export function OwnerAnalyticsRoute() {
  return <VerifiedSessionRoute><OwnerAnalytics /></VerifiedSessionRoute>;
}

/** BYOK settings: a guest has no permanent storage for a credential, so the route requires a verified session. */
export function AIProvidersRoute() {
  return <VerifiedSessionRoute><AIProviders /></VerifiedSessionRoute>;
}

/**
 * The on-device terminal.
 *
 * <p>Not gated on a verified session, because it never touches a Kairema account: it is a local
 * Linux shell running in the app's own storage. The sidebar entry is shown only on native Android
 * (see Home.tsx); the route itself is harmless on the web, where its requests simply fail because
 * no loopback terminal exists there.
 */
export function TerminalRoute() {
  return <Terminal />;
}

function Router() { return <Switch><Route path="/" component={RootRoute} /><Route path="/welcome" component={Welcome} /><Route path="/owner-analytics" component={OwnerAnalyticsRoute} /><Route path="/settings/providers" component={AIProvidersRoute} /><Route path="/terminal" component={TerminalRoute} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch>; }

function App() { return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>; }

export default App;
