import { leaveGame } from '../../app/store';
import { useApp } from '../hooks';

export function LobbyScreen() {
  const lobby = useApp((s) => s.lobby);
  const you = useApp((s) => s.you);
  const room = useApp((s) => s.room);
  const connection = useApp((s) => s.connection);
  const error = useApp((s) => s.error);
  const session = useApp((s) => s.session);
  const ready = lobby?.players.find((p) => p.name === you)?.ready ?? false;

  let hint = '';
  if (connection === 'connecting') hint = 'Connecting…';
  else if (connection === 'closed') hint = 'Disconnected.';
  else if (!lobby) hint = 'Joining…';
  else if (lobby.players.length === 1) hint = 'Waiting for others to join this room. Press Ready to start alone.';
  else hint = 'The game starts when everyone is ready.';

  return (
    <div className="overlay">
      <div className="panel">
        <h2>Room "{lobby?.room ?? room}"</h2>
        {error && <p className="error">{error}</p>}
        <ul className="lobby-players">
          {lobby?.players.map((p) => (
            <li key={p.name} className={p.ready ? 'ready' : ''}>
              {p.name}
              <span>{p.ready ? 'ready' : 'waiting'}</span>
            </li>
          ))}
        </ul>
        <div className="row">
          <button type="button" disabled={!lobby || connection !== 'open'} onClick={() => session?.setReady(!ready)}>
            {ready ? 'Not ready' : 'Ready'}
          </button>
          <button type="button" className="secondary" onClick={leaveGame}>
            Leave
          </button>
        </div>
        <p className="muted">{hint}</p>
      </div>
    </div>
  );
}
