import mongoose from 'mongoose';
import { getNthWeekdayInMonth } from '../lib/dates.js';

const holidaySchema = new mongoose.Schema({
	name: { type: String, required: true },
	/** `fixed` = same calendar date each year; `nth_weekday` = e.g. first Monday in September. */
	recurrenceType: { type: String, enum: ['fixed', 'nth_weekday'], default: 'fixed' },
	month: { type: Number, required: true, min: 1, max: 12 },
	/** Set when `recurrenceType === 'fixed'`. */
	day: { type: Number, min: 1, max: 31, default: null },
	/** `Date#getDay()` 0 = Sunday … 6 = Saturday; set when `nth_weekday`. */
	weekday: { type: Number, min: 0, max: 6, default: null },
	/** 1 = first … 4 = fourth occurrence; -1 = last weekday in month. */
	weekOrdinal: { type: Number, default: null },
	notes: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now }
});

/**
 * Next calendar occurrence of this holiday (same “today” logic as Person#getNextBirthday for fixed dates).
 * @returns {Date}
 */
holidaySchema.methods.getNextOccurrence = function() {
	const rt = this.recurrenceType || 'fixed';

	if (rt === 'nth_weekday') {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const thisYear = today.getFullYear();

		let candidate = getNthWeekdayInMonth(thisYear, this.month, this.weekday, this.weekOrdinal);
		if (!candidate) {
			candidate = getNthWeekdayInMonth(thisYear + 1, this.month, this.weekday, this.weekOrdinal);
		}
		if (!candidate) {
			return new Date(thisYear, this.month - 1, 1, 12, 0, 0);
		}

		const candDay = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate()).getTime();
		const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

		if (candDay < todayDay) {
			const next = getNthWeekdayInMonth(thisYear + 1, this.month, this.weekday, this.weekOrdinal);
			return next || candidate;
		}
		return candidate;
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const thisYear = today.getFullYear();
	const month = today.getMonth() + 1;
	const day = today.getDate();

	let y = thisYear;
	if (month > this.month || (month === this.month && day > this.day)) {
		y = thisYear + 1;
	}

	return new Date(y, this.month - 1, this.day, 12, 0, 0);
};

/**
 * @returns {string} e.g. "December 25" or "First Monday in September"
 */
holidaySchema.methods.getHolidayString = function() {
	const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'];
	const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	if ((this.recurrenceType || 'fixed') === 'nth_weekday') {
		const ord =
			this.weekOrdinal === -1
				? 'Last'
				: ['First', 'Second', 'Third', 'Fourth'][this.weekOrdinal - 1];
		return `${ord} ${weekdayNames[this.weekday]} in ${monthNames[this.month]}`;
	}

	return `${monthNames[this.month]} ${this.day}`;
};

const Holiday = mongoose.model('Holiday', holidaySchema);

export default Holiday;
