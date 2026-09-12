import { defineConfig, loadEnv, type Plugin } from "vite";
import { getRequestListener } from "@hono/node-server";

/**
 * Serves the Hono API from server/app.ts inside the Vite dev server, so `npm run dev`
 * is the whole stack. The module is loaded through Vite's SSR pipeline, so server edits hot-reload.
 */
function apiPlugin(): Plugin {
  return {
    name: "bottle-rocket-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const mod = await server.ssrLoadModule("/server/app.ts");
          await getRequestListener(mod.app.fetch)(req, res);
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err);
          console.error(err);
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_* vars to the browser; pull the API key out of .env for the server side.
  const env = loadEnv(mode, process.cwd(), "");
  if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  return { plugins: [apiPlugin()] };
});
