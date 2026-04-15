import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';
import QuickList from '../models/QuickList.js';
import { connectTestDb, disconnectTestDb, clearTestDb } from './setup.js';

describe('Quick Lists', () => {
	before(async () => {
		await connectTestDb();
	});

	beforeEach(async () => {
		await clearTestDb();
	});

	after(async () => {
		await disconnectTestDb();
	});

	describe('POST /quick-lists', () => {
		it('creates a quick list and redirects', async () => {
			const res = await request(app)
				.post('/quick-lists')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ name: 'Groceries' })
				.expect(302);

			expect(res.headers.location).to.equal('/quick-lists');

			const ql = await QuickList.findOne({ name: 'Groceries' });
			expect(ql).to.not.be.null;
			if (!ql) throw new Error('QuickList not found');
			expect(ql.items).to.have.length(0);
		});

		it('returns 400 for missing name', async () => {
			await request(app)
				.post('/quick-lists')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({})
				.expect(400);
		});
	});

	describe('POST /quick-lists/:id/items', () => {
		it('adds an item to a quick list', async () => {
			const ql = await QuickList.create({ name: 'Test', items: [] });

			await request(app)
				.post(`/quick-lists/${ql._id}/items`)
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ text: 'Milk' })
				.expect(302);

			const updated = await QuickList.findById(ql._id);
			expect(updated).to.not.be.null;
			if (!updated) throw new Error('QuickList not found');
			expect(updated.items).to.have.length(1);
			expect(updated.items[0].text).to.equal('Milk');
		});
	});

	describe('POST /quick-lists/:id/items/:itemId/delete', () => {
		it('removes an item from a quick list', async () => {
			const ql = await QuickList.create({ name: 'Test', items: [{ text: 'A' }, { text: 'B' }] });
			const itemId = ql.items[0]._id;

			await request(app)
				.post(`/quick-lists/${ql._id}/items/${itemId}/delete`)
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(302);

			const updated = await QuickList.findById(ql._id);
			expect(updated).to.not.be.null;
			if (!updated) throw new Error('QuickList not found');
			expect(updated.items).to.have.length(1);
			expect(updated.items[0].text).to.equal('B');
		});
	});

	describe('GET /quick-lists', () => {
		it('returns 200 when authenticated', async () => {
			const res = await request(app)
				.get('/quick-lists')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('Quick Lists');
		});
	});
});
