import { canPlaceBuilding, computeBlocked, hexCentre, idx, worldToHex } from '@odal/engine';
import type { Ability, Command, Vec2 } from '@odal/engine';
import { appStore, toggleOverlay } from '../app/store';
import type { Net } from './net';
import type { Renderer } from './render/scene';
import type { World } from './world';

const DOUBLE_TAP_MS = 400;
/** A finger held still this long is the touch equivalent of a right click. */
const LONG_PRESS_MS = 450;
/** Finger travel beyond this is a drag (pan), not a tap. */
const TAP_SLOP_PX = 10;
const ZOOM_MIN = 0.12;
const ZOOM_MAX = 2.2;

interface Touch {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  held: boolean;
  timer: number;
  cam: Vec2;
}

interface Pinch {
  d0: number;
  zoom0: number;
  mid: Vec2;
  cam: Vec2;
}

/**
 * Mouse, keyboard and touch handling on the game canvas: selection, context commands,
 * camera, build placement, attack-move, control groups. Pure TS, no React.
 *
 * Touch: tap selects (and places in build / attack-move mode), a held finger is the
 * right click (command), one-finger drag pans, two fingers pinch to zoom and pan.
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
  private fingers = new Map<number, Vec2>();
  private touch: Touch | null = null;
  private pinch: Pinch | null = null;

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
    on(window, 'pointercancel', (e) => this.onUp(e));
    on(
      c,
      'wheel',
      (e) => {
        this.setZoom(renderer.zoom * (e.deltaY > 0 ? 1.12 : 0.89));
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
    if (this.touch) clearTimeout(this.touch.timer);
  }

  private setZoom(z: number) {
    this.renderer.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  /** Drag the camera: screen pixels since the gesture started, from where the camera was then. */
  private panFrom(cam: Vec2, dx: number, dy: number) {
    const scale = 0.04 * this.renderer.zoom;
    this.renderer.camTarget = { x: cam.x - dx * scale, y: cam.y - dy * scale };
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

  /** Turn the selected own building a sixth of a turn (clockwise; shift for the other way). */
  rotateSelected(back = false) {
    const id = this.selectedOwnBuilding();
    const b = id !== null ? this.world.state?.buildings[id] : undefined;
    if (!b) return;
    this.send({ type: 'rotate', buildingId: b.id, rot: (b.rot + (back ? 5 : 1)) % 6 });
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

  /** Left click / tap while placing a building or aiming attack-move. True if the click was consumed. */
  private modeClick(clientX: number, clientY: number, keepMode: boolean): boolean {
    if (this.buildMode) {
      const tile = this.ghostTile();
      const builders = this.ownSelected('build');
      if (tile && builders.length) {
        this.send({ type: 'build', unitIds: builders, building: this.buildMode, x: tile.x, y: tile.y });
        if (!keepMode) this.cancelMode();
      }
      return true;
    }
    if (this.attackMoveMode) {
      this.attackMoveTo(clientX, clientY);
      this.cancelMode();
      return true;
    }
    return false;
  }

  /** Plain left click / tap: select what is under the pointer (shift toggles own units in and out). */
  private clickSelect(clientX: number, clientY: number, shift: boolean) {
    const st = this.world.state;
    if (!st) return;
    const pick = this.renderer.pickEntity(clientX, clientY);
    if (pick?.kind === 'unit') {
      const u = st.units[pick.id];
      if (shift && u.owner === this.world.playerId) {
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

  // --- touch ---------------------------------------------------------------

  private onTouchDown(e: PointerEvent) {
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.fingers.size === 1) {
      if (this.touch) clearTimeout(this.touch.timer);
      this.touch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        held: false,
        cam: { ...this.renderer.camTarget },
        timer: window.setTimeout(() => this.longPress(), LONG_PRESS_MS),
      };
      return;
    }
    // A second finger: no tap or hold any more, pinch instead.
    if (this.touch) {
      clearTimeout(this.touch.timer);
      this.touch.moved = true;
    }
    const [a, b] = [...this.fingers.values()];
    this.pinch = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom0: this.renderer.zoom,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam: { ...this.renderer.camTarget },
    };
  }

  private longPress() {
    const t = this.touch;
    if (!t || t.moved) return;
    t.held = true;
    navigator.vibrate?.(15);
    if (this.buildMode || this.attackMoveMode) this.cancelMode();
    else this.commandAt(t.x, t.y);
  }

  private onTouchMove(e: PointerEvent) {
    if (!this.fingers.has(e.pointerId)) return;
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.fingers.size >= 2) {
      const [a, b] = [...this.fingers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      this.setZoom(this.pinch.zoom0 * (this.pinch.d0 / d));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.panFrom(this.pinch.cam, mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      return;
    }
    const t = this.touch;
    if (!t || t.id !== e.pointerId || t.held) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (!t.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) {
      t.moved = true;
      clearTimeout(t.timer);
    }
    if (t.moved) this.panFrom(t.cam, dx, dy);
  }

  private onTouchUp(e: PointerEvent) {
    this.fingers.delete(e.pointerId);
    if (this.pinch) {
      if (this.fingers.size < 2) this.pinch = null;
      if (this.fingers.size === 0) this.touch = null;
      return;
    }
    const t = this.touch;
    if (!t || t.id !== e.pointerId) return;
    clearTimeout(t.timer);
    this.touch = null;
    if (t.moved || t.held || e.type === 'pointercancel') return;
    this.mouse = { x: t.x, y: t.y };
    if (!this.modeClick(t.x, t.y, false)) this.clickSelect(t.x, t.y, false);
  }

  // --- mouse ---------------------------------------------------------------

  private onDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse') {
      this.onTouchDown(e);
      return;
    }
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
    if (this.modeClick(e.clientX, e.clientY, e.shiftKey)) return;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') {
      this.onTouchMove(e);
      return;
    }
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.panStart) {
      this.panFrom(this.panStart.cam, e.clientX - this.panStart.x, e.clientY - this.panStart.y);
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
    if (e.pointerType !== 'mouse') {
      this.onTouchUp(e);
      return;
    }
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
    this.clickSelect(e.clientX, e.clientY, e.shiftKey);
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
    if (k === 'h') {
      // Halt. S used to be Stop; it now pans (see update()).
      this.stop();
      return;
    }
    if (k === 'q') {
      this.rotateSelected(e.shiftKey);
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
    // Arrow keys pan, and the S / Z X C cluster (WASD's shape shifted down a row, since A is attack-move).
    if (this.keys.has('s') || this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('x') || this.keys.has('arrowdown')) dy += speed;
    if (this.keys.has('z') || this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('c') || this.keys.has('arrowright')) dx += speed;
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
