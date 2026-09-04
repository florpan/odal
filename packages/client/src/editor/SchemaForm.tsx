import { useState } from 'react';
import { z } from 'zod';
import type { Path } from './ops';

// ---------------------------------------------------------------------------
// A form generated from a zod schema. Walks the schema and renders an input
// per field, so a new field in engine/src/tree.ts shows up here without any
// editor work. Id-typed fields become pickers when the field name says which
// kind of thing it refers to (see idKind); everything else is generic.
// ---------------------------------------------------------------------------

export type IdKind = 'resources' | 'nodes' | 'units' | 'buildings' | 'techs';

export interface FormContext {
  /** Known ids per file, for pickers. */
  ids: Record<IdKind, { id: string; name: string }[]>;
  onChange: (path: Path, value: unknown) => void;
  /** The entity's own `id` is renamed through this (updates references). Absent for the rules file. */
  onRename?: (newId: string) => void;
}

interface Unwrapped {
  schema: z.ZodTypeAny;
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let s = schema;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;
  for (;;) {
    if (s instanceof z.ZodDefault) {
      hasDefault = true;
      defaultValue = s._def.defaultValue();
      s = s._def.innerType;
    } else if (s instanceof z.ZodOptional) {
      optional = true;
      s = s._def.innerType;
    } else if (s instanceof z.ZodEffects) {
      s = s._def.schema;
    } else break;
  }
  return { schema: s, optional, hasDefault, defaultValue };
}

function isColor(s: z.ZodTypeAny): boolean {
  return s instanceof z.ZodString && s._def.checks.some((c) => c.kind === 'regex' && c.regex.source.includes('#'));
}

/** Which id list a string field refers to, from its position in the entity. */
function idKind(path: Path, siblings?: Record<string, unknown>): IdKind | null {
  const key = path[path.length - 1];
  const parent = path[path.length - 2];
  if (typeof key === 'number') {
    if (parent === 'trains') return 'units';
    if (parent === 'researches') return 'techs';
    return null;
  }
  if (path.length === 1 && key === 'id') return null; // the entity's own id
  if (key === 'id' && siblings?.type === 'tech') return 'techs';
  if (key === 'id' && siblings?.type === 'building') return 'buildings';
  if (key === 'resource') return 'resources';
  if (key === 'unit') return 'units';
  if (key === 'building') return 'buildings';
  if (key === 'tech') return 'techs';
  if (key === 'type' && typeof parent === 'number' && path[path.length - 3] === 'units') return 'units';
  return null;
}

