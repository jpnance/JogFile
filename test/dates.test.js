import { expect } from 'chai';
import { getTodayRange, DAY_START_HOUR } from '../lib/dates.js';

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

		it('at 2am, today started at 3am yesterday (late night buffer)', () => {
			// January 22, 2026 at 2:00am Pacific — still "January 21" day
			const now = new Date('2026-01-22T02:00:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(21);
			expect(start.getHours()).to.equal(DAY_START_HOUR);

			expect(end.getDate()).to.equal(22);
			expect(end.getHours()).to.equal(DAY_START_HOUR);
		});

		it('at exactly 3am, today started at 3am same day', () => {
			// January 22, 2026 at 3:00am Pacific — new day just started
			const now = new Date('2026-01-22T03:00:00-08:00');
			const { start, end } = getTodayRange(now);

			expect(start.getDate()).to.equal(22);
			expect(start.getHours()).to.equal(DAY_START_HOUR);

			expect(end.getDate()).to.equal(23);
		});

		it('at 2:59am, still in previous day', () => {
			// January 22, 2026 at 2:59am Pacific — still "January 21" day
			const now = new Date('2026-01-22T02:59:00-08:00');
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
});
