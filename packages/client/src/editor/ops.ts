import { RULESET_FILES } from '@odal/engine';
import type { GraphEdge, Ref, RulesetFile, RulesetFiles } from '@odal/engine';

// ---------------------------------------------------------------------------
// Pure edits on the six raw ruleset files. The editor store applies these and
// keeps history; nothing here knows about React or the network. Files are
// the authored JSON (defaults not applied), so what gets saved is what the
// author sees.
// ---------------------------------------------------------------------------

export type ListFile = Exclude<RulesetFile, 'rules'>;
export const LIST_FILES: ListFile[] = ['resources', 'nodes', 'units', 'buildings', 'techs'];
export const FILE_LABEL: Record<RulesetFile, string> = {
  rules: 'Rules',
  resources: 'Resources',
  nodes: 'Nodes',
  units: 'Units',
  buildings: 'Buildings',
  techs: 'Techs',
};

export type Entity = { id: string } & Record<string, unknown>;
export type Files = RulesetFiles;
export type Path = (string | number)[];

export interface Selection {
  file: RulesetFile;
  index: number; // ignored for `rules`
}
export interface ListSelection extends Selection {
  file: ListFile;
}

export const KIND_FILE: Record<Ref['kind'], ListFile> = { unit: 'units', building: 'buildings', tech: 'techs' };
export const FILE_KIND: Partial<Record<ListFile, Ref['kind']>> = {
  units: 'unit',
  buildings: 'building',
  techs: 'tech',
};

export function list(files: Files, file: ListFile): Entity[] {
  const v = files[file];
  return Array.isArray(v) ? (v as Entity[]) : [];
}

export function selectedValue(files: Files, sel: Selection): unknown {
  return sel.file === 'rules' ? files.rules : list(files, sel.file)[sel.index];
}

export function selectionOf(files: Files, ref: Ref): ListSelection | null {
  const file = KIND_FILE[ref.kind];
  const index = list(files, file).findIndex((e) => e.id === ref.id);
  return index >= 0 ? { file, index } : null;
}

/** Immutable deep set. `undefined` deletes the key (or splices the array element). */
export function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const i = Number(head);
    const copy = root.slice();
    if (!rest.length && value === undefined) {
      copy.splice(i, 1);
      return copy;
    }
    copy[i] = setAt(root[i], rest, value);
    return copy;
  }
  const obj = { ...((root as Record<string, unknown>) ?? {}) };
  const key = String(head);
  if (!rest.length && value === undefined) {
    delete obj[key];
    return obj;
  }
  obj[key] = setAt(obj[key], rest, value);
  return obj;
}

export function updateSelected(files: Files, sel: Selection, path: Path, value: unknown): Files {
  const full: Path = sel.file === 'rules' ? [sel.file, ...path] : [sel.file, sel.index, ...path];
  return setAt(files, full, value) as Files;
}

export function uniqueId(files: Files, file: ListFile, base: string): string {
  const taken = new Set(list(files, file).map((e) => e.id));
  const clean =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^[^a-z]+/, '') || 'new';
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n++) if (!taken.has(`${clean}_${n}`)) return `${clean}_${n}`;
}

/** A minimal, schema-valid new entity so the tree stays parseable while the author fills it in. */
export function template(files: Files, file: ListFile): Entity {
  const id = uniqueId(files, file, `new_${file.replace(/s$/, '')}`);
  const firstResource = list(files, 'resources')[0]?.id ?? '';
  switch (file) {
    case 'resources':
      return { id, name: 'New resource', icon: '' };
    case 'nodes':
      return {
        id,
        name: 'New node',
        resource: firstResource,
        amount: 100,
        gatherTime: 5,
        gatherAmount: 10,
        spawn: { kind: 'deposit', depositsPer1000Tiles: 1, size: [3, 5] },
        visual: { shape: 'rock', color: '#888888' },
      };
    case 'units':
      return { id, name: 'New unit', time: 10, hp: 30, speed: 2.5, abilities: ['attack'], visual: {} };
    case 'buildings':
      return {
        id,
        name: 'New building',
        time: 20,
        hp: 100,
        visual: { color: '#8d6e63', height: 1 },
      };
    case 'techs':
      return { id, name: 'New tech', time: 15 };
  }
}

export function addEntity(files: Files, file: ListFile, entity: Entity): { files: Files; index: number } {
  const next = [...list(files, file), entity];
  return { files: { ...files, [file]: next }, index: next.length - 1 };
}

export function duplicateEntity(files: Files, sel: Selection): { files: Files; index: number } {
  if (sel.file === 'rules') return { files, index: 0 };
  const src = list(files, sel.file)[sel.index];
  const copy = structuredClone(src);
  copy.id = uniqueId(files, sel.file, `${src.id}_copy`);
  if (typeof copy.name === 'string') copy.name = `${copy.name} copy`;
  if (sel.file === 'buildings') delete copy.hotkey; // hotkeys must be unique
  return addEntity(files, sel.file, copy);
}

export function removeEntity(files: Files, sel: Selection): Files {
  if (sel.file === 'rules') return files;
  return { ...files, [sel.file]: list(files, sel.file).filter((_, i) => i !== sel.index) };
}

// ---------------------------------------------------------------------------
// Renaming an id updates every reference to it across the six files.
// ---------------------------------------------------------------------------