/** A minimal valid value for a schema, used when adding list items or enabling optional blocks. */
export function emptyValue(schema: z.ZodTypeAny, ctx: FormContext, path: Path): unknown {
  const u = unwrap(schema);
  if (u.hasDefault) return u.defaultValue;
  const s = u.schema;
  if (s instanceof z.ZodString) {
    const kind = idKind(path);
    if (kind) return ctx.ids[kind][0]?.id ?? '';
    return isColor(s) ? '#888888' : '';
  }
  if (s instanceof z.ZodNumber) return s.minValue !== null && s.minValue > 1 ? s.minValue : 1;
  if (s instanceof z.ZodBoolean) return false;
  if (s instanceof z.ZodEnum) return s.options[0];
  if (s instanceof z.ZodLiteral) return s.value;
  if (s instanceof z.ZodArray) return [];
  if (s instanceof z.ZodRecord) return {};
  if (s instanceof z.ZodTuple) return (s.items as z.ZodTypeAny[]).map((it, i) => emptyValue(it, ctx, [...path, i]));
  if (s instanceof z.ZodDiscriminatedUnion) return emptyValue(s.options[0] as z.ZodTypeAny, ctx, path);
  if (s instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(s.shape as Record<string, z.ZodTypeAny>)) {
      const cu = unwrap(child);
      if (cu.optional && !cu.hasDefault) continue;
      out[k] = emptyValue(child, ctx, [...path, k]);
    }
    return out;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

export interface SchemaFormProps {
  schema: z.ZodObject<z.ZodRawShape>;
  value: Record<string, unknown>;
  ctx: FormContext;
}

export function SchemaForm({ schema, value, ctx }: SchemaFormProps) {
  return (
    <div className="schema-form">
      {Object.entries(schema.shape).map(([key, child]) => (
        <Field key={key} schema={child} value={value[key]} path={[key]} siblings={value} ctx={ctx} />
      ))}
    </div>
  );
}

interface FieldProps {
  schema: z.ZodTypeAny;
  value: unknown;
  path: Path;
  siblings?: Record<string, unknown>;
  ctx: FormContext;
  /** Render without the label row (used inside lists). */
  bare?: boolean;
}

function Field({ schema, value, path, siblings, ctx, bare }: FieldProps) {
  const u = unwrap(schema);
  const s = u.schema;
  const key = path[path.length - 1];
  const label = typeof key === 'number' ? '' : String(key);
  const set = (v: unknown) => ctx.onChange(path, v);
  const hint = u.hasDefault ? `default ${JSON.stringify(u.defaultValue)}` : u.optional ? 'optional' : '';

  // The entity's own id: commit on blur so references are renamed once, not per keystroke.
  if (path.length === 1 && key === 'id' && ctx.onRename) {
    return (
      <Row label="id" hint="renames every reference">
        <IdInput value={String(value ?? '')} onCommit={ctx.onRename} />
      </Row>
    );
  }

  if (s instanceof z.ZodLiteral) {
    return (
      <Row label={label} hint={hint}>
        <input value={String(s.value)} readOnly />
      </Row>
    );
  }

  if (s instanceof z.ZodBoolean) {
    return (
      <Row label={label} hint={hint}>
        <input
          type="checkbox"
          checked={!!(value ?? u.defaultValue ?? false)}
          onChange={(e) => set(u.hasDefault && e.target.checked === u.defaultValue ? undefined : e.target.checked)}
        />
      </Row>
    );
  }

  if (s instanceof z.ZodNumber) {
    const input = (
      <input
        type="number"
        step={s.isInt ? 1 : 'any'}
        min={s.minValue ?? undefined}
        max={s.maxValue ?? undefined}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={u.hasDefault ? String(u.defaultValue) : ''}
        onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
    return bare ? (
      input
    ) : (
      <Row label={label} hint={hint}>
        {input}
      </Row>
    );
  }

  if (s instanceof z.ZodEnum) {
    return (
      <Row label={label} hint={hint}>
        <select value={String(value ?? u.defaultValue ?? '')} onChange={(e) => set(e.target.value)}>
          {(u.optional || u.hasDefault) && <option value="">{u.hasDefault ? `(${u.defaultValue})` : '(none)'}</option>}
          {s.options.map((o: string) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Row>
    );
  }

  if (s instanceof z.ZodString) {
    const kind = idKind(path, siblings);
    let input: React.ReactNode;
    if (kind) {
      const ids = ctx.ids[kind];
      input = (
        <select value={String(value ?? '')} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}>
          {u.optional && <option value="">(any)</option>}
          {!u.optional && !ids.some((x) => x.id === value) && (
            <option value={String(value ?? '')}>{String(value ?? '—')}</option>
          )}
          {ids.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.id})
            </option>
          ))}
        </select>
      );
    } else if (isColor(s)) {
      const v = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
      input = (
        <span className="color-field">
          <input type="color" value={v} onChange={(e) => set(e.target.value)} />
          <input
            value={String(value ?? '')}
            placeholder={u.optional ? 'none' : '#rrggbb'}
            onChange={(e) => set(e.target.value === '' && u.optional ? undefined : e.target.value)}
          />
        </span>
      );
    } else {
      const long = key === 'desc' || key === 'notes';
      input = long ? (
        <textarea
          rows={key === 'notes' ? 3 : 2}
          value={String(value ?? '')}
          onChange={(e) => set(e.target.value || undefined)}
        />
      ) : (
        <input
          value={String(value ?? '')}
          onChange={(e) => set(e.target.value === '' && (u.optional || u.hasDefault) ? undefined : e.target.value)}
        />
      );
    }
    return bare ? (
      input
    ) : (
      <Row label={label} hint={hint}>
        {input}
      </Row>
    );
  }

  if (s instanceof z.ZodTuple) {
    const items = s.items as z.ZodTypeAny[];
    const arr = Array.isArray(value) ? (value as unknown[]) : items.map(() => undefined);
    return (
      <Row label={label} hint={hint}>
        <span className="inline-fields">
          {items.map((it, i) => (
            <Field
              key={i}
              schema={it}
              value={arr[i]}
              path={[...path, i]}
              ctx={{ ...ctx, onChange: (_p, v) => set(arr.map((x, j) => (j === i ? v : x))) }}
              bare
            />
          ))}
        </span>
      </Row>
    );
  }

  if (s instanceof z.ZodRecord) {
    // Resource amounts: cost, upkeep, startResources.
    const rec = (value as Record<string, number> | undefined) ?? {};
    return (
      <Row label={label} hint={hint} block>
        <div className="record-field">
          {ctx.ids.resources.map((r) => (
            <label key={r.id}>
              <span>{r.name}</span>
              <input
                type="number"
                min={0}
                step="any"
                value={rec[r.id] ?? ''}
                onChange={(e) => {
                  const next = { ...rec };
                  if (e.target.value === '') delete next[r.id];
                  else next[r.id] = Number(e.target.value);
                  set(Object.keys(next).length ? next : u.hasDefault ? undefined : {});
                }}
              />
            </label>
          ))}
        </div>
      </Row>
    );
  }

  if (s instanceof z.ZodArray) {
    const el = unwrap(s.element as z.ZodTypeAny);
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    const commit = (next: unknown[]) => set(next.length || !u.hasDefault ? next : undefined);

    if (el.schema instanceof z.ZodEnum) {
      return (
        <Row label={label} hint={hint}>
          <span className="check-group">
            {el.schema.options.map((o: string) => (
              <label key={o}>
                <input
                  type="checkbox"
                  checked={arr.includes(o)}
                  onChange={(e) => commit(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
                />
                {o}
              </label>
            ))}
          </span>
        </Row>
      );
    }

    const kind = idKind([...path, 0]);
    if (el.schema instanceof z.ZodString && kind) {
      const ids = ctx.ids[kind];
      const free = ids.filter((x) => !arr.includes(x.id));
      return (
        <Row label={label} hint={hint} block>
          <div className="chips">
            {arr.map((id, i) => (
              <span key={i} className={`chip${ids.some((x) => x.id === id) ? '' : ' bad'}`}>
                {String(id)}
                <button type="button" onClick={() => commit(arr.filter((_, j) => j !== i))} title="Remove">
                  ×
                </button>
              </span>
            ))}
            {free.length > 0 && (
              <select value="" onChange={(e) => e.target.value && commit([...arr, e.target.value])}>
                <option value="">+ add…</option>
                {free.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.id})
                  </option>
                ))}
              </select>
            )}
          </div>
        </Row>
      );
    }

    return (
      <Row label={label} hint={hint} block>
        <div className="list-field">
          {arr.map((item, i) => (
            <div key={i} className="list-item">
              <Field
                schema={s.element as z.ZodTypeAny}
                value={item}
                path={[...path, i]}
                ctx={{ ...ctx, onChange: (p, v) => ctx.onChange(p, v) }}
                bare
              />
              <button
                type="button"
                className="icon"
                onClick={() => commit(arr.filter((_, j) => j !== i))}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() => commit([...arr, emptyValue(s.element as z.ZodTypeAny, ctx, [...path, arr.length])])}
          >
            + add
          </button>
        </div>
      </Row>
    );
  }

  if (s instanceof z.ZodDiscriminatedUnion) {
    const disc = s.discriminator as string;
    const options = s.options as z.ZodObject<z.ZodRawShape>[];
    const obj = (value as Record<string, unknown> | undefined) ?? {};
    const current = options.find((o) => (o.shape[disc] as z.ZodLiteral<string>).value === obj[disc]) ?? options[0];
    const body = (
      <div className="union-field">
        <select
          value={String(obj[disc] ?? '')}
          onChange={(e) => {
            const next = options.find((o) => (o.shape[disc] as z.ZodLiteral<string>).value === e.target.value)!;
            set(emptyValue(next, ctx, path));
          }}
        >
          {options.map((o) => {
            const v = (o.shape[disc] as z.ZodLiteral<string>).value;
            return (
              <option key={v} value={v}>
                {v}
              </option>
            );
          })}
        </select>
        {Object.entries(current.shape)
          .filter(([k]) => k !== disc)
          .map(([k, child]) => (
            <Field key={k} schema={child} value={obj[k]} path={[...path, k]} siblings={obj} ctx={ctx} />
          ))}
      </div>
    );
    return bare ? (
      body
    ) : (
      <Row label={label} hint={hint} block>
        {body}
      </Row>
    );
  }

  if (s instanceof z.ZodObject) {
    const obj = value as Record<string, unknown> | undefined;
    const enabled = obj !== undefined;
    return (
      <fieldset className="object-field">
        <legend>
          {label}
          {u.optional && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => set(e.target.checked ? emptyValue(s, ctx, path) : undefined)}
              />
              {enabled ? 'on' : 'off'}
            </label>
          )}
        </legend>
        {(enabled || !u.optional) &&
          Object.entries(s.shape as Record<string, z.ZodTypeAny>).map(([k, child]) => (
            <Field key={k} schema={child} value={obj?.[k]} path={[...path, k]} siblings={obj} ctx={ctx} />
          ))}
      </fieldset>
    );
  }

  return (
    <Row label={label} hint="unsupported schema">
      <code>{JSON.stringify(value)}</code>
    </Row>
  );
}

function Row({
  label,
  hint,
  block,
  children,
}: {
  label: string;
  hint?: string;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${block ? ' block' : ''}`}>
      <label>
        {label}
        {hint && <small>{hint}</small>}
      </label>
      <div className="control">{children}</div>
    </div>
  );
}

function IdInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) {
    // Selection changed underneath us: adopt the new id.
    setWas(value);
    setDraft(value);
  }
  const valid = /^[a-z][a-z0-9_]*$/.test(draft);
  const commit = () => {
    if (valid && draft !== value) onCommit(draft);
    else setDraft(value);
  };
  return (
    <input
      className={valid ? '' : 'invalid'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}
