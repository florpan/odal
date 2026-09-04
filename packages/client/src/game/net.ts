import { PROTOCOL_VERSION } from '@odal/engine';
import type { ClientMessage, Command, ServerMessage } from '@odal/engine';

export interface NetHandlers {
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  onClose: () => void;
}

/** Thin WebSocket wrapper: joins a room on open, forwards decoded server messages. */
export class Net {
  private ws: WebSocket;

  constructor(url: string, name: string, room: string, handlers: NetHandlers) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      handlers.onOpen();
      this.raw({ type: 'join', name, room, version: PROTOCOL_VERSION });
    };
    this.ws.onmessage = (e) => handlers.onMessage(JSON.parse(e.data) as ServerMessage);
    this.ws.onclose = () => handlers.onClose();
  }

  send(cmd: Command) {
    this.raw({ type: 'cmd', cmd });
  }

  setReady(ready: boolean) {
    this.raw({ type: 'ready', ready });
  }

  restart() {
    this.raw({ type: 'restart' });
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }

  private raw(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
