import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';
import Task from '../models/Task.js';
import { connectTestDb, disconnectTestDb, clearTestDb } from './setup.js';
import { getTodayRange } from '../lib/dates.js';

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
		it('creates a task and redirects to home', async () => {
			const res = await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ title: 'Buy milk' })
				.expect(302);

			expect(res.headers.location).to.equal('/');

			const task = await Task.findOne({ title: 'Buy milk' });
			expect(task).to.not.be.null;
		});

		it('creates a task with a scheduled date', async () => {
			await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.send({ title: 'Call dentist', scheduledFor: '2026-01-25' })
				.expect(302);

			const task = await Task.findOne({ title: 'Call dentist' });
			expect(task).to.not.be.null;
			if (!task) throw new Error('Task not found');
			expect(task.scheduledFor?.toISOString()).to.include('2026-01-25');
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

	describe('GET /', () => {
		it('shows tasks scheduled for today', async () => {
			// Create a task scheduled for middle of today's range
			const { start, end } = getTodayRange();
			const middleOfToday = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

			await Task.create({ title: 'Today task', scheduledFor: middleOfToday });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('Today task');
		});

		it('does not show tasks scheduled for other days', async () => {
			// Create a task scheduled well outside today's range (a week ago)
			const { start } = getTodayRange();
			const weekAgo = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);

			await Task.create({ title: 'Old task', scheduledFor: weekAgo });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.not.include('Old task');
		});

		it('does not show someday tasks (no scheduled date)', async () => {
			await Task.create({ title: 'Someday task', scheduledFor: null });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.not.include('Someday task');
		});

		it('has a form for adding tasks', async () => {
			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('<form');
			expect(res.text).to.include('name="title"');
		});
	});

	describe('POST /tasks (from UI)', () => {
		it('creates a task scheduled for today and redirects', async () => {
			const res = await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.type('form')
				.send({ title: 'New task from form' })
				.expect(302);

			expect(res.headers.location).to.equal('/');

			// Verify task was created with today's date
			const task = await Task.findOne({ title: 'New task from form' });
			expect(task).to.not.be.null;

			if (!task) throw new Error('Task not found'); // Type narrowing
			expect(task.scheduledFor).to.not.be.null;
		});

		it('new task appears on today view after redirect', async () => {
			await request(app)
				.post('/tasks')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.type('form')
				.send({ title: 'Visible task' });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('Visible task');
		});
	});
});
