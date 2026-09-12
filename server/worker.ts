/**
 * Cloudflare Workers entry. Static assets in ./dist are served first; anything else
 * (the /api routes) lands here. Set the key with: npx wrangler secret put ANTHROPIC_API_KEY
 */
import { app } from "./app";

export default app;
