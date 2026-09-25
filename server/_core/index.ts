import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { registerChatStreamRoute } from "../chat-stream";
import { registerAttachmentUploadRoute } from "../attachment-upload";
import { registerProviderHealthScheduleRoute } from "../provider-health-schedule";
import { registerKnowledgeScheduleRoute } from "../knowledge-schedule";
import { registerMemoryExtractionScheduleRoute } from "../memory-extraction-schedule";
import { registerGuestCleanupScheduleRoute } from "../guest-cleanup-schedule";
import { startupCleanupExpiredGuests } from "./guest-session";
import { registerDevRoute } from "../dev-api";
import { registerStytchAuthRoutes } from "../stytch-auth";
import { refreshProviderHealth } from "../providers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerStytchAuthRoutes(app);
  registerAttachmentUploadRoute(app);
  registerChatStreamRoute(app);
  registerProviderHealthScheduleRoute(app);
  registerKnowledgeScheduleRoute(app);
  registerMemoryExtractionScheduleRoute(app);
  registerGuestCleanupScheduleRoute(app);
  registerDevRoute(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : await findAvailablePort(3000);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // C4: free-first fallback for Render sleep — runs once at startup
    void startupCleanupExpiredGuests().catch(() => undefined);
    // Best-effort deployment/start check. Daily rechecks are handled by Heartbeat.
    void refreshProviderHealth().catch(() => undefined);
  });
}

startServer().catch(console.error);
