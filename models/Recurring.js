import mongoose from 'mongoose';

const recurringSchema = new mongoose.Schema({
	title: { type: String, required: true },
	description: { type: String, default: '' },
	url: { type: String, default: '' },  // Quick-action URL inherited by generated tasks
	pattern: {
		type: { 
			type: String, 
			enum: ['daily', 'weekly', 'monthly', 'yearly', 'interval'],
			required: true
		},
		daysOfWeek: [{ type: Number, min: 0, max: 6 }],  // 0 = Sunday, 6 = Saturday
		weeklyInterval: { type: Number, min: 1, default: 1 },  // every N weeks (1 = every week, 2 = biweekly)
		weeklyAnchor: { type: Date },  // anchor date for calculating week intervals
		dayOfMonth: { type: Number, min: -1, max: 31 },  // -1 = last day of month
		yearlyMonth: { type: Number, min: 1, max: 12 },  // 1 = January, 12 = December
		yearlyDay: { type: Number, min: 1, max: 31 },
		intervalDays: { type: Number, min: 1 },
		intervalAnchor: { type: Date }  // start date for interval calculation
	},
	isActive: { type: Boolean, default: true },
	pausedUntil: { type: Date, default: null },
	lastGeneratedFor: { type: Date, default: null },  // track when we last prompted for this
	createdAt: { type: Date, default: Date.now }
});

/**
 * Check if this recurring template is scheduled for a given date.
 * @param {Date} date - The date to check
 * @returns {boolean}
 */
recurringSchema.methods.isScheduledFor = function(date) {
	if (!this.isActive) return false;
	
	// Check if paused
	if (this.pausedUntil && date < this.pausedUntil) return false;

	const dayOfWeek = date.getDay();  // 0-6
	const dayOfMonth = date.getDate();  // 1-31
	const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

	switch (this.pattern.type) {
		case 'daily':
			return true;

		case 'weekly':
			// Check if it's the right day of the week
			if (!this.pattern.daysOfWeek?.includes(dayOfWeek)) return false;
			
			// Check week interval (every N weeks)
			const weeklyInterval = this.pattern.weeklyInterval || 1;
			if (weeklyInterval === 1) return true;
			
			// For biweekly/multi-week, check against anchor
			// If no anchor is set, don't schedule (safer default)
			if (!this.pattern.weeklyAnchor) return false;
			
			const anchor = new Date(this.pattern.weeklyAnchor);
			anchor.setHours(0, 0, 0, 0);
			const target = new Date(date);
			target.setHours(0, 0, 0, 0);
			
			// Calculate weeks since anchor
			const msPerWeek = 7 * 24 * 60 * 60 * 1000;
			const weeksDiff = Math.floor((target.getTime() - anchor.getTime()) / msPerWeek);
			
			// Only schedule if we're on or after the anchor date, and on the right week
			return weeksDiff >= 0 && weeksDiff % weeklyInterval === 0;

		case 'monthly':
			if (this.pattern.dayOfMonth === -1) {
				// Last day of month
				return dayOfMonth === lastDayOfMonth;
			}
			// Specific day, or fall back to last day if month is shorter
			const targetDay = Math.min(this.pattern.dayOfMonth, lastDayOfMonth);
			return dayOfMonth === targetDay;

		case 'yearly':
			const month = date.getMonth() + 1;  // 1-12
			if (month !== this.pattern.yearlyMonth) return false;
			// Check day, accounting for shorter months
			const yearlyLastDay = new Date(date.getFullYear(), month, 0).getDate();
			const yearlyTargetDay = Math.min(this.pattern.yearlyDay, yearlyLastDay);
			return dayOfMonth === yearlyTargetDay;

		case 'interval':
			if (!this.pattern.intervalAnchor || !this.pattern.intervalDays) return false;
			const intervalAnchor = new Date(this.pattern.intervalAnchor);
			intervalAnchor.setHours(0, 0, 0, 0);
			const intervalTarget = new Date(date);
			intervalTarget.setHours(0, 0, 0, 0);
			const diffDays = Math.floor((intervalTarget.getTime() - intervalAnchor.getTime()) / (1000 * 60 * 60 * 24));
			return diffDays >= 0 && diffDays % this.pattern.intervalDays === 0;

		default:
			return false;
	}
};

/**
 * Get a human-readable description of the pattern.
 * @returns {string}
 */
recurringSchema.methods.getPatternDescription = function() {
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	
	switch (this.pattern.type) {
		case 'daily':
			return 'Daily';

		case 'weekly':
			const days = this.pattern.daysOfWeek?.map(/** @param {number} d */ d => dayNames[d]).join(', ') ?? '';
			const weeklyInterval = this.pattern.weeklyInterval || 1;
			if (weeklyInterval === 1) {
				return `Every ${days}`;
			} else if (weeklyInterval === 2) {
				return `Every other ${days}`;
			} else {
				return `Every ${weeklyInterval} weeks on ${days}`;
			}

		case 'monthly':
			if (this.pattern.dayOfMonth === -1) {
				return 'Monthly on the last day';
			}
			return `Monthly on day ${this.pattern.dayOfMonth}`;

		case 'yearly':
			const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
				'July', 'August', 'September', 'October', 'November', 'December'];
			return `Yearly on ${monthNames[this.pattern.yearlyMonth]} ${this.pattern.yearlyDay}`;

		case 'interval':
			return `Every ${this.pattern.intervalDays} days`;

		default:
			return 'Unknown pattern';
	}
};

/**
 * Get the next occurrence date for this recurring template.
 * @returns {Date|null}
 */
recurringSchema.methods.getNextOccurrence = function() {
	if (!this.isActive) return null;
	
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	
	// Start from today or pausedUntil, whichever is later
	let checkDate = new Date(today);
	if (this.pausedUntil && this.pausedUntil > today) {
		checkDate = new Date(this.pausedUntil);
		checkDate.setHours(0, 0, 0, 0);
	}
	
	// Check up to 400 days out (covers yearly + some buffer)
	for (let i = 0; i < 400; i++) {
		if (this.isScheduledFor(checkDate)) {
			return new Date(checkDate);
		}
		checkDate.setDate(checkDate.getDate() + 1);
	}
	
	return null;
};

const Recurring = mongoose.model('Recurring', recurringSchema);

export default Recurring;
