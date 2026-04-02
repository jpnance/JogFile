import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';
import Holiday from '../models/Holiday.js';
import { connectTestDb, disconnectTestDb, clearTestDb } from './setup.js';

describe('Holidays', () => {
	before(async () => {
		await connectTestDb();
	});

	beforeEach(async () => {
		await clearTestDb();
	});

	after(async () => {
		await disconnectTestDb();
	});

	describe('POST /holidays', () => {
		it('creates a holiday and redirects', async () => {
			const res = await request(app)
				.post('/holidays')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ name: 'Test Day', month: '12', day: '25', notes: '' })
				.expect(302);

			expect(res.headers.location).to.equal('/holidays');

			const h = await Holiday.findOne({ name: 'Test Day' });
			expect(h).to.not.be.null;
			if (!h) throw new Error('Holiday not found');
			expect(h.month).to.equal(12);
			expect(h.day).to.equal(25);
		});

		it('returns 400 for invalid calendar date', async () => {
			await request(app)
				.post('/holidays')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ name: 'Bad', month: '2', day: '30' })
				.expect(400);
		});

		it('creates an nth-weekday holiday (Labor Day pattern)', async () => {
			await request(app)
				.post('/holidays')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({
					name: 'Labor Day',
					recurrenceType: 'nth_weekday',
					month: '9',
					weekday: '1',
					weekOrdinal: '1',
					notes: ''
				})
				.expect(302);

			const h = await Holiday.findOne({ name: 'Labor Day' });
			expect(h).to.not.be.null;
			if (!h) throw new Error('Holiday not found');
			expect(h.recurrenceType).to.equal('nth_weekday');
			expect(h.month).to.equal(9);
			expect(h.weekday).to.equal(1);
			expect(h.weekOrdinal).to.equal(1);
			expect(h.day).to.be.null;
		});

		it('redirects to login when not authenticated', async () => {
			const res = await request(app)
				.post('/holidays')
				.send({ name: 'X', month: '1', day: '1' })
				.expect(302);

			expect(res.headers.location).to.equal('/login');
		});
	});

	describe('GET /holidays', () => {
		it('returns 200 when authenticated', async () => {
			const res = await request(app)
				.get('/holidays')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('Holidays');
		});
	});
});
