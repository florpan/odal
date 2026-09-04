import { useApp } from '../hooks';

export function ModeHint() {
  const hint = useApp((s) => s.hud.modeHint);
  if (!hint) return null;
  return <div className="mode-hint">{hint}</div>;
}
