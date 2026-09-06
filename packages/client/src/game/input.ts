import { canPlaceBuilding, computeBlocked, hexCentre, idx, worldToHex } from '@odal/engine';
import type { Ability, Command, Vec2 } from '@odal/engine';
import { appStore, toggleOverlay } from '../app/store';
import type { Net } from './net';
import type { Renderer } from './render/scene';
import type { World } from './world';

const DOUBLE_TAP_MS = 400;

/**
 * Mouse and keyboard handling on the game canvas: selection, context commands,
 * camera, build placement, attack-move, control groups. Pure TS, no React.
 */
export class Input {
  buildMode: string | null = null; // building id being placed
  attackMoveMode = false;

  private keys = new Set<string>();
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private panStart: { x: number; y: number; cam: Vec2 } | null = null;
  private mouse = { x: 0, y: 0 };
  private groups = new Map<number, number[]>();
  private lastGroupTap = { n: -1, at: 0 };
  private selbox: HTMLDivElement;
  private unlisten: (() => void)[] = [];

  constructor(
    private world: World,
    private renderer: Renderer,
    private net: Net,
    private onChange: () => void,
  ) {
    const c = renderer.canvas;
    this.selbox = document.createElement('div');
    this.selbox.className = 'selbox';
    this.selbox.hidden = true;
    c.parentElement?.appendChild(this.selbox);

    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      ev: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.unlisten.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(c, 'contextmenu', (e) => e.preventDefault());
    on(c, 'pointerdown', (e) => this.onDown(e));
    on(window, 'pointermove', (e) => this.onMove(e));
    on(window, 'pointerup', (e) => this.onUp(e));
    on(
      c,
      'wheel',
      (e) => {
        renderer.zoom = Math.max(0.4, Math.min(2.2, renderer.zoom * (e.deltaY > 0 ? 1.12 : 0.89)));
        e.preventDefault();
      },
      { passive: false },
    );
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
  }

