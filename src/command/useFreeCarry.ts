// A window floating over the office on its own (a mod's, the browser's picture in picture, a PM's live page): carried by
// its title bar once the pointer has gone a little way, resized at once by its edges and corners (FreeHandles). This hook
// follows the pointer from the press; the window says what a pull of an edge gives and what it keeps when let go.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { placePip } from '../state/pip.ts';
import type { Box } from '../state/room-frame.ts';
import type { Edge } from '../state/windows.ts';
import { floatingSurface } from './boxes.ts';

/** how far a press on the title bar goes before it carries the window (an edge pulled resizes it at once) */
export const CARRY_AFTER = 4;

export interface FreeCarry {
  /** the box an edge pulled by dx, dy gives, from the box the window had when pressed */
  resize: (start: Box, edge: Edge, dx: number, dy: number) => Box;
  /** at each move, where the window goes (carried, or resized) */
  move: (next: Box) => void;
  /** let go once it moved: the edge pulled, null when it was carried */
  drop: (edge: Edge | null) => void;
}

/**
 * `grab` on a press the window takes (it leaves out what keeps its click), `drag` and `drop` on its pointer events
 * (move, up, cancel); `moving` from the first move to the drop. Read at each event, `box` and the callbacks of the last render.
 */
export function useFreeCarry(box: Box, { resize, move, drop }: FreeCarry) {
  const carried = useRef<{ start: Box; x: number; y: number; edge: Edge | null; started: boolean } | null>(null);
  const [moving, setMoving] = useState(false);
  return {
    moving,
    grab: (edge: Edge | null, event: ReactPointerEvent<HTMLElement>) => {
      carried.current = { start: box, x: event.clientX, y: event.clientY, edge, started: false };
    },
    drag: (event: ReactPointerEvent<HTMLElement>) => {
      const from = carried.current;
      if (!from) return;
      const dx = event.clientX - from.x, dy = event.clientY - from.y;
      if (!from.started) {
        if (!from.edge && Math.hypot(dx, dy) < CARRY_AFTER) return;
        from.started = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setMoving(true);
      }
      move(from.edge ? resize(from.start, from.edge, dx, dy) : placePip({ ...from.start, left: from.start.left + dx, top: from.start.top + dy }, floatingSurface()));
    },
    drop: () => {
      const from = carried.current;
      carried.current = null;
      if (!from?.started) return;
      setMoving(false);
      drop(from.edge);
    },
  };
}
