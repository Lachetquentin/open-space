// What the server and the page share about timers.

/** The longest delay setTimeout keeps (2^31 - 1 ms): past it the timer fires at once, so a later time is waited for in steps. */
export const MAX_TIMER_MS = 2_147_483_647;
