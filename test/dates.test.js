import { expect } from 'chai';
import { getTodayRange, DAY_START_HOUR, normalizeTimeOfDay, formatTaskTimeDisplay, isValidMonthDay, getNthWeekdayInMonth } from '../lib/dates.js';

describe('dates', () => {
	describe('getTodayRange', () => {
		it('at 10am, today started at 3am same day', () => {
			// January 22, 2026 at 10:00am Pacific
			const now = new Date('2026-01-22T10:00:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getFullYear()).to.equal(2026);
			expect(start.getMonth()).to.equal(0); // January
			expect(start.getDate()).to.equal(22);
			expect(start.getHours()).to.equal(DAY_START_HOUR);
			expect(start.getMinutes()).to.equal(0);

			expect(end.getDate()).to.equal(23);
			expect(end.getHours()).to.equal(DAY_START_HOUR);
		});

		it('at 2am, today started at 4am yesterday (late night buffer)', () => {
			// January 22, 2026 at 2:00am Pacific — still "January 21" day
			const now = new Date('2026-01-22T02:00:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(21);
			expect(start.getHours()).to.equal(DAY_START_HOUR);

			expect(end.getDate()).to.equal(22);
			expect(end.getHours()).to.equal(DAY_START_HOUR);
		});

		it('at exactly 4am, today started at 4am same day', () => {
			// January 22, 2026 at 4:00am Pacific — new day just started
			const now = new Date('2026-01-22T04:00:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(22);
			expect(start.getHours()).to.equal(DAY_START_HOUR);

			expect(end.getDate()).to.equal(23);
		});

		it('at 3:59am, still in previous day', () => {
			// January 22, 2026 at 3:59am Pacific — still "January 21" day
			const now = new Date('2026-01-22T03:59:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(21);
			expect(end.getDate()).to.equal(22);
		});

		it('at 11:59pm, today started at 3am same day', () => {
			// January 22, 2026 at 11:59pm Pacific
			const now = new Date('2026-01-22T23:59:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(22);
			expect(end.getDate()).to.equal(23);
		});
	});

	describe('normalizeTimeOfDay', () => {
		it('returns null for empty or invalid', () => {
			expect(normalizeTimeOfDay('')).to.be.null;
			expect(normalizeTimeOfDay(undefined)).to.be.null;
			expect(normalizeTimeOfDay('25:00')).to.be.null;
		});

		it('normalizes to HH:mm', () => {
			expect(normalizeTimeOfDay('9:05')).to.equal('09:05');
			expect(normalizeTimeOfDay('14:30')).to.equal('14:30');
		});
	});

	describe('formatTaskTimeDisplay', () => {
		it('returns empty for null', () => {
			expect(formatTaskTimeDisplay(null)).to.equal('');
		});

		it('formats 12-hour label', () => {
			expect(formatTaskTimeDisplay('14:30')).to.match(/2:30/);
		});
	});

	describe('isValidMonthDay', () => {
		it('accepts Feb 29 (leap year)', () => {
			expect(isValidMonthDay(2, 29)).to.be.true;
		});

		it('rejects Feb 30', () => {
			expect(isValidMonthDay(2, 30)).to.be.false;
		});

		it('rejects April 31', () => {
			expect(isValidMonthDay(4, 31)).to.be.false;
		});

		it('rejects non-integers', () => {
			expect(isValidMonthDay(1.5, 1)).to.be.false;
		});
	});

	describe('getNthWeekdayInMonth', () => {
		it('first Monday in September 2025 is Sep 1', () => {
			const d = getNthWeekdayInMonth(2025, 9, 1, 1);
			expect(d).to.not.be.null;
			if (!d) throw new Error('expected date');
			expect(d.getFullYear()).to.equal(2025);
			expect(d.getMonth()).to.equal(8);
			expect(d.getDate()).to.equal(1);
		});

		it('last Monday in May 2025', () => {
			const d = getNthWeekdayInMonth(2025, 5, 1, -1);
			expect(d).to.not.be.null;
			if (!d) throw new Error('expected date');
			expect(d.getMonth()).to.equal(4);
			expect(d.getDate()).to.equal(26);
		});

		it('returns null for fifth Monday in a February with only four Mondays', () => {
			const d = getNthWeekdayInMonth(2025, 2, 1, 5);
			expect(d).to.be.null;
		});
	});
});