export function renameId(files: Files, file: ListFile, oldId: string, newId: string): Files {
  if (oldId === newId) return files;
  const kind = FILE_KIND[file]; // undefined for resources and nodes
  const renameKey = (rec: unknown): unknown => {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return rec;
    const r = rec as Record<string, unknown>;
    if (!(oldId in r)) return r;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(r)) out[k === oldId ? newId : k] = r[k];
    return out;
  };
  const sub = (v: unknown): unknown => (v === oldId ? newId : v);

  const walk = (value: unknown, key: string | number | null, parentKey: string | number | null): unknown => {
    if (Array.isArray(value)) {
      // id lists on buildings
      if (key === 'trains' && file === 'units') return value.map(sub);
      if (key === 'researches' && file === 'techs') return value.map(sub);
      return value.map((v, i) => walk(v, i, key));
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // requirement entries
      if (kind && obj.type === kind && typeof obj.id === 'string' && parentKey === 'requires') {
        return { ...obj, id: sub(obj.id) };
      }
      let out: Record<string, unknown> = {};
      for (const k of Object.keys(obj)) out[k] = walk(obj[k], k, key);
      if (file === 'resources' && (key === 'cost' || key === 'upkeep' || key === 'startResources'))
        out = renameKey(out) as Record<string, unknown>;
      return out;
    }
    if (typeof value === 'string') {
      if (file === 'resources' && key === 'resource') return sub(value);
      if (file === 'units' && (key === 'unit' || (key === 'type' && parentKey !== 'requires' && parentKey !== null)))
        return sub(value);
      if (file === 'buildings' && key === 'building') return sub(value);
      if (file === 'techs' && key === 'tech') return sub(value);
    }
    return value;
  };

  const out: Files = { ...files };
  for (const f of RULESET_FILES) out[f] = walk(files[f], null, null);
  // The entity's own id, last, so the walk above doesn't need to special-case it.
  const idx = list(out, file).findIndex((e) => e.id === oldId);
  if (idx >= 0) out[file] = setAt(out[file], [idx, 'id'], newId);
  // start.units[].type is a unit reference handled by the `type` rule; effects on techs use `unit`/`building`.
  return out;
}

// ---------------------------------------------------------------------------
// Graph edits: an edge is a requirement or a trains/researches entry.
// ---------------------------------------------------------------------------

export type EdgeHow = 'requires' | 'trains' | 'researches';

/** Which relations a drag from `from` to `to` could mean. Empty = not allowed. */
export function connectOptions(from: Ref, to: Ref): EdgeHow[] {
  if (from.kind === 'unit') return [];
  if (from.kind === 'tech') return ['requires'];
  if (to.kind === 'unit') return ['trains', 'requires'];
  if (to.kind === 'tech') return ['researches', 'requires'];
  return ['requires'];
}

export function connect(files: Files, from: Ref, to: Ref, how: EdgeHow): Files {
  if (how === 'requires') {
    const sel = selectionOf(files, to);
    if (!sel) return files;
    const target = list(files, sel.file)[sel.index];
    const requires = Array.isArray(target.requires) ? (target.requires as Record<string, unknown>[]) : [];
    if (requires.some((r) => r.type === from.kind && r.id === from.id)) return files;
    return updateSelected(files, sel, ['requires'], [...requires, { type: from.kind, id: from.id }]);
  }
  const sel = selectionOf(files, from);
  if (!sel) return files;
  const b = list(files, sel.file)[sel.index];
  const cur = Array.isArray(b[how]) ? (b[how] as string[]) : [];
  if (cur.includes(to.id)) return files;
  return updateSelected(files, sel, [how], [...cur, to.id]);
}

export function disconnect(files: Files, edge: GraphEdge): Files {
  if (edge.reason === 'requires') {
    const sel = selectionOf(files, edge.to);
    if (!sel) return files;
    const target = list(files, sel.file)[sel.index];
    const requires = Array.isArray(target.requires) ? (target.requires as Record<string, unknown>[]) : [];
    const next = requires.filter((r) => !(r.type === edge.from.kind && r.id === edge.from.id));
    return updateSelected(files, sel, ['requires'], next.length ? next : undefined);
  }
  const sel = selectionOf(files, edge.from);
  if (!sel) return files;
  const b = list(files, sel.file)[sel.index];
  const cur = Array.isArray(b[edge.reason]) ? (b[edge.reason] as string[]) : [];
  const next = cur.filter((id) => id !== edge.to.id);
  return updateSelected(files, sel, [edge.reason], next.length ? next : undefined);
}

// ---------------------------------------------------------------------------
// Problems → where to click. Validator messages start with a path or a ref.
// ---------------------------------------------------------------------------

export function locate(files: Files, error: string): Selection | null {
  const m = /^(resources|nodes|units|buildings|techs)\.([a-z0-9_]+)/.exec(error);
  if (m) {
    const file = m[1] as ListFile;
    const items = list(files, file);
    const index = /^\d+$/.test(m[2]) ? Number(m[2]) : items.findIndex((e) => e.id === m[2]);
    return index >= 0 && index < items.length ? { file, index } : null;
  }
  const r = /^(unit|building|tech):([a-z0-9_]+)/.exec(error);
  if (r) return selectionOf(files, { kind: r[1] as Ref['kind'], id: r[2] });
  if (/^(rules|start)\b/.test(error)) return { file: 'rules', index: 0 };
  return null;
}
