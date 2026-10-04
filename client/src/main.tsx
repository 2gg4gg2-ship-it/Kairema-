import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { startLogin } from "./const";
import { nextDiagId, startDiagFetch } from "./lib/diag";
import { runtimeAuthHeaders } from "./lib/runtime-auth";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/** The request path for the diagnostic line, resolved for either form `fetch` is given. */
function diagPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, location.href).pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url, location.href).pathname;
}

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Preview auto-login fallback: when the browser blocks iframe cookies
        // (Safari ITP / private browsing / WebView), the runtime mirrors the
        // session into sessionStorage so we can forward it as a Bearer token.
        // The regular OAuth cookie flow keeps working and takes priority server-side.
        return runtimeAuthHeaders();
      },
      fetch(input, init) {
        // Diagnostic timing only: the promise, its arguments and every byte of it are passed through
        // untouched. The wrapper records when the request left the page and when its promise settled,
        // because that interval is the one leg of the startup path that is invisible to the native
        // loopback log. No body, header or cookie is read here.
        const done = startDiagFetch(
          nextDiagId(),
          init?.method ?? "GET",
          diagPath(input),
        );
        const pending = globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
        return pending.then(
          response => {
            done("ok", response.status);
            return response;
          },
          failure => {
            done("error");
            throw failure;
          },
        );
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
