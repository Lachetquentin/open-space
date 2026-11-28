import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { busySessions } from '../../shared/app-update.ts';
import { locale, t } from '../i18n/index.ts';
import { useSessions } from '../state/sessions.ts';
import { CheckIcon, RefreshIcon } from './Icons.tsx';
import { Modal } from './Modal.tsx';

/**
 * Restarting the Mac app on the Open Space it downloaded, after a warning when sessions are at work: `ask` restarts
 * or opens the warning, `warning` is that dialog (render it), `restarting` once asked.
 */
export function useAppRestart() {
  const sessions = useSessions((s) => s.sessions);
  const [warned, setWarned] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const words = t.settings.prefs.update;
  // a restart that came to nothing (the update left `ready`) can be asked again
  const state = useSessions((s) => s.appUpdate?.state);
  useEffect(() => { setRestarting(false); }, [state]);
  const restart = () => { setWarned(false); setRestarting(true); useSessions.getState().restartApp(); };
  const busy = busySessions(Object.values(sessions));
  const ask = () => (busy.length ? setWarned(true) : restart());
  const names = new Intl.ListFormat(locale(), { type: 'conjunction' }).format(busy.map((session) => session.name));
  // out of the settings and the header, whose styles would reach into it
  const warning = warned && createPortal(
    <Modal title={words.restartQuestion} onClose={() => setWarned(false)}>
      <p className="cp-muted">{words.restartBusy(busy.length, names)}</p>
      <div className="cp-form__actions">
        <button type="button" className="cp-button" onClick={() => setWarned(false)}>{words.cancel}</button>
        <button type="button" className="cp-button" data-variant="primary" data-autofocus onClick={restart}>{words.restartAnyway}</button>
      </div>
    </Modal>,
    document.body,
  );
  return { ask, restarting, warning };
}

/**
 * What the Mac app can do about a new Open Space, wherever the settings show it: look for one, follow its download,
 * then restart on it, after a warning when sessions are at work.
 */
export function AppUpdateAction() {
  const update = useSessions((s) => s.appUpdate);
  const { ask, restarting, warning } = useAppRestart();
  const words = t.settings.prefs.update;

  if (update?.state === 'downloading') {
    const percent = new Intl.NumberFormat(locale(), { style: 'percent' }).format(update.percent / 100);
    return (
      <span className="cp-app-update__progress">
        <progress className="cp-meter" value={update.percent} max={100} aria-label={words.appDownloading(update.version)} />
        <span>{percent}</span>
      </span>
    );
  }
  if (update?.state === 'ready') {
    return (
      <>
        <button type="button" className="cp-button" data-variant="primary" disabled={restarting} aria-busy={restarting || undefined} onClick={ask}>
          {restarting && <RefreshIcon />}{words.appRestart}
        </button>
        {warning}
      </>
    );
  }
  return (
    <CheckButton
      busy={update?.state === 'checking'} done={update?.state === 'upToDate' ? words.upToDate : undefined}
      failure={update?.state === 'failed' ? update.text : undefined} onClick={() => useSessions.getState().checkApp()}
    />
  );
}

/** A button that looks for an update: its icon turns while it looks, then the button itself says what came of it (the reason of a failure on hover). */
export function CheckButton({ busy, done, failure, onClick }: { busy: boolean; done?: string; failure?: string; onClick: () => void }) {
  const words = t.settings.prefs.update;
  return (
    <button type="button" className="cp-button" disabled={busy} aria-busy={busy || undefined} title={failure && words.failed(failure)} onClick={onClick}>
      {done ? <><CheckIcon />{done}</> : <><RefreshIcon />{failure ? words.retry : words.check}</>}
    </button>
  );
}
