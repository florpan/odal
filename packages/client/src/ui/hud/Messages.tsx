import { useApp } from '../hooks';

const TTL = 9000;

export function Messages() {
  const messages = useApp((s) => s.hud.messages);
  const now = performance.now();
  return (
    <div className="messages">
      {messages.map((m) => (
        <div key={m.id} style={{ opacity: Math.min(1, (TTL - (now - m.at)) / 2000) }}>
          {m.text}
        </div>
      ))}
    </div>
  );
}
