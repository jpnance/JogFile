import mongoose from 'mongoose';

const personSchema = new mongoose.Schema({
	name: { type: String, required: true },
	birthMonth: { type: Number, required: true, min: 1, max: 12 },
	birthDay: { type: Number, required: true, min: 1, max: 31 },
	birthYear: { type: Number, default: null },  // Optional, for age calculation
	notes: { type: String, default: '' },
	lastAcknowledgedYear: { type: Number, default: null },  // For tracking if we've seen this birthday this year
	createdAt: { type: Date, default: Date.now }
});

/**
 * Check if today is this person's birthday
 * @param {Date} date - The date to check
 * @returns {boolean}
 */
personSchema.methods.isBirthdayOn = function(date) {
	const month = date.getMonth() + 1;  // 1-12
	const day = date.getDate();
	return this.birthMonth === month && this.birthDay === day;
};

/**
 * Get the person's age as of a given date
 * @param {Date} date - The date to calculate age for
 * @returns {number|null}
 */
personSchema.methods.getAge = function(date) {
	if (!this.birthYear) return null;
	
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const year = date.getFullYear();
	
	let age = year - this.birthYear;
	
	// If birthday hasn't happened yet this year, subtract 1
	if (month < this.birthMonth || (month === this.birthMonth && day < this.birthDay)) {
		age--;
	}
	
	return age;
};

/**
 * Get the age they're turning on their next birthday
 * @param {Date} date - Reference date
 * @returns {number|null}
 */
personSchema.methods.getTurningAge = function(date) {
	if (!this.birthYear) return null;
	
	const month = date.getMonth() + 1;
	const day = date.getDate();
	const year = date.getFullYear();
	
	// If birthday has passed this year, they're turning age next year
	if (month > this.birthMonth || (month === this.birthMonth && day > this.birthDay)) {
		return year - this.birthYear + 1;
	}
	
	return year - this.birthYear;
};

/**
 * Get the next birthday date
 * @returns {Date}
 */
personSchema.methods.getNextBirthday = function() {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	
	const thisYear = today.getFullYear();
	const month = today.getMonth() + 1;
	const day = today.getDate();
	
	let nextBirthdayYear = thisYear;
	
	// If birthday has passed this year, next birthday is next year
	if (month > this.birthMonth || (month === this.birthMonth && day > this.birthDay)) {
		nextBirthdayYear = thisYear + 1;
	}
	
	return new Date(nextBirthdayYear, this.birthMonth - 1, this.birthDay, 12, 0, 0);
};

/**
 * Get a formatted birthday string
 * @returns {string}
 */
personSchema.methods.getBirthdayString = function() {
	const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'];
	return `${monthNames[this.birthMonth]} ${this.birthDay}`;
};

const Person = mongoose.model('Person', personSchema);

export default Person;
