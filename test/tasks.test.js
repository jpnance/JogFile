import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';
import { connectTestDb, disconnectTestDb, clearTestDb } from './setup.js';

describe('Tasks', () => {
	before(async () => {
		await connectTestDb();
	});

	beforeEach(async () => {
		await clearTestDb();
	});

	after(async () => {
		await disconnectTestDb();
	});

	describe('POST /tasks', () => {
		it('creates a task and returns HTML containing the task', async () => {
			const res = await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ title: 'Buy milk' })
				.expect(201);

			expect(res.text).to.include('Buy milk');
		});

		it('creates a task with a scheduled date', async () => {
			const res = await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ title: 'Call dentist', scheduledFor: '2026-01-25' })
				.expect(201);

			expect(res.text).to.include('Call dentist');
		});

		it('redirects to login when not authenticated', async () => {
			const res = await request(app)
				.post('/tasks')
				.send({ title: 'Buy milk' })
				.expect(302);

			expect(res.headers.location).to.equal('/login');
		});

		it('returns 400 when title is missing', async () => {
			const res = await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({})
				.expect(400);

			expect(res.text).to.include('Title is required');
		});
	});
});
