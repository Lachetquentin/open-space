import { useId, type ReactNode } from 'react';

/**
 * A section that folds away under its title: the title is the button (its `marker`, a chevron from the caller, turns
 * while folded), `note` beside it in muted words (a count), `actions` at the end of its line. Its words come from the caller.
 */
export function Fold({ title, note, marker, folded, onToggle, actions, children }: {
  title: ReactNode; note?: ReactNode; marker: ReactNode; folded: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode;
}) {
  const body = useId();
  return (
    <section className="cp-fold" data-folded={folded}>
      <div className="cp-fold__head">
        <h3 className="cp-fold__title">
          <button type="button" aria-expanded={!folded} aria-controls={body} onClick={onToggle}>
            {marker}<span className="cp-fold__label">{title}</span>{note !== undefined && <span className="cp-fold__note">{note}</span>}
          </button>
        </h3>
        {actions}
      </div>
      <div className="cp-fold__body" id={body} hidden={folded}>{children}</div>
    </section>
  );
}
