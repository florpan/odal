import { computeVision, isBuildingVisible } from '@odal/engine';
import type { Building, GameState, Player, ServerMessage, Snapshot } from '@odal/engine';
import type { MessageView } from './viewmodel';

/** Client-side copy of the game state, fog of war and UI selection. Pure TS, no React. */
export class World {
  state: GameState | null = null;
  playerId = 0;
  selectedUnits: number[] = [];
  selectedBuilding: number | null = null;
  selectedNode: number | null = null;
  messages: MessageView[] = [];

  vision: Uint8Array | null = null; // currently visible tiles
  explored: Uint8Array | null = null; // ever seen tiles
  ghosts: Record<number, Building> = {}; // enemy buildings remembered under fog
  private lastSeen: Record<number, Building> = {};
  private nextMessageId = 1;

  handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'welcome':
        this.reset();
        this.state = msg.state;
        this.playerId = msg.playerId;
        this.refreshVision();
        break;
      case 'snapshot':
        this.applySnapshot(msg);
        break;
      case 'error':
        this.addMessage(msg.text);
        break;
      case 'lobby':
        break;
    }
  }

  reset() {
    this.state = null;
    this.selectedUnits = [];
    this.selectedBuilding = null;
    this.selectedNode = null;
    this.ghosts = {};
    this.lastSeen = {};
    this.vision = null;
    this.explored = null;
  }

  me(): Player | null {
    return this.state?.players[this.playerId] ?? null;
  }

  /** Real buildings plus remembered enemy buildings, for rendering and selection. */
  renderBuildings(): Record<number, Building> {
    return this.state ? { ...this.state.buildings, ...this.ghosts } : {};
  }

  building(id: number): Building | undefined {
    return this.state?.buildings[id] ?? this.ghosts[id];
  }

  addMessage(text: string) {
    this.messages = [...this.messages, { id: this.nextMessageId++, text, at: performance.now() }].slice(-6);
  }

  /** Drop expired messages; returns true if anything changed. */
  pruneMessages(now: number, maxAgeMs: number): boolean {
    const live = this.messages.filter((m) => now - m.at < maxAgeMs);
    if (live.length === this.messages.length) return false;
    this.messages = live;
    return true;
  }

  private applySnapshot(s: Snapshot) {
    const st = this.state;
    if (!st) return;
    st.tick = s.tick;
    st.units = {};
    for (const u of s.units) st.units[u.id] = u;
    st.buildings = {};
    for (const b of s.buildings) st.buildings[b.id] = b;
    st.players = {};
    for (const p of s.players) st.players[p.id] = p;
    for (const n of s.nodesChanged) st.nodes[n.id] = n;
    for (const id of s.nodesRemoved) delete st.nodes[id];
    for (const m of s.messages) this.addMessage(m.text);

    this.refreshVision();
    this.updateGhosts();
    this.selectedUnits = this.selectedUnits.filter((id) => st.units[id]);
    if (this.selectedBuilding !== null && !this.building(this.selectedBuilding)) this.selectedBuilding = null;
    if (this.selectedNode !== null && !st.nodes[this.selectedNode]) this.selectedNode = null;
  }

  /**
   * Dev knob (`?fog=0`): see the whole map as if explored and in view. Only what the server already
   * sends becomes visible (terrain, resources, remembered buildings); other players' units stay
   * filtered by the server.
   */
  noFog = false;

  private refreshVision() {
    const st = this.state;
    if (!st) return;
    this.vision = computeVision(st, this.playerId, this.vision ?? undefined);
    if (this.noFog) this.vision.fill(1);
    if (!this.explored || this.explored.length !== this.vision.length)
      this.explored = new Uint8Array(this.vision.length);
    for (let i = 0; i < this.vision.length; i++) if (this.vision[i]) this.explored[i] = 1;
  }

  private updateGhosts() {
    const st = this.state!;
    const vision = this.vision!;
    for (const id in st.buildings) {
      const b = st.buildings[id];
      if (b.owner !== this.playerId) this.lastSeen[b.id] = b;
    }
    this.ghosts = {};
    for (const id in this.lastSeen) {
      if (st.buildings[id]) continue;
      const g = this.lastSeen[id];
      if (isBuildingVisible(vision, st.width, g.x, g.y, g.r)) delete this.lastSeen[id];
      else this.ghosts[id] = g;
    }
  }
}
