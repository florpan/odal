import type { ServerWebSocket } from 'bun';
import type { ServerMessage } from '@odal/engine';

/** Per-connection data attached by Bun to each WebSocket. */
export interface Conn {
  room: string | null; // room name once joined
}

export type WS = ServerWebSocket<Conn>;

export function send(ws: WS, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}
