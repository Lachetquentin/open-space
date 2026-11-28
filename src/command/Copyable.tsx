import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { CheckIcon, CopyIcon } from './Icons.tsx';

/** Copies a text; `copied` stays true for a moment after. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => setCopied(true), () => {}); };
  return { copied, copy };
}

/** A text copied on click, the button saying so for a moment. */
export function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className="cp-button" data-size="small" onClick={() => copy(text)}>
      <CopyIcon />{copied ? t.automata.triggers.copied : t.automata.triggers.copy}
    </button>
  );
}

/** A path in monospace, cut from its start when long (its end tells the most), whole in its tooltip; a click copies it. */
export function CopyPath({ path, copyLabel }: { path: string; copyLabel: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className="cp-copy-path" title={`${path}\n${copied ? t.common.copied : copyLabel}`} aria-label={`${copyLabel} ${path}`} onClick={() => copy(path)}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="cp-copy-path__text"><bdi>{path}</bdi></span>
    </button>
  );
}

/** A value to copy whole (an address, a configuration), set apart in monospace. */
export function Copyable({ text, block }: { text: string; block?: boolean }) {
  return (
    <div className="cp-trigger__copy">
      {block ? <pre>{text}</pre> : <code>{text}</code>}
      <CopyButton text={text} />
    </div>
  );
}
