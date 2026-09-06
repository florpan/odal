import { hexCentre, PROTOCOL_VERSION, idx } from '@odal/engine';
import type { Building, ServerMessage } from '@odal/engine';
import { appStore, toggleOverlay } from '../app/store';
import { Input } from './input';
import { drawMinimap, minimapToWorld } from './minimap';
import { Net } from './net';
import { hexAtlasSeason } from './render/models';
import { Renderer } from './render/scene';
import { buildHud } from './viewmodel';
import { World } from './world';

const MESSAGE_TTL_MS = 9000;

/**
 * One connection to one room, from the start screen until the player leaves.
 *
 * This is the controller the UI talks to. It owns the world, the network
 * connection and, while the game screen is mounted, the renderer, the input
 * handling and the frame loop (see attach()). It publishes a HUD view model
 * to the app store; React never touches anything else in here.
 */
export class GameSession {
  readonly world = new World();
  private net: Net;
  private renderer: Renderer | null = null;
  private input: Input | null = null;
  private raf = 0;
  private disposed = false;

  constructor(
    readonly name: string,
    readonly room: string,
  ) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    appStore.setState({ connection: 'connecting', you: name, room, error: null });
    this.net = new Net(url, name, room, {
      onOpen: () => appStore.setState({ connection: 'open' }),
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => {
        if (this.disposed) return;
        appStore.setState({
          connection: 'closed',
          error: 'Disconnected from server. Leave and join again to reconnect.',
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // Network
  // -------------------------------------------------------------------------

  private onMessage(msg: ServerMessage) {
    if (this.disposed) return;
    switch (msg.type) {
      case 'lobby':
        this.world.handle(msg);
        appStore.setState((s) => ({ lobby: msg, screen: msg.phase === 'lobby' ? 'lobby' : s.screen }));
        break;
      case 'welcome':
        if (msg.version !== PROTOCOL_VERSION) {
          appStore.setState({
            error: `Protocol mismatch (client ${PROTOCOL_VERSION}, server ${msg.version}). Reload the page.`,
          });
          return;
        }
        this.world.handle(msg);
        this.input?.cancelMode();
        this.resetScene();
        appStore.setState({ screen: 'game' });
        this.publish();
        break;
      case 'snapshot':
        this.world.handle(msg);
        this.syncScene();
        this.publish();
        break;
      case 'error':
        this.world.handle(msg);
        appStore.setState({ error: msg.text });
        this.publish();
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Canvas lifecycle (called by the GameCanvas bridge component)
  // -------------------------------------------------------------------------

  /** Start rendering into a canvas. Returns the matching teardown. */
  attach(canvas: HTMLCanvasElement): () => void {
    // Dev knob: ?atlas=summer|fall|winter swaps the Hexagon pack's texture for a seasonal one.
    this.renderer = new Renderer(canvas, { atlas: hexAtlasSeason(new URLSearchParams(location.search).get('atlas')) });
    this.input = new Input(this.world, this.renderer, this.net, () => this.publish());
    this.resetScene();
    this.publish();

    let last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(this.raf);
      this.input?.dispose();
      this.renderer?.dispose();
      this.input = null;
      this.renderer = null;
    };
  }

  private frame(dt: number, now: number) {
    const r = this.renderer;
    const st = this.world.state;
    if (!r) return;
    this.input?.update(dt);
    if (st) {
      const node = this.world.selectedNode !== null ? st.nodes[this.world.selectedNode] : null;
      r.setSelection(this.world.selectedUnits, this.world.selectedBuilding, this.world.renderBuildings(), node);
      const b = this.world.selectedBuilding !== null ? st.buildings[this.world.selectedBuilding] : undefined;
      r.setRallyMarker(b && b.owner === this.world.playerId ? b.rally : null);
    }
    r.update(dt);
    r.render();
    if (this.world.pruneMessages(now, MESSAGE_TTL_MS)) this.publish();
  }

  /** New map: clear the scene and centre the camera on the player's start building. */
  private resetScene() {
    const r = this.renderer;
    const st = this.world.state;
    if (!r || !st) return;
    r.reset();
    r.setMap(st);
    r.preloadModels(st.tree);
    const home = Object.values(st.buildings).find(
      (b) => b.owner === this.world.playerId && b.type === st.tree.start.building,
    );
    if (home) r.camTarget = hexCentre(home.x, home.y);
    this.syncScene();
  }

  private syncScene() {
    const r = this.renderer;
    const st = this.world.state;
    if (!r || !st) return;
    r.updateFog(this.world.vision, this.world.explored);
    r.syncNodes(st, this.world.explored);
    r.syncBuildings(st, this.world.renderBuildings(), new Set(Object.keys(this.world.ghosts).map(Number)));
    r.syncUnits(st);
  }

  // -------------------------------------------------------------------------
  // API for the UI
  // -------------------------------------------------------------------------

  publish() {
    appStore.setState({ hud: buildHud(this.world, this.input) });
  }

  setReady(ready: boolean) {
    this.net.setReady(ready);
  }

  restart() {
    this.net.restart();
  }

  /** Perform a HUD action by id (see viewmodel.ts for the id scheme). */
  action(id: string) {
    const input = this.input;
    const st = this.world.state;
    if (!input || !st) return;
    const [kind, arg] = id.split(':');
    const bId = this.world.selectedBuilding;
    switch (kind) {
      case 'build':
        input.enterBuildMode(arg);
        break;
      case 'train':
        if (bId !== null) this.net.send({ type: 'train', buildingId: bId, unit: arg });
        break;
      case 'research': {
        // From the action bar the selected building researches it; from the tech tree
        // screen any own building that can, preferring the shortest queue.
        const at = this.researcher(arg, bId);
        if (at !== null) this.net.send({ type: 'research', buildingId: at, tech: arg });
        break;
      }
      case 'tree':
      case 'keys':
        toggleOverlay(kind);
        break;
      case 'cancelQueue':
        if (bId !== null) this.net.send({ type: 'cancelQueue', buildingId: bId, index: Number(arg) });
        break;
      case 'clearRally':
        if (bId !== null) this.net.send({ type: 'setRally', buildingId: bId, target: null });
        break;
      case 'attackMove':
        input.enterAttackMoveMode();
        break;
      case 'stop':
        input.stop();
        break;
    }
    this.publish();
  }

  /** The own completed building that should research `tech`: `preferred` if it can, else the least busy one. */
  private researcher(tech: string, preferred: number | null): number | null {
    const st = this.world.state;
    if (!st) return null;
    const defs = idx(st.tree).buildings;
    const can = (b: Building | undefined) =>
      !!b && b.owner === this.world.playerId && b.progress >= 1 && defs[b.type].researches.includes(tech);
    if (preferred !== null && can(st.buildings[preferred])) return preferred;
    let best: Building | null = null;
    for (const id in st.buildings) {
      const b = st.buildings[id];
      if (can(b) && (!best || b.queue.length < best.queue.length)) best = b;
    }
    return best?.id ?? null;
  }

  /** Minimap support for the Minimap component, which owns a small 2D canvas. */
  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number) {
    drawMinimap(ctx, w, h, this.world, this.renderer);
  }

  minimapClick(x01: number, y01: number, button: number) {
    const p = minimapToWorld(this.world, x01, y01);
    if (!p) return;
    if (button === 2) {
      const ids = this.world.selectedUnits;
      if (ids.length) this.net.send({ type: 'move', unitIds: ids, target: p });
    } else if (this.renderer) {
      this.renderer.camTarget = p;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input?.dispose();
    this.renderer?.dispose();
    this.net.close();
  }
}
