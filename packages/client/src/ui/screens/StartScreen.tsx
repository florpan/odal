import { useState } from 'react';
import type { FormEvent } from 'react';
import { appStore } from '../../app/store';
import { GameSession } from '../../game';
import { useApp } from '../hooks';

const params = new URLSearchParams(location.search);

export function StartScreen() {
  const error = useApp((s) => s.error);
  const [name, setName] = useState(params.get('name') ?? localStorage.getItem('odal.name') ?? '');
  const [room, setRoom] = useState(params.get('room') ?? localStorage.getItem('odal.room') ?? 'main');

  const join = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    const r = room.trim().toLowerCase() || 'main';
    localStorage.setItem('odal.name', n);
    localStorage.setItem('odal.room', r);
    appStore.setState({ session: new GameSession(n, r), screen: 'lobby', lobby: null });
  };

  return (
    <div className="overlay">
      <form className="panel" onSubmit={join}>
        <h1>Odal</h1>
        <p className="muted">Gather lumber, iron, gold and wheat. Build a village. Research. Raise an army.</p>
        {error && <p className="error">{error}</p>}
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            placeholder="Your name"
            autoFocus
          />
        </label>
        <label>
          Room
          <input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={24} placeholder="main" />
        </label>
        <button type="submit">Join room</button>
      </form>
    </div>
  );
}
