/**
 * Day boundary hour (3am = day starts at 3am)
 */
export const DAY_START_HOUR = 3;

/**
 * Timezone for the app
 */
export const TIMEZONE = 'America/Los_Angeles';

/**
 * Convert a Date to Pacific timezone.
 *
 * @param {Date} date
 * @returns {Date}
 */
export function toPacific(date) {
	return new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));
}

/**
 * Get the start and end of "today" in Pacific time.
 * Today runs from 3am Pacific to 3am Pacific the next day.
 *
 * @param {Date} [now] - The reference time (defaults to current time)
 * @returns {{ start: Date, end: Date }}
 */
export function getTodayRange(now = new Date()) {
	const pacificNow = toPacific(now);

	// Start with today at 3am
	const start = new Date(pacificNow);
	start.setHours(DAY_START_HOUR, 0, 0, 0);

	// If it's before 3am, we're still in "yesterday's" day
	if (pacificNow.getHours() < DAY_START_HOUR) {
		start.setDate(start.getDate() - 1);
	}

	// End is 3am the next day
	const end = new Date(start);
	end.setDate(end.getDate() + 1);

	return { start, end };
}
