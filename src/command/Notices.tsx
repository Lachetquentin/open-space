import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { attentionQueue } from '../state/queue.ts';
import { useSessions } from '../state/sessions.ts';

export function ConnectionBanner() {
  const connection = useSessions((s) => s.connection);
  const claude = useSessions((s) => s.claude);
  if (connection === 'live') {
    return claude && !claude.found ? <p className="cp-banner" data-tone="error" role="status">{t.common.notices.claudeMissing}</p> : null;
  }
  // opened through Tailscale (the phone): the authorisation link is in the computer's settings, not in a terminal
  const notice = connection === 'unpaired' && location.protocol === 'https:' ? 'unpairedPhone' : connection;
  return <p className="cp-banner" data-tone={connection === 'connecting' ? 'neutral' : 'error'} role="status">{t.common.notices[notice]}</p>;
}

export function Toasts() {
  const toasts = useSessions((s) => s.toasts);
  const closeToast = (id: number) => useSessions.setState((s) => ({ toasts: s.toasts.filter((one) => one.id !== id) }));
  return (
    <div className="cp-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <p key={toast.id} className="cp-toast" data-kind={toast.kind}>
          {toast.text}
          {toast.action && <button type="button" className="cp-toast__action" onClick={() => { closeToast(toast.id); toast.action?.run(); }}>{toast.action.label}</button>}
        </p>
      ))}
    </div>
  );
}

/** Screen-reader announcement when a session starts waiting for the user. */
export function AttentionAnnouncer() {
  const sessions = useSessions((s) => s.sessions);
  const seen = useSessions((s) => s.seen);
  const [message, setMessage] = useState('');
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const queue = attentionQueue(Object.values(sessions), seen);
    const ids = new Set(queue.map((item) => item.session.id));
    if (known.current) {
      const added = queue.filter((item) => !known.current!.has(item.session.id));
      if (added.length) setMessage(added.map((item) => t.common.notices.waitingForYou(item.session.name)).join('. '));
    }
    known.current = ids;
  }, [sessions, seen]);
  return <div className="cp-sr-only" aria-live="polite">{message}</div>;
}
