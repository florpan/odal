import { PROTOCOL_VERSION } from '@odal/engine';
import type { ClientMessage } from '@odal/engine';
import { send } from './conn';
import type { WS } from './conn';
import type { RoomManager } from './room';

// ---------------------------------------------------------------------------
// Session: decode one client's messages and route them to its room.
// Malformed input is ignored; the engine validates the rest.
// ---------------------------------------------------------------------------

const MAX_NAME = 16;
const MAX_ROOM = 24;

export function handleMessage(rooms: RoomManager, ws: WS, raw: string | Buffer) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;
  const room = rooms.find(ws.data.room);

  switch (msg.type) {
    case 'join': {
      if (room) return;
      if (msg.version !== PROTOCOL_VERSION) {
        send(ws, {
          type: 'error',
          text: `Protocol mismatch: client ${msg.version}, server ${PROTOCOL_VERSION}. Reload the page.`,
        });
        return;
      }
      const name =
        String(msg.name ?? '')
          .trim()
          .slice(0, MAX_NAME) || 'Player';
      const roomName =
        String(msg.room ?? '')
          .trim()
          .toLowerCase()
          .slice(0, MAX_ROOM) || 'main';
      ws.data.room = roomName;
      rooms.get(roomName).join(ws, name);
      break;
    }
    case 'ready':
      room?.setReady(ws, !!msg.ready);
      break;
    case 'cmd':
      if (msg.cmd && typeof msg.cmd.type === 'string') room?.command(ws, msg.cmd);
      break;
    case 'restart':
      room?.restart();
      break;
  }
}

export function handleClose(rooms: RoomManager, ws: WS) {
  rooms.find(ws.data.room)?.leave(ws);
}
