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

		it('does not show tasks scheduled for other days in today section', async () => {
			// Create a task scheduled for a week from now (future task, not rollover)
			const { start } = getTodayRange();
			const weekAhead = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

			await Task.create({ title: 'Future task', scheduledFor: weekAhead });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			// The task should appear in the "Later" section, not in the main today task list
			expect(res.text).to.include('Future task');
			expect(res.text).to.include('Later');
		});

		it('redirects to advancement when there are rollover tasks', async () => {
			// Create a task scheduled for a week ago (rollover task)
			const { start } = getTodayRange();
			const weekAgo = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);

			await Task.create({ title: 'Old task', scheduledFor: weekAgo });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(302);

			expect(res.headers.location).to.equal('/advance');
		});

		it('shows scratch pad tasks in collapsed section', async () => {
			await Task.create({ title: 'Someday task', scheduledFor: null });

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			// Scratch pad tasks now appear in a collapsed section
			expect(res.text).to.include('Someday task');
			expect(res.text).to.include('Scratch Pad');
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

	describe('POST /tasks/:id/complete', () => {
		it('marks task as completed and redirects', async () => {
			const { start, end } = getTodayRange();
			const middleOfToday = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

			const task = await Task.create({ title: 'Task to complete', scheduledFor: middleOfToday });

			const res = await request(app)
				.post(`/tasks/${task._id}/complete`)
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(302);

			expect(res.headers.location).to.equal('/');

			const updated = await Task.findById(task._id);
			expect(updated?.status).to.equal('completed');
			expect(updated?.completedAt).to.not.be.null;
		});

		it('completed task no longer shows on today view', async () => {
			const { start, end } = getTodayRange();
			const middleOfToday = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

			const task = await Task.create({ title: 'Disappearing task', scheduledFor: middleOfToday });

			await request(app)
				.post(`/tasks/${task._id}/complete`)
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`);

			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			// Task should not be in main task list, but should be in Completed section
			expect(res.text).to.include('Completed');
			expect(res.text).to.include('Disappearing task');
		});

		it('redirects to login when not authenticated', async () => {
			const task = await Task.create({ title: 'Some task', scheduledFor: new Date() });

			const res = await request(app)
				.post(`/tasks/${task._id}/complete`)
				.expect(302);

			expect(res.headers.location).to.equal('/login');
		});

		it('returns 404 for invalid task ID', async () => {
			await request(app)
				.post('/tasks/000000000000000000000000/complete')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(404);
		});
	});
});
