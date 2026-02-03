/**
 * Day boundary hour (4am = day starts at 4am)
 */
export const DAY_START_HOUR = 4;

/**
 * Timezone for the app
 */
export const TIMEZONE = 'America/Los_Angeles';

/**
 * Get the current hour in Pacific timezone.
 *
 * @param {Date} date
 * @returns {number}
 */
function getPacificHour(date) {
	return parseInt(date.toLocaleString('en-US', { timeZone: TIMEZONE, hour: 'numeric', hour12: false }));
}

/**
 * Get the current date parts in Pacific timezone.
 *
 * @param {Date} date
 * @returns {{ year: number, month: number, day: number, hour: number }}
 */
function getPacificParts(date) {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		hour12: false
	});
	const parts = formatter.formatToParts(date);
	return {
		year: parseInt(parts.find(p => p.type === 'year')?.value || '0'),
		month: parseInt(parts.find(p => p.type === 'month')?.value || '0'),
		day: parseInt(parts.find(p => p.type === 'day')?.value || '0'),
		hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0')
	};
}

/**
 * Get the start and end of "today" in Pacific time.
 * Today runs from 4am Pacific to 4am Pacific the next day.
 *
 * @param {Date} [now] - The reference time (defaults to current time)
 * @returns {{ start: Date, end: Date }}
 */
export function getTodayRange(now = new Date()) {
	const pacific = getPacificParts(now);
	
	// Determine the logical date (if before 4am, it's still "yesterday")
	let logicalYear = pacific.year;
	let logicalMonth = pacific.month;
	let logicalDay = pacific.day;
	
	if (pacific.hour < DAY_START_HOUR) {
		// Roll back one day
		const yesterday = new Date(pacific.year, pacific.month - 1, pacific.day - 1);
		logicalYear = yesterday.getFullYear();
		logicalMonth = yesterday.getMonth() + 1;
		logicalDay = yesterday.getDate();
	}

	// Create start at 4am Pacific on the logical date
	// We use noon UTC as a safe anchor, then adjust
	const start = new Date(Date.UTC(logicalYear, logicalMonth - 1, logicalDay, 12, 0, 0, 0));
	
	// End is 24 hours later
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

	return { start, end };
}

/**
 * Get the logical "today" date (YYYY-MM-DD) in Pacific time,
 * accounting for the 4am day boundary.
 *
 * @param {Date} [now] - The reference time (defaults to current time)
 * @returns {string} - Date string in YYYY-MM-DD format
 */
export function getLogicalToday(now = new Date()) {
	const pacific = getPacificParts(now);
	
	let year = pacific.year;
	let month = pacific.month;
	let day = pacific.day;
	
	if (pacific.hour < DAY_START_HOUR) {
		const yesterday = new Date(pacific.year, pacific.month - 1, pacific.day - 1);
		year = yesterday.getFullYear();
		month = yesterday.getMonth() + 1;
		day = yesterday.getDate();
	}
	
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Get a Date object for scheduling a task on a given logical date.
 * Returns noon Pacific on that date.
 *
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Date}
 */
export function getScheduleDate(dateStr) {
	const [year, month, day] = dateStr.split('-').map(Number);
	// Create date at noon Pacific to avoid timezone edge cases
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	return date;
}

/**
 * Get tomorrow's date range.
 *
 * @param {Date} [now] - The reference time (defaults to current time)
 * @returns {{ start: Date, end: Date }}
 */
export function getTomorrowRange(now = new Date()) {
	const { end: todayEnd } = getTodayRange(now);
	const start = new Date(todayEnd);
	const end = new Date(start);
	end.setDate(end.getDate() + 1);
	return { start, end };
}

/**
 * Format a date for display.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDate(date) {
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		timeZone: TIMEZONE
	});
}

/**
 * Format "today" for display, accounting for the 4am day boundary.
 *
 * @param {Date} [now] - The reference time (defaults to current time)
 * @returns {string}
 */
export function formatToday(now = new Date()) {
	const dateStr = getLogicalToday(now);
	const [year, month, day] = dateStr.split('-').map(Number);
	// Create a date at noon to avoid any timezone edge cases
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});
}
