import { useEffect, useMemo, useState } from 'react';
import { FILE_SCHEMAS, mergeFiles, refKey, validateTree } from '@odal/engine';
import type { Ref, TechTree } from '@odal/engine';
import type { z } from 'zod';
import { RefDetails } from '../ui/tree/RefDetails';
import { TechTreeGraph } from '../ui/tree/TechTreeGraph';
import { FILE_KIND, FILE_LABEL, LIST_FILES, list, locate, selectedValue, selectionOf } from './ops';
import type { ListFile, Selection } from './ops';
import { SchemaForm } from './SchemaForm';
import type { FormContext } from './SchemaForm';
import { useEditor } from './store';

// ---------------------------------------------------------------------------
// Tech tree editor. Left: what exists. Middle: how it connects. Right: the
// selected thing's numbers and what it takes to reach it. Bottom: what the
// validator objects to. Saves to packages/content/<ruleset>/ via the dev server.
// ---------------------------------------------------------------------------

export function EditorApp() {
  const files = useEditor((s) => s.files);
  const loadError = useEditor((s) => s.loadError);
  const selected = useEditor((s) => s.selected);
  const load = useEditor((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  // Keyboard: Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z undo / redo (outside inputs for undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void st.save();
      }
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inInput) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const validation = useMemo(() => (files ? validateTree(mergeFiles(files)) : null), [files]);
  const [lastTree, setLastTree] = useState<TechTree | null>(null);
  useEffect(() => {
    if (validation?.tree) setLastTree(validation.tree);
  }, [validation]);
  const tree = validation?.tree ?? lastTree;

  if (loadError) {
    return (
      <div className="editor-empty">
        <h1>Odal tech tree editor</h1>
        <p className="error">{loadError}</p>
        <button type="button" className="small" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (!files) return <div className="editor-empty">Loading…</div>;

  const selectedRef: Ref | null =
    selected && selected.file !== 'rules' && FILE_KIND[selected.file]
      ? { kind: FILE_KIND[selected.file]!, id: list(files, selected.file)[selected.index]?.id ?? '' }
      : null;

  return (
    <div className="editor">
      <Toolbar errors={validation?.errors ?? []} />
      <EntityList files={files} selected={selected} />
      <main className="editor-graph">
        {tree ? (
          <TechTreeGraph
            tree={tree}
            selected={selectedRef ? refKey(selectedRef) : null}
            onSelect={(ref) => useEditor.getState().select(ref ? selectionOf(files, ref) : null)}
            editable
            onConnect={(from, to) => useEditor.getState().requestConnect(from, to)}
            onDeleteEdges={(edges) => useEditor.getState().deleteEdges(edges)}
          />
        ) : (
          <div className="editor-empty">Fix the schema errors below to see the graph.</div>
        )}
        {!validation?.tree && lastTree && (
          <div className="graph-stale">Showing the last valid tree; the current data has schema errors.</div>
        )}
        <PendingEdge />
        <div className="graph-help">
          drag from a prerequisite to what it unlocks · click an edge and press Delete to remove it
        </div>
      </main>
      <Inspector files={files} selected={selected} tree={tree} selectedRef={selectedRef} />
      <Problems files={files} errors={validation?.errors ?? []} />
    </div>
  );
}

function Toolbar({ errors }: { errors: string[] }) {
  const { dir, dirty, saving, saveErrors, savedAt, past, future } = useEditor();
  const save = useEditor((s) => s.save);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  return (
    <header className="editor-toolbar">
      <h1>Odal tech tree editor</h1>
      <span className="muted" title={dir}>
        {dir.replace(/\\/g, '/').split('/').slice(-3).join('/')}
      </span>
      <span className="spacer" />
      {errors.length > 0 ? (
        <span className="error">
          {errors.length} problem{errors.length === 1 ? '' : 's'}
        </span>
      ) : (
        <span className="ok">valid</span>
      )}
      <button type="button" className="small" onClick={undo} disabled={!past.length} title="Ctrl+Z">
        Undo
      </button>
      <button type="button" className="small" onClick={redo} disabled={!future.length} title="Ctrl+Shift+Z">
        Redo
      </button>
      <button
        type="button"
        className={`small primary${dirty ? ' dirty' : ''}`}
        onClick={() => void save()}
        disabled={saving || !dirty || errors.length > 0}
        title={errors.length ? 'Fix the problems first; an invalid ruleset would break the server' : 'Ctrl+S'}
      >
        {saving ? 'Saving…' : dirty ? 'Save' : savedAt ? 'Saved' : 'Save'}
      </button>
      {saveErrors && <span className="error">{saveErrors[0]}</span>}
    </header>
  );
}

function EntityList({
  files,
  selected,
}: {
  files: NonNullable<ReturnType<typeof useEditor.getState>['files']>;
  selected: Selection | null;
}) {
  const select = useEditor((s) => s.select);
  const add = useEditor((s) => s.add);
  return (
    <aside className="editor-list">
      <button
        type="button"
        className={`list-row rules${selected?.file === 'rules' ? ' is-selected' : ''}`}
        onClick={() => select({ file: 'rules', index: 0 })}
      >
        Rules &amp; start
      </button>
      {LIST_FILES.map((file) => (
        <section key={file}>
          <h3>
            {FILE_LABEL[file]}
            <button type="button" className="icon" title={`Add ${file.replace(/s$/, '')}`} onClick={() => add(file)}>
              +
            </button>
          </h3>
          {list(files, file).map((e, index) => (
            <button
              key={`${e.id}-${index}`}
              type="button"
              className={`list-row kind-${file}${selected?.file === file && selected.index === index ? ' is-selected' : ''}`}
              onClick={() => select({ file, index })}
            >
              <span>{typeof e.name === 'string' && e.name ? e.name : e.id}</span>
              <small>{e.id}</small>
            </button>
          ))}
        </section>
      ))}
    </aside>
  );
}

function Inspector({
  files,
  selected,
  tree,
  selectedRef,
}: {
  files: NonNullable<ReturnType<typeof useEditor.getState>['files']>;
  selected: Selection | null;
  tree: TechTree | null;
  selectedRef: Ref | null;
}) {
  const setField = useEditor((s) => s.setField);
  const rename = useEditor((s) => s.rename);
  const duplicate = useEditor((s) => s.duplicate);
  const remove = useEditor((s) => s.remove);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ids = useMemo(() => {
    const pick = (file: ListFile) =>
      list(files, file).map((e) => ({ id: e.id, name: typeof e.name === 'string' ? e.name : e.id }));
    return {
      resources: pick('resources'),
      terrain: pick('terrain'),
      nodes: pick('nodes'),
      units: pick('units'),
      buildings: pick('buildings'),
      techs: pick('techs'),
    };
  }, [files]);

  if (!selected) {
    return (
      <aside className="editor-inspector">
        <p className="muted">Select something in the list or the graph. Drag between nodes to connect them.</p>
        <p className="muted">
          Solid edges are trains / researches, dashed edges are requirements. Population requirements are gates, not
          edges; set them in the form.
        </p>
      </aside>
    );
  }

  const value = selectedValue(files, selected) as Record<string, unknown> | undefined;
  if (!value) return <aside className="editor-inspector" />;
  const schema = FILE_SCHEMAS[selected.file] as unknown as z.ZodObject<z.ZodRawShape>;
  const ctx: FormContext = {
    ids,
    onChange: setField,
    onRename: selected.file === 'rules' ? undefined : rename,
  };
  const title = selected.file === 'rules' ? 'Rules & start' : String(value.name ?? value.id);
  const refInTree =
    selectedRef &&
    tree &&
    tree[
      FILE_KIND[selected.file as ListFile] === 'unit' ? 'units' : selected.file === 'buildings' ? 'buildings' : 'techs'
    ].some((x) => x.id === selectedRef.id);

  return (
    <aside className="editor-inspector">
      <div className="inspector-head">
        <h2>{title}</h2>
        {selected.file !== 'rules' && (
          <span className="inspector-actions">
            <button type="button" className="small" onClick={duplicate}>
              Duplicate
            </button>
            {confirmDelete ? (
              <button
                type="button"
                className="small danger"
                onClick={() => {
                  remove();
                  setConfirmDelete(false);
                }}
                onBlur={() => setConfirmDelete(false)}
              >
                Really delete
              </button>
            ) : (
              <button type="button" className="small" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </span>
        )}
      </div>
      {selectedRef && tree && refInTree && (
        <details open className="inspector-facts">
          <summary>Facts (from the current tree)</summary>
          <RefDetails tree={tree} ref={selectedRef} />
        </details>
      )}
      <SchemaForm schema={schema} value={value} ctx={ctx} />
    </aside>
  );
}

function PendingEdge() {
  const pending = useEditor((s) => s.pendingEdge);
  const resolve = useEditor((s) => s.resolveConnect);
  if (!pending) return null;
  const label = (how: string) =>
    how === 'requires'
      ? `${pending.to.id} requires ${pending.from.id}`
      : how === 'trains'
        ? `${pending.from.id} trains ${pending.to.id}`
        : `${pending.from.id} researches ${pending.to.id}`;
  return (
    <div className="pending-edge">
      <span>What does this edge mean?</span>
      {pending.options.map((how) => (
        <button key={how} type="button" className="small primary" onClick={() => resolve(how)}>
          {label(how)}
        </button>
      ))}
      <button type="button" className="small" onClick={() => resolve(null)}>
        Cancel
      </button>
    </div>
  );
}

function Problems({
  files,
  errors,
}: {
  files: NonNullable<ReturnType<typeof useEditor.getState>['files']>;
  errors: string[];
}) {
  const select = useEditor((s) => s.select);
  return (
    <footer className={`editor-problems${errors.length ? '' : ' ok'}`}>
      {errors.length === 0 ? (
        <span className="ok">No problems. The ruleset validates.</span>
      ) : (
        errors.map((e, i) => {
          const where = locate(files, e);
          return (
            <button key={i} type="button" className="problem" disabled={!where} onClick={() => where && select(where)}>
              {e}
            </button>
          );
        })
      )}
    </footer>
  );
}