  dispose() {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    this.selbox.remove();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private ownSelected(ability?: Ability): number[] {
    const st = this.world.state;
    if (!st) return [];
    const defs = idx(st.tree).units;
    return this.world.selectedUnits.filter((id) => {
      const u = st.units[id];
      return u && u.owner === this.world.playerId && (!ability || defs[u.type].abilities.includes(ability));
    });
  }

  private select(units: number[], building: number | null, node: number | null = null) {
    this.world.selectedUnits = units;
    this.world.selectedBuilding = building;
    this.world.selectedNode = node;
    this.onChange();
  }

  private send(cmd: Command) {
    this.net.send(cmd);
  }

  private setCursor(c: string) {
    this.renderer.canvas.style.cursor = c;
  }

  enterBuildMode(building: string) {
    if (!this.ownSelected('build').length) return;
    this.attackMoveMode = false;
    this.buildMode = building;
    this.renderer.setGhost(building, this.world.state ?? undefined);
    this.setCursor('cell');
    this.onChange();
  }

  enterAttackMoveMode() {
    if (!this.ownSelected().length) return;
    this.buildMode = null;
    this.renderer.setGhost(null);
    this.attackMoveMode = true;
    this.setCursor('crosshair');
    this.onChange();
  }

  cancelMode() {
    this.buildMode = null;
    this.attackMoveMode = false;
    this.renderer.setGhost(null);
    this.setCursor('default');
    this.onChange();
  }

  /** The hex under the mouse, where the building being placed would be centred. */
  private ghostTile(): Vec2 | null {
    const st = this.world.state;
    if (!this.buildMode || !st) return null;
    const g = this.renderer.pickGround(this.mouse.x, this.mouse.y);
    if (!g) return null;
    const t = worldToHex(g);
    return t.x >= 0 && t.y >= 0 && t.x < st.width && t.y < st.height ? t : null;
  }

  stop() {
    const ids = this.ownSelected();
    if (ids.length) this.send({ type: 'stop', unitIds: ids });
  }

  private selectedOwnBuilding(): number | null {
    const st = this.world.state;
    const id = this.world.selectedBuilding;
    if (!st || id === null) return null;
    const b = st.buildings[id];
    return b && b.owner === this.world.playerId ? id : null;
  }

  /** Split the own selection into "can harvest/build" and "the rest" for context commands. */
  private split() {
    const harvesters = this.ownSelected('harvest');
    const builders = this.ownSelected('build');
    const others = this.ownSelected().filter((id) => !harvesters.includes(id));
    return { harvesters, builders, others, all: this.ownSelected() };
  }

  /** Attack-move (fighters) / move (the rest) everything selected to a screen position. */
  attackMoveTo(clientX: number, clientY: number) {
    const g = this.renderer.pickGround(clientX, clientY);
    if (!g) return;
    const fighters = this.ownSelected('attack').filter((id) => !this.ownSelected('harvest').includes(id));
    const rest = this.ownSelected().filter((id) => !fighters.includes(id));
    if (rest.length) this.send({ type: 'move', unitIds: rest, target: g });
    if (fighters.length) this.send({ type: 'attackMove', unitIds: fighters, target: g });
  }

  /** Issue the context-sensitive right-click command at a screen position. */
  commandAt(clientX: number, clientY: number) {
    const st = this.world.state;
    if (!st) return;
    const defs = idx(st.tree);
    const pick = this.renderer.pickEntity(clientX, clientY);

    // Building selected, no units: set its rally point.
    const ownBuilding = this.selectedOwnBuilding();
    if (ownBuilding !== null && !this.ownSelected().length) {
      if (!defs.buildings[st.buildings[ownBuilding].type].trains.length) return;
      const g = this.renderer.pickGround(clientX, clientY);
      if (!g) return;
      const node = pick?.kind === 'node' ? st.nodes[pick.id] : undefined;
      this.send({
        type: 'setRally',
        buildingId: ownBuilding,
        target: node ? { ...hexCentre(node.x, node.y), nodeId: node.id } : g,
      });
      return;
    }

    const { harvesters, builders, others, all } = this.split();
    if (!all.length) return;

    if (pick?.kind === 'node') {
      if (harvesters.length) this.send({ type: 'harvest', unitIds: harvesters, nodeId: pick.id });
      if (others.length) {
        const n = st.nodes[pick.id];
        if (n) this.send({ type: 'move', unitIds: others, target: hexCentre(n.x, n.y) });
      }
      return;
    }
    if (pick?.kind === 'unit' || pick?.kind === 'building') {
      const target = pick.kind === 'unit' ? st.units[pick.id] : this.world.building(pick.id);
      if (target && target.owner !== this.world.playerId) {
        if (pick.kind === 'building' && !st.buildings[pick.id]) {
          // Remembered (fogged) building: go there and fight whatever is around.
          const p = hexCentre(target.x, target.y);
          if (others.length) this.send({ type: 'attackMove', unitIds: others, target: p });
          if (harvesters.length) this.send({ type: 'move', unitIds: harvesters, target: p });
          return;
        }
        this.send({ type: 'attack', unitIds: all, targetId: pick.id, targetKind: pick.kind });
        return;
      }
      if (pick.kind === 'building' && target && 'progress' in target && target.progress < 1 && builders.length) {
        this.send({ type: 'assist', unitIds: builders, buildingId: pick.id });
        const rest = all.filter((id) => !builders.includes(id));
        if (rest.length) this.send({ type: 'move', unitIds: rest, target: hexCentre(target.x, target.y) });
        return;
      }
    }
    const g = this.renderer.pickGround(clientX, clientY);
    if (!g) return;
    if (harvesters.length) this.send({ type: 'move', unitIds: harvesters, target: g });
    if (others.length) this.send({ type: 'attackMove', unitIds: others, target: g });
  }

  moveCameraTo(p: Vec2) {
    this.renderer.camTarget = { x: p.x, y: p.y };
  }

  private centerOnSelection() {
    const st = this.world.state;
    if (!st) return;
    const units = this.world.selectedUnits.map((id) => st.units[id]).filter(Boolean);
    if (!units.length) return;
    const x = units.reduce((s, u) => s + u.x, 0) / units.length;
    const y = units.reduce((s, u) => s + u.y, 0) / units.length;
    this.moveCameraTo({ x, y });
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onDown(e: PointerEvent) {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1) {
      this.panStart = { x: e.clientX, y: e.clientY, cam: { ...this.renderer.camTarget } };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (this.buildMode || this.attackMoveMode) this.cancelMode();
      else this.commandAt(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;

    if (this.buildMode) {
      const tile = this.ghostTile();
      const builders = this.ownSelected('build');
      if (tile && builders.length) {
        this.send({ type: 'build', unitIds: builders, building: this.buildMode, x: tile.x, y: tile.y });
        if (!e.shiftKey) this.cancelMode();
      }
      return;
    }
    if (this.attackMoveMode) {
      this.attackMoveTo(e.clientX, e.clientY);
      this.cancelMode();
      return;
    }
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  }

  private onMove(e: PointerEvent) {
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.panStart) {
      const scale = 0.04 * this.renderer.zoom;
      this.renderer.camTarget = {
        x: this.panStart.cam.x - (e.clientX - this.panStart.x) * scale,
        y: this.panStart.cam.y - (e.clientY - this.panStart.y) * scale,
      };
      return;
    }
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (!this.dragging && Math.hypot(dx, dy) > 5) {
        this.dragging = true;
        this.selbox.hidden = false;
      }
      if (this.dragging) {
        Object.assign(this.selbox.style, {
          left: `${Math.min(e.clientX, this.dragStart.x)}px`,
          top: `${Math.min(e.clientY, this.dragStart.y)}px`,
          width: `${Math.abs(dx)}px`,
          height: `${Math.abs(dy)}px`,
        });
      }
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button === 1) {
      this.panStart = null;
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;
    this.selbox.hidden = true;
    const st = this.world.state;
    if (!st) return;

    if (this.dragging) {
      this.dragging = false;
      const x0 = Math.min(start.x, e.clientX);
      const x1 = Math.max(start.x, e.clientX);
      const y0 = Math.min(start.y, e.clientY);
      const y1 = Math.max(start.y, e.clientY);
      const ids: number[] = [];
      for (const id in st.units) {
        const u = st.units[id];
        if (u.owner !== this.world.playerId) continue;
        const p = this.renderer.project(u.x, u.y, 0.5);
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) ids.push(u.id);
      }
      this.select(e.shiftKey ? [...new Set([...this.world.selectedUnits, ...ids])] : ids, null);
      return;
    }

    const pick = this.renderer.pickEntity(e.clientX, e.clientY);
    if (pick?.kind === 'unit') {
      const u = st.units[pick.id];
      if (e.shiftKey && u.owner === this.world.playerId) {
        const cur = this.world.selectedUnits;
        this.select(cur.includes(u.id) ? cur.filter((i) => i !== u.id) : [...cur, u.id], null);
      } else {
        this.select([u.id], null);
      }
    } else if (pick?.kind === 'building') {
      this.select([], pick.id);
    } else if (pick?.kind === 'node') {
      this.select([], null, pick.id);
    } else {
      this.select([], null);
    }
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    this.keys.add(k);

    if (k === 'tab') {
      e.preventDefault();
      toggleOverlay('tree');
      return;
    }
    if (k === 'f1' || k === '?') {
      e.preventDefault();
      toggleOverlay('keys');
      return;
    }
    if (k === 'escape' && appStore.getState().overlay) {
      appStore.setState({ overlay: null });
      return;
    }

    if (k >= '1' && k <= '9') {
      const n = Number(k);
      if (e.ctrlKey) {
        const ids = this.ownSelected();
        if (ids.length) this.groups.set(n, ids);
        e.preventDefault();
        return;
      }
      const st = this.world.state;
      const ids = (this.groups.get(n) ?? []).filter((id) => st?.units[id]);
      if (!ids.length) return;
      const now = performance.now();
      const doubleTap = this.lastGroupTap.n === n && now - this.lastGroupTap.at < DOUBLE_TAP_MS;
      this.lastGroupTap = { n, at: now };
      this.select(ids, null);
      if (doubleTap) this.centerOnSelection();
      return;
    }

    if (k === 'escape') {
      if (this.buildMode || this.attackMoveMode) this.cancelMode();
      else this.select([], null);
      return;
    }
    if (k === 's') {
      this.stop();
      return;
    }
    if (k === 'a' && !e.ctrlKey) {
      this.enterAttackMoveMode();
      return;
    }
    const st = this.world.state;
    if (st && this.ownSelected('build').length) {
      const building = st.tree.buildings.find((b) => b.buildable && b.hotkey?.toLowerCase() === k);
      if (building) this.enterBuildMode(building.id);
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame: keyboard panning and ghost placement
  // -------------------------------------------------------------------------

  update(dt: number) {
    const r = this.renderer;
    const speed = 22 * r.zoom * dt;
    let dx = 0;
    let dy = 0;
    // Arrow keys pan; W/D/X too ('S' is Stop, 'A' is attack-move).
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('x') || this.keys.has('arrowdown')) dy += speed;
    if (this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += speed;
    if (dx || dy) {
      r.camTarget = {
        x: Math.max(0, Math.min(r.mapW, r.camTarget.x + dx)),
        y: Math.max(0, Math.min(r.mapH, r.camTarget.y + dy)),
      };
    }

    if (this.buildMode && this.world.state) {
      const tile = this.ghostTile();
      if (tile) {
        const st = this.world.state;
        const valid = canPlaceBuilding(st, computeBlocked(st), this.buildMode, tile.x, tile.y);
        r.updateGhost(tile.x, tile.y, valid);
      }
    }
  }
}
