/**
 * Wayline job (mission) status contract.
 *
 * Single source of truth for the numeric statuses the DJI wayline job API
 * returns. client.ts uses these for the preflight busy-check and parsers.ts
 * for mission status mapping; keeping them here prevents the two from
 * drifting.
 */

/** DJI wayline job status: 0 issued, 1 running, 2 cancelled, 3 completed, 4 failed, 5 timeout, 6 paused. */
export const KNOWN_JOB_STATUSES = [0, 1, 2, 3, 4, 5, 6] as const;

/** Statuses that mean the dock/airport is explicitly busy: 1 = running, 6 = paused. */
export const ACTIVE_JOB_STATUSES = new Set<number>([1, 6]);

export type JobStatusValue = (typeof KNOWN_JOB_STATUSES)[number];

/** Whether a raw status is a known, whole-number wayline job status. */
export function isKnownJobStatus(status: number): boolean {
	return Number.isInteger(status) && (KNOWN_JOB_STATUSES as readonly number[]).includes(status);
}
