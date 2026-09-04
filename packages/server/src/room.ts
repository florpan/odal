import { addPlayer, createGame, emptyEvents, stepGame } from '@odal/engine';
import type { Command, GameState, LobbyInfo, PlayerCommand, TechTree, TickEvents } from '@odal/engine';
import { send } from './conn';
import type { WS } from './conn';
import { snapshotFor, welcomeFor } from './visibility';

// ---------------------------------------------------------------------------
// Rooms: one game each. lobby -> playing -> (restart) -> lobby.
// ---------------------------------------------------------------------------

export interface Member {
  name: string;
  ready: boolean;
  playerId: number; // 0 while in the lobby
}

export class Room {
  phase: 'lobby' | 'playing' = 'lobby';
  state: GameState | null = null;
  readonly members = new Map<WS, Member>();
  emptySince: number | null = null;
  private pending: PlayerCommand[] = [];
  private events: TickEvents = emptyEvents(); // events from joins between ticks

  constructor(
    readonly name: string,
    private readonly tree: TechTree,
  ) {}

  info(): LobbyInfo {
    return {
      type: 'lobby',
      room: this.name,
      phase: this.phase,
      players: [...this.members.values()].map((m) => ({ name: m.name, ready: m.ready })),
    };
  }

  broadcastLobby() {
    const info = this.info();
    for (const ws of this.members.keys()) send(ws, info);
  }

  join(ws: WS, name: string) {
    this.emptySince = null;
    const member: Member = { name, ready: false, playerId: 0 };
    this.members.set(ws, member);

    if (this.phase === 'playing' && this.state) {
      // Reconnect to an unattended player with the same name, otherwise join as a new player.
      const taken = new Set([...this.members.values()].map((m) => m.playerId));
      const existing = Object.values(this.state.players).find((p) => p.name === name && !taken.has(p.id));
      member.playerId = existing ? existing.id : addPlayer(this.state, name, this.events).id;
      member.ready = true;
      send(ws, welcomeFor(this.state, member.playerId));
      console.log(`[${this.name}] ${name} ${existing ? 'reconnected as' : 'joined as'} player ${member.playerId}`);
    } else {
      console.log(`[${this.name}] ${name} entered the lobby (${this.members.size} waiting)`);
    }
    this.broadcastLobby();
  }

  leave(ws: WS) {
    const member = this.members.get(ws);
    this.members.delete(ws);
    if (member) console.log(`[${this.name}] ${member.name} left (${this.members.size} connected)`);
    if (this.members.size === 0) this.emptySince = Date.now();
    else this.broadcastLobby();
  }

  setReady(ws: WS, ready: boolean) {
    const member = this.members.get(ws);
    if (!member || this.phase !== 'lobby') return;
    member.ready = ready;
    this.broadcastLobby();
    if (this.members.size > 0 && [...this.members.values()].every((m) => m.ready)) this.start();
  }

  command(ws: WS, cmd: Command) {
    const member = this.members.get(ws);
    if (!member?.playerId || this.phase !== 'playing') return;
    this.pending.push({ playerId: member.playerId, cmd });
  }

  start() {
    const seed = Math.floor(Math.random() * 1e9);
    this.state = createGame(this.tree, seed);
    this.phase = 'playing';
    this.pending = [];
    this.events = emptyEvents();
    for (const m of this.members.values()) m.playerId = addPlayer(this.state, m.name, this.events).id;
    for (const [ws, m] of this.members) send(ws, welcomeFor(this.state, m.playerId));
    this.broadcastLobby();
    console.log(`[${this.name}] game started with ${this.members.size} players (seed ${seed})`);
  }

  restart() {
    if (this.phase !== 'playing') return;
    this.phase = 'lobby';
    this.state = null;
    this.pending = [];
    for (const m of this.members.values()) {
      m.ready = false;
      m.playerId = 0;
    }
    this.broadcastLobby();
    console.log(`[${this.name}] restarted, back to lobby`);
  }

  tick(dt: number) {
    if (this.phase !== 'playing' || !this.state) return;
    const state = this.state;
    const ev = stepGame(state, this.pending.splice(0), dt);
    ev.nodesChanged.push(...this.events.nodesChanged);
    ev.nodesRemoved.push(...this.events.nodesRemoved);
    ev.messages.push(...this.events.messages);
    this.events = emptyEvents();
    const nodesChanged = ev.nodesChanged.map((id) => state.nodes[id]).filter(Boolean);
    for (const [ws, m] of this.members) {
      if (m.playerId) send(ws, snapshotFor(state, m.playerId, ev, nodesChanged));
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly tree: TechTree,
    private readonly emptyTtlMs: number,
  ) {}

  get(name: string): Room {
    let room = this.rooms.get(name);
    if (!room) {
      room = new Room(name, this.tree);
      this.rooms.set(name, room);
    }
    return room;
  }

  find(name: string | null): Room | undefined {
    return name ? this.rooms.get(name) : undefined;
  }

  tick(dt: number) {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.tick(dt);
      if (room.members.size === 0 && room.emptySince !== null && now - room.emptySince > this.emptyTtlMs) {
        this.rooms.delete(room.name);
        console.log(`[${room.name}] removed (empty)`);
      }
    }
  }
}
