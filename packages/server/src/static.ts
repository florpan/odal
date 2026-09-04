import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Serves the built client (packages/client/dist) with an index.html fallback for the SPA. */
export function staticHandler(distDir: string): (pathname: string) => Promise<Response> {
  return async (pathname) => {
    if (!existsSync(distDir)) {
      return new Response('Client not built. Run `bun run build`, or use the Vite dev server on port 5173.', {
        status: 404,
      });
    }
    const file = Bun.file(join(distDir, pathname === '/' ? 'index.html' : pathname));
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(distDir, 'index.html')));
  };
}
