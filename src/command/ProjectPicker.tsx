import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { isFullPath } from '../../shared/paths.ts';
import { t } from '../i18n/index.ts';
import { homeRelative } from '../lib/format.ts';
import { findProjects, insideRoots, nextRow, outsideRoots, withPin, withProject } from '../state/projects.ts';
import { useSessions } from '../state/sessions.ts';
import { useProjects } from '../state/useProjects.ts';
import { FolderPicker } from './FolderPicker.tsx';
import { ChevronDownIcon, PinIcon, PlusIcon, UnpinIcon } from './Icons.tsx';
import { useDismiss } from './useDismiss.ts';

/**
 * The streamlined launcher's question, its project's name a button that opens the projects: those of the sessions and the
 * saved ones (Preferences.projects), to find by name, pin, or add a folder to. Picking one is where the session starts.
 * `before` and `after`: the question's words around the name.
 */
export function ProjectPicker({ cwd, name, before, after, onPick }: { cwd: string; name: string; before: string; after: string; onPick: (folder: string) => void }) {
  const { known } = useProjects();
  const saved = useSessions((s) => s.preferences.projects);
  const directories = useSessions((s) => s.directories);
  const roots = useSessions((s) => s.roots);
  const realRoots = useSessions((s) => s.realRoots);
  const setPreferences = useSessions((s) => s.setPreferences);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // null: the button to add one; a string: the folder being typed or picked
  const [adding, setAdding] = useState<string | null>(null);
  const [outside, setOutside] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0); setAdding(null); setOutside(false); }, []);
  useDismiss(open, box, close);
  const listId = useId();
  const words = t.composer.projectPicker;
  const shown = findProjects(known, query);
  const current = homeRelative(cwd);
  // a saved project whose folder left the allowed ones is shown, to unpin or remove, but not picked
  const unreachable = shown.map((project) => outsideRoots(project, roots, realRoots));
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, listId]);

  const pick = (folder: string) => { onPick(homeRelative(folder)); close(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown.length) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => nextRow(unreachable, index, step));
    } else if (event.key === 'Enter' && shown[active] && !unreachable[active]) {
      event.preventDefault();
      pick(shown[active].folder);
    }
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const folder = adding?.trim() ?? '';
    if (!isFullPath(folder)) return;
    // the server keeps it only inside the roots, under its real path: outside them it would be dropped without a word
    if (!insideRoots(folder, roots, realRoots)) { setOutside(true); return; }
    setPreferences({ projects: withProject(saved ?? [], folder) });
    pick(folder);
  };

  return (
    <div className="cp-project-picker" ref={box}>
      <h2>
        {before}
        <button type="button" className="cp-project-picker__trigger" aria-haspopup="dialog" aria-expanded={open} title={words.change} onClick={() => { if (open) close(); else { setActive(nextRow(known.map((project) => outsideRoots(project, roots, realRoots)), -1, 1)); setOpen(true); } }}>
          <strong>{name}</strong><ChevronDownIcon />
        </button>
        {after}
      </h2>
      {open && (
        <div className="cp-project-picker__panel" role="dialog" aria-label={words.title}>
          <input
            className="cp-project-picker__search" type="search" value={query} placeholder={words.search} aria-label={words.search} autoComplete="off" spellCheck={false} autoFocus
            role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setActive(nextRow(findProjects(known, e.target.value).map((project) => outsideRoots(project, roots, realRoots)), -1, 1)); }} onKeyDown={onKeyDown}
          />
          <ul className="cp-project-picker__list" id={listId} role="listbox" aria-label={words.title}>
            {shown.map((project, index) => (
              <li
                key={project.folder} id={`${listId}-${index}`} role="option" aria-selected={index === active} aria-disabled={unreachable[index] || undefined} data-disabled={unreachable[index] || undefined} data-current={homeRelative(project.folder) === current || undefined}
                title={unreachable[index] ? words.outsideRoots : undefined}
                className="cp-project-picker__option" onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => { if (!unreachable[index]) setActive(index); }} onClick={() => { if (!unreachable[index]) pick(project.folder); }}
              >
                <span className="cp-project-picker__initial" aria-hidden="true">{project.name.charAt(0).toLocaleUpperCase()}</span>
                <span className="cp-project-picker__name">{project.name}</span>
                <span className="cp-project-picker__folder">{homeRelative(project.folder)}</span>
                <button
                  type="button" className="cp-icon-button cp-project-picker__pin" data-size="small" aria-pressed={project.pinned} aria-label={project.pinned ? words.unpin : words.pin} title={project.pinned ? words.unpin : words.pin}
                  onClick={(e) => { e.stopPropagation(); setPreferences({ projects: withPin(saved ?? [], project.folder, !project.pinned) }); }}
                >{project.pinned ? <UnpinIcon /> : <PinIcon />}</button>
              </li>
            ))}
            {!shown.length && <li className="cp-project-picker__empty cp-muted">{words.none}</li>}
          </ul>
          {adding === null ? (
            <button type="button" className="cp-project-picker__add" onClick={() => setAdding('')}><PlusIcon />{words.add}</button>
          ) : (
            <form className="cp-project-picker__adding" onSubmit={add}>
              <FolderPicker directories={directories} value={adding} onChange={(value) => { setAdding(value); setOutside(false); }} placeholder={words.addPlaceholder} field />
              <button type="submit" className="cp-button" disabled={!isFullPath(adding.trim())}>{words.addAction}</button>
              {outside && <p className="cp-project-picker__empty cp-muted" role="alert">{words.outside}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
