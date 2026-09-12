// Vercel Functions support Express applications as a default export. Keeping
// the listener in artifacts/api-server/src/index.ts preserves Replit's
// long-running development workflow while this entry stays serverless.
import app from "../artifacts/api-server/src/app";

export default app;