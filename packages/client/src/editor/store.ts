import { create } from 'zustand';
import type { GraphEdge, Ref } from '@odal/engine';
import {
  addEntity,
  connect,
  connectOptions,
  disconnect,
  duplicateEntity,
  list,
  removeEntity,
  renameId,
  template,
  updateSelected,
} from './ops';
import type { EdgeHow, Files, ListFile, Path, Selection } from './ops';

// ---------------------------------------------------------------------------
// Editor state: the six raw files, the selection, undo history and the talk
// with the dev server (/dev/tree). Validation is derived in components from
// `files` so it is always in sync with what is shown.
// ---------------------------------------------------------------------------

const COALESCE_MS = 700;

export interface EditorState {
  dir: string;
  files: Files | null;
  loadError: string | null;
  selected: Selection | null;
  dirty: boolean;
  past: Files[];
  future: Files[];
  saving: boolean;
  saveErrors: string[] | null;
  savedAt: number | null;
  pendingEdge: { from: Ref; to: Ref; options: EdgeHow[] } | null;

  load(): Promise<void>;
  save(): Promise<void>;
  select(sel: Selection | null): void;
  /** Replace the files, recording history. Consecutive edits with the same `coalesce` key within a short time merge into one undo step. */
  apply(fn: (files: Files) => Files, coalesce?: string): void;
  undo(): void;
  redo(): void;

  setField(path: Path, value: unknown): void;
  rename(newId: string): void;
  add(file: ListFile): void;
  duplicate(): void;
  remove(): void;
  requestConnect(from: Ref, to: Ref): void;
  resolveConnect(how: EdgeHow | null): void;
  deleteEdges(edges: GraphEdge[]): void;
}

let lastEdit = { key: '', at: 0 };

export const useEditor = create<EditorState>((set, get) => ({
  dir: '',
  files: null,
  loadError: null,
  selected: null,
  dirty: false,
  past: [],
  future: [],
  saving: false,
  saveErrors: null,
  savedAt: null,
  pendingEdge: null,

  async load() {
    try {
      const res = await fetch('/dev/tree');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      if (!res.headers.get('content-type')?.includes('application/json')) {
        // The production server has no /dev/tree route and answers with the game's index.html.
        throw new Error('the server is not running in editor mode');
      }
      const body = (await res.json()) as { dir: string; files: Files };
      set({ dir: body.dir, files: body.files, loadError: null, dirty: false, past: [], future: [], saveErrors: null });
    } catch (e) {
      set({
        loadError:
          `Could not load the ruleset (${(e as Error).message}). The editor needs the server started with ` +
          'ODAL_DEV=1: `bun run dev:server` (with `bun run dev:client` for this page) or `bun run start:editor` ' +
          '(built client). Then reload.',
      });
    }
  },

  async save() {
    const { files } = get();
    if (!files) return;
    set({ saving: true, saveErrors: null });
    try {
      const res = await fetch('/dev/tree', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const body = (await res.json()) as { ok: boolean; errors?: string[] };
      if (!res.ok || !body.ok) {
        set({ saving: false, saveErrors: body.errors ?? [`${res.status} ${res.statusText}`] });
        return;
      }
      set({ saving: false, dirty: false, savedAt: Date.now() });
    } catch (e) {
      set({ saving: false, saveErrors: [(e as Error).message] });
    }
  },

  select(selected) {
    set({ selected, pendingEdge: null });
  },

  apply(fn, coalesce) {
    const { files, past } = get();
    if (!files) return;
    const next = fn(files);
    if (next === files) return;
    const now = Date.now();
    const merge = !!coalesce && lastEdit.key === coalesce && now - lastEdit.at < COALESCE_MS;
    lastEdit = { key: coalesce ?? '', at: now };
    set({ files: next, dirty: true, past: merge ? past : [...past, files].slice(-200), future: [] });
  },

  undo() {
    const { files, past, future } = get();
    if (!files || !past.length) return;
    lastEdit = { key: '', at: 0 };
    set({ files: past[past.length - 1], past: past.slice(0, -1), future: [files, ...future], dirty: true });
  },

  redo() {
    const { files, past, future } = get();
    if (!files || !future.length) return;
    lastEdit = { key: '', at: 0 };
    set({ files: future[0], future: future.slice(1), past: [...past, files], dirty: true });
  },

  setField(path, value) {
    const { selected } = get();
    if (!selected) return;
    get().apply(
      (f) => updateSelected(f, selected, path, value),
      `${selected.file}:${selected.index}:${path.join('.')}`,
    );
  },

  rename(newId) {
    const { selected, files } = get();
    if (!selected || selected.file === 'rules' || !files) return;
    const oldId = list(files, selected.file)[selected.index]?.id;
    if (!oldId || oldId === newId) return;
    get().apply((f) => renameId(f, selected.file as ListFile, oldId, newId));
  },

  add(file) {
    get().apply((f) => {
      const r = addEntity(f, file, template(f, file));
      set({ selected: { file, index: r.index } });
      return r.files;
    });
  },

  duplicate() {
    const { selected } = get();
    if (!selected || selected.file === 'rules') return;
    get().apply((f) => {
      const r = duplicateEntity(f, selected);
      set({ selected: { file: selected.file, index: r.index } });
      return r.files;
    });
  },

  remove() {
    const { selected } = get();
    if (!selected || selected.file === 'rules') return;
    get().apply((f) => {
      set({ selected: null });
      return removeEntity(f, selected);
    });
  },

  requestConnect(from, to) {
    const { files } = get();
    if (!files) return;
    const options = connectOptions(from, to);
    if (!options.length) {
      set({ saveErrors: null, pendingEdge: null });
      return;
    }
    if (options.length === 1) {
      get().apply((f) => connect(f, from, to, options[0]));
      return;
    }
    set({ pendingEdge: { from, to, options } });
  },

  resolveConnect(how) {
    const { pendingEdge } = get();
    set({ pendingEdge: null });
    if (!pendingEdge || !how) return;
    get().apply((f) => connect(f, pendingEdge.from, pendingEdge.to, how));
  },

  deleteEdges(edges) {
    get().apply((f) => edges.reduce((acc, e) => disconnect(acc, e), f));
  },
}));
