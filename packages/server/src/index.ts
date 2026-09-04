import { join } from 'node:path';
import { DEFAULT_TREE, loadTreeDir } from '@odal/content';
import type { Conn } from './conn';
import { RoomManager } from './room';
import { handleClose, handleMessage } from './session';
import { staticHandler } from './static';

// ---------------------------------------------------------------------------
// Entry point: configuration, HTTP/WebSocket wiring, and the tick timer.
// Everything else lives in room.ts (game lifecycle), session.ts (message
// routing), visibility.ts (fog filtering) and static.ts (built client).
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS ?? 5 * 60_000);
const tree = process.env.TREE_DIR ? loadTreeDir(process.env.TREE_DIR) : DEFAULT_TREE;

const rooms = new RoomManager(tree, EMPTY_ROOM_TTL_MS);
const serveStatic = staticHandler(join(import.meta.dir, '../../client/dist'));

Bun.serve<Conn>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (server.upgrade(req, { data: { room: null } })) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    message: (ws, raw) => handleMessage(rooms, ws, raw),
    close: (ws) => handleClose(rooms, ws),
  },
});

const dt = 1 / tree.rules.tickRate;
setInterval(() => rooms.tick(dt), 1000 * dt);

console.log(`Odal server on http://localhost:${PORT}  (ruleset "${tree.name}", ${tree.rules.tickRate} ticks/s)`);
