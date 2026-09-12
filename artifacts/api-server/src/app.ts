import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { getCanonicalAppOrigin, isVercelRuntime, requireExternalRuntimeConfig } from "./lib/runtime";

const app: Express = express();
const runningOnVercel = isVercelRuntime();

if (runningOnVercel) {
  // Vercel uses a standard Clerk instance. Replit's Clerk frontend proxy is
  // intentionally not exposed there; missing external configuration is an
  // operator error, not a reason to fall back to Replit services.
  requireExternalRuntimeConfig(["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "APP_URL"]);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (!runningOnVercel) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(
  cors(
    runningOnVercel
      ? { credentials: true, origin: getCanonicalAppOrigin() }
      : { credentials: true, origin: true },
  ),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  runningOnVercel
    ? clerkMiddleware({
        publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
        secretKey: process.env.CLERK_SECRET_KEY,
      })
    : clerkMiddleware((req) => ({
        publishableKey: publishableKeyFromHost(
          getClerkProxyHost(req) ?? "",
          process.env.CLERK_PUBLISHABLE_KEY,
        ),
      })),
);

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log.error({ err }, "Unhandled API error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
