import { computeVision, hexCentre, isBuildingVisible, revealed } from '@odal/engine';
import type { Building, GameState, Player, ServerMessage, Snapshot, Unit } from '@odal/engine';
import type { MessageView } from './viewmodel';

/**
 * Something the player should look at: their own unit or building took damage or died (`attack`), or an
 * enemy came into view that had not been seen for a while (`spotted`). Derived on the client from
 * snapshot differences; the radar shows them on its rim and Space jumps the camera to the latest.
 */
export interface Alert {
  id: number;
  kind: 'attack' | 'spotted';
  x: number;
  y: number;
  /** performance.now() when it was raised or last refreshed. */
  at: number;
}

/** Alerts of one kind this close (world units) and this fresh (ms) merge into one instead of piling up. */
export const ALERT_MERGE_RADIUS = 8;
export const ALERT_TTL_MS = 8000;
/** An enemy seen within this long ago is not "spotted" again when it comes back into view. */
const SPOTTED_MEMORY_MS = 20000;

/** Client-side copy of the game state, fog of war and UI selection. Pure TS, no React. */
export class World {
  state: GameState | null = null;
  playerId = 0;
  selectedUnits: number[] = [];
  selectedBuilding: number | null = null;
  selectedNode: number | null = null;
  messages: MessageView[] = [];
  /** Live alerts, oldest first (pruneAlerts drops the expired ones). */
  alerts: Alert[] = [];
  private nextAlertId = 1;
  /** When each enemy unit or building was last in view, for the "spotted" alert. */
  private enemySeenAt: Record<number, number> = {};
  /** The clock alerts are stamped with; tests override it. */
  now: () => number = () => performance.now();

  vision: Uint8Array | null = null; // currently visible tiles
  explored: Uint8Array | null = null; // ever seen tiles: their terrain and resources are known
  /** Tiles whose terrain is known: explored ones, or every tile once a tech reveals the map (Cartography). */
  charted: Uint8Array | null = null;
  /** A tech reveals every resource node, so nodes show on unexplored ground too (none does yet). */
  nodesRevealed = false;
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
    this.charted = null;
    this.nodesRevealed = false;
    this.alerts = [];
    this.enemySeenAt = {};
  }

  /** The most recent alert, for jumping the camera to it. */
  latestAlert(): Alert | null {
    return this.alerts.length ? this.alerts[this.alerts.length - 1] : null;
  }

  /** Drop alerts older than ALERT_TTL_MS; returns true if anything changed. */
  pruneAlerts(now: number): boolean {
    const live = this.alerts.filter((a) => now - a.at < ALERT_TTL_MS);
    if (live.length === this.alerts.length) return false;
    this.alerts = live;
    return true;
  }

  /** Raise an alert, or refresh a live one of the same kind nearby (moved to the back as the latest). */
  private raiseAlert(kind: Alert['kind'], x: number, y: number) {
    const now = this.now();
    const i = this.alerts.findIndex(
      (a) => a.kind === kind && now - a.at < ALERT_TTL_MS && Math.hypot(a.x - x, a.y - y) <= ALERT_MERGE_RADIUS,
    );
    if (i >= 0) {
      const [a] = this.alerts.splice(i, 1);
      this.alerts.push({ ...a, x, y, at: now });
      return;
    }
    this.alerts.push({ id: this.nextAlertId++, kind, x, y, at: now });
    this.addMessage(kind === 'attack' ? 'Under attack!' : 'Enemy spotted!');
  }

  /**
   * Compare the previous snapshot with the new one: own things that lost HP or vanished are attacks;
   * enemies in view that were not seen for SPOTTED_MEMORY_MS are spotted.
   */
  private detectAlerts(prevUnits: Record<number, Unit>, prevBuildings: Record<number, Building>) {
    const st = this.state!;
    const now = this.now();
    for (const id in prevUnits) {
      const was = prevUnits[id];
      if (was.owner !== this.playerId) continue;
      const is = st.units[id];
      if (!is || is.hp < was.hp) this.raiseAlert('attack', (is ?? was).x, (is ?? was).y);
    }
    for (const id in prevBuildings) {
      const was = prevBuildings[id];
      if (was.owner !== this.playerId) continue;
      const is = st.buildings[id];
      if (!is || is.hp < was.hp) {
        const c = hexCentre(was.x, was.y);
        this.raiseAlert('attack', c.x, c.y);
      }
    }
    for (const id in st.units) {
      const u = st.units[id];
      if (u.owner === this.playerId) continue;
      const seen = this.enemySeenAt[id];
      if (seen === undefined || now - seen > SPOTTED_MEMORY_MS) this.raiseAlert('spotted', u.x, u.y);
      this.enemySeenAt[id] = now;
    }
    for (const id in st.buildings) {
      const b = st.buildings[id];
      if (b.owner === this.playerId) continue;
      const seen = this.enemySeenAt[id];
      if (seen === undefined || now - seen > SPOTTED_MEMORY_MS) {
        const c = hexCentre(b.x, b.y);
        this.raiseAlert('spotted', c.x, c.y);
      }
      this.enemySeenAt[id] = now;
    }
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
    const prevUnits = st.units;
    const prevBuildings = st.buildings;
    st.units = {};
    for (const u of s.units) st.units[u.id] = u;
    st.buildings = {};
    for (const b of s.buildings) st.buildings[b.id] = b;
    st.shots = {};
    for (const sh of s.shots) st.shots[sh.id] = sh;
    st.players = {};
    for (const p of s.players) st.players[p.id] = p;
    for (const n of s.nodesChanged) st.nodes[n.id] = n;
    for (const id of s.nodesRemoved) delete st.nodes[id];
    for (const m of s.messages) this.addMessage(m.text);

    this.detectAlerts(prevUnits, prevBuildings);
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
    const n = this.vision.length;
    if (!this.explored || this.explored.length !== n) this.explored = new Uint8Array(n);
    if (!this.charted || this.charted.length !== n) this.charted = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (this.vision[i]) this.explored[i] = 1;
    // What research has revealed: the terrain everywhere (Cartography), or the nodes (nothing yet).
    const me = this.me();
    if (me && revealed(st.tree, me, 'terrain')) this.charted.fill(1);
    else for (let i = 0; i < n; i++) if (this.explored[i]) this.charted[i] = 1;
    this.nodesRevealed = !!me && revealed(st.tree, me, 'nodes');
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
