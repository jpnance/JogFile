import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema({
	name: { type: String, required: true },
	month: { type: Number, required: true, min: 1, max: 12 },
	day: { type: Number, required: true, min: 1, max: 31 },
	notes: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now }
});

/**
 * Next calendar occurrence of this holiday (same logic as Person#getNextBirthday).
 * @returns {Date}
 */
holidaySchema.methods.getNextOccurrence = function() {
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
 * @returns {string} e.g. "December 25"
 */
holidaySchema.methods.getHolidayString = function() {
	const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'];
	return `${monthNames[this.month]} ${this.day}`;
};

const Holiday = mongoose.model('Holiday', holidaySchema);

export default Holiday;
