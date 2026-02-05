import 'dotenv/config';

import fs from 'fs';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { attachSession, requireLogin } from './auth/middleware.js';
import Task from './models/Task.js';
import Recurring from './models/Recurring.js';
import { getTodayRange, getTomorrowRange, getScheduleDate, formatDate, formatToday, getLogicalToday } from './lib/dates.js';

/**
 * Get all pending tasks scheduled before today (rollover tasks).
 */
async function getRolloverTasks() {
	const { start } = getTodayRange();
	return Task.find({
		scheduledFor: { $lt: start, $ne: null },
		status: 'pending'
	}).sort({ scheduledFor: 1, createdAt: 1 });
}

/**
 * Get all recurring templates that are scheduled for today and haven't been processed yet.
 */
async function getTodaysRecurringPrompts() {
	const { start } = getTodayRange();
	const allRecurring = await Recurring.find({ isActive: true });
	
	return allRecurring.filter(rec => {
		// Check if scheduled for today
		// @ts-ignore - isScheduledFor is a Mongoose method defined on the schema
		if (!rec.isScheduledFor(start)) return false;
		
		// Check if already processed today (lastGeneratedFor is today or later)
		if (rec.lastGeneratedFor && rec.lastGeneratedFor >= start) return false;
		
		return true;
	});
}

const app = express();

// Static files
app.use(express.static('public'));
app.use('/css', express.static('node_modules/bootstrap/dist/css'));
app.use('/js', express.static('node_modules/bootstrap/dist/js'));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachSession);

// Views
app.set('view engine', 'pug');

// Routes
app.get('/login', (req, res) => {
	if (res.locals.authenticated) {
		return res.redirect('/');
	}
	res.render('login');
});

app.post('/login', (req, res) => {
	if (req.body.password === process.env.JOG_FILE_PASSWORD) {
		res.cookie('session', req.body.password, {
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year
		});
		return res.redirect('/');
	}
	res.render('login', { error: 'Invalid password' });
});

app.post('/logout', (req, res) => {
	res.clearCookie('session');
	res.redirect('/login');
});

// Advancement routes
app.get('/advance', requireLogin, async (req, res) => {
	const rolloverTasks = await getRolloverTasks();
	const recurringPrompts = await getTodaysRecurringPrompts();

	if (rolloverTasks.length === 0 && recurringPrompts.length === 0) {
		return res.redirect('/');
	}

	// Calculate tomorrow's date for the shortcut button
	const { start: tomorrowStart } = getTomorrowRange();
	const tomorrowDateStr = tomorrowStart.toISOString().split('T')[0];

	res.render('advance', {
		rolloverTasks,
		recurringPrompts,
		currentIndex: 0,
		formatDate,
		tomorrowDateStr
	});
});

app.post('/advance/:id/complete', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'completed';
	task.completedAt = new Date();
	await task.save();

	res.redirect('/advance');
});

app.post('/advance/:id/today', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start, end } = getTodayRange();
	task.scheduledFor = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	task.rollovers = (task.rollovers || 0) + 1;
	task.lastRolloverDate = new Date();
	await task.save();

	res.redirect('/advance');
});

app.post('/advance/:id/defer', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	if (!req.body.date) {
		return res.status(400).send('Date is required');
	}

	task.scheduledFor = getScheduleDate(req.body.date);
	task.rollovers = (task.rollovers || 0) + 1;
	task.lastRolloverDate = new Date();
	await task.save();

	res.redirect('/advance');
});

app.post('/advance/:id/scratch', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.scheduledFor = null;
	await task.save();

	res.redirect('/advance');
});

app.post('/advance/:id/archive', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'archived';
	await task.save();

	res.redirect('/advance');
});

app.post('/advance/bankruptcy', requireLogin, async (req, res) => {
	const rolloverTasks = await getRolloverTasks();

	for (const task of rolloverTasks) {
		task.status = 'archived';
		await task.save();
	}

	res.redirect('/');
});

app.post('/advance/best-guess', requireLogin, async (req, res) => {
	const rolloverTasks = await getRolloverTasks();
	const { start, end } = getTodayRange();
	const todayMiddle = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	for (const task of rolloverTasks) {
		task.scheduledFor = todayMiddle;
		task.rollovers = (task.rollovers || 0) + 1;
		task.lastRolloverDate = new Date();
		await task.save();
	}

	res.redirect('/');
});

// Recurring prompt actions in advancement
app.post('/advance/recurring/:id/today', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	const { start, end } = getTodayRange();
	const todayMiddle = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	// Get the highest position for today
	const lastTask = await Task.findOne({
		scheduledFor: { $gte: start, $lt: end },
		status: 'pending'
	}).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	// Create task from recurring template
	const task = new Task({
		title: recurring.title,
		description: recurring.description,
		scheduledFor: todayMiddle,
		position: newPosition,
		generatedFrom: recurring._id
	});
	await task.save();

	// Mark as processed for today
	recurring.lastGeneratedFor = start;
	await recurring.save();

	res.redirect('/advance');
});

app.post('/advance/recurring/:id/defer', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	if (!req.body.date) {
		return res.status(400).send('Date is required');
	}

	const scheduledDate = getScheduleDate(req.body.date);
	const { start } = getTodayRange();

	// Get the highest position for that day
	const dayStart = new Date(scheduledDate);
	dayStart.setHours(4, 0, 0, 0);
	const dayEnd = new Date(dayStart);
	dayEnd.setDate(dayEnd.getDate() + 1);

	const lastTask = await Task.findOne({
		scheduledFor: { $gte: dayStart, $lt: dayEnd },
		status: 'pending'
	}).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	// Create task from recurring template
	const task = new Task({
		title: recurring.title,
		description: recurring.description,
		scheduledFor: scheduledDate,
		position: newPosition,
		generatedFrom: recurring._id
	});
	await task.save();

	// Mark as processed for today
	recurring.lastGeneratedFor = start;
	await recurring.save();

	res.redirect('/advance');
});

app.post('/advance/recurring/:id/skip', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	const { start } = getTodayRange();

	// Mark as processed for today (skipped, no task created)
	recurring.lastGeneratedFor = start;
	await recurring.save();

	res.redirect('/advance');
});

app.get('/', requireLogin, async (req, res) => {
	// Check for rollover tasks and recurring prompts first
	const rolloverTasks = await getRolloverTasks();
	const recurringPrompts = await getTodaysRecurringPrompts();
	if (rolloverTasks.length > 0 || recurringPrompts.length > 0) {
		return res.redirect('/advance');
	}

	const { start: todayStart, end: todayEnd } = getTodayRange();
	const { start: tomorrowStart, end: tomorrowEnd } = getTomorrowRange();

	// Calculate date ranges
	const next7DaysEnd = new Date(todayStart);
	next7DaysEnd.setDate(next7DaysEnd.getDate() + 7);

	// Today's tasks
	const tasks = await Task.find({
		scheduledFor: { $gte: todayStart, $lt: todayEnd },
		status: 'pending'
	}).sort({ position: 1 });

	// Tomorrow's tasks
	const tomorrowTasks = await Task.find({
		scheduledFor: { $gte: tomorrowStart, $lt: tomorrowEnd },
		status: 'pending'
	}).sort({ position: 1 });

	// Next 7 days (excluding today and tomorrow)
	const upcomingTasks = await Task.find({
		scheduledFor: { $gte: tomorrowEnd, $lt: next7DaysEnd },
		status: 'pending'
	}).sort({ scheduledFor: 1, position: 1 });

	// Later (beyond 7 days)
	const laterTasks = await Task.find({
		scheduledFor: { $gte: next7DaysEnd },
		status: 'pending'
	}).sort({ scheduledFor: 1, position: 1 });

	// Scratch pad (no date)
	const scratchPadTasks = await Task.find({
		scheduledFor: null,
		status: 'pending'
	}).sort({ position: 1 });

	// Recently completed tasks (last 7 days, max 20)
	const sevenDaysAgo = new Date(todayStart);
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
	const completedTasks = await Task.find({
		status: 'completed',
		completedAt: { $ne: null, $gte: sevenDaysAgo }
	}).sort({ completedAt: -1 }).limit(20);

	res.render('today', {
		tasks,
		tomorrowTasks,
		upcomingTasks,
		laterTasks,
		scratchPadTasks,
		completedTasks,
		formatDate,
		todayFormatted: formatToday()
	});
});

app.post('/tasks', requireLogin, async (req, res) => {
	const { title, description, scheduledFor, destination } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	// Determine the scheduled date
	let taskDate = null;
	const { start, end } = getTodayRange();
	const defaultDate = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	if (destination === 'scratch') {
		taskDate = null;
	} else if (scheduledFor) {
		taskDate = getScheduleDate(scheduledFor);
	} else {
		taskDate = defaultDate;
	}

	// Get the highest position for this day/scratch pad
	const positionQuery = taskDate
		? { scheduledFor: { $gte: start, $lt: end }, status: 'pending' }
		: { scheduledFor: null, status: 'pending' };

	const lastTask = await Task.findOne(positionQuery).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	const task = new Task({
		title: title.trim(),
		description: description?.trim() || '',
		scheduledFor: taskDate,
		position: newPosition
	});

	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/complete', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);

	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'completed';
	task.completedAt = new Date();
	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/today', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start, end } = getTodayRange();
	task.scheduledFor = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/tomorrow', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start, end } = getTomorrowRange();
	task.scheduledFor = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/scratch', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.scheduledFor = null;
	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/archive', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'archived';
	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/restore', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'pending';
	// Put it back on today's list
	const { start, end } = getTodayRange();
	task.scheduledFor = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	await task.save();

	res.redirect('/');
});

app.get('/tasks/:id/edit', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	res.render('edit-task', { task, formatDate });
});

app.post('/tasks/:id/edit', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { title, description, scheduledFor } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	task.title = title.trim();
	task.description = description?.trim() || '';

	if (scheduledFor === '') {
		task.scheduledFor = null;
	} else if (scheduledFor) {
		task.scheduledFor = getScheduleDate(scheduledFor);
	}

	await task.save();

	res.redirect('/');
});

app.post('/tasks/:id/move-up', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	// Find the task scheduled for the same day with the next lower position
	const { start, end } = getTodayRange();
	let query;

	if (task.scheduledFor) {
		// For dated tasks, find tasks on the same day
		const taskDayStart = new Date(task.scheduledFor);
		taskDayStart.setHours(4, 0, 0, 0);
		const taskDayEnd = new Date(taskDayStart);
		taskDayEnd.setDate(taskDayEnd.getDate() + 1);

		query = {
			scheduledFor: { $gte: taskDayStart, $lt: taskDayEnd },
			status: 'pending',
			position: { $lt: task.position }
		};
	} else {
		// For scratch pad tasks
		query = {
			scheduledFor: null,
			status: 'pending',
			position: { $lt: task.position }
		};
	}

	const taskAbove = await Task.findOne(query).sort({ position: -1 });

	if (taskAbove) {
		const tempPosition = task.position;
		task.position = taskAbove.position;
		taskAbove.position = tempPosition;
		await task.save();
		await taskAbove.save();
	}

	res.redirect('back');
});

app.post('/tasks/:id/move-down', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	// Find the task scheduled for the same day with the next higher position
	let query;

	if (task.scheduledFor) {
		// For dated tasks, find tasks on the same day
		const taskDayStart = new Date(task.scheduledFor);
		taskDayStart.setHours(4, 0, 0, 0);
		const taskDayEnd = new Date(taskDayStart);
		taskDayEnd.setDate(taskDayEnd.getDate() + 1);

		query = {
			scheduledFor: { $gte: taskDayStart, $lt: taskDayEnd },
			status: 'pending',
			position: { $gt: task.position }
		};
	} else {
		// For scratch pad tasks
		query = {
			scheduledFor: null,
			status: 'pending',
			position: { $gt: task.position }
		};
	}

	const taskBelow = await Task.findOne(query).sort({ position: 1 });

	if (taskBelow) {
		const tempPosition = task.position;
		task.position = taskBelow.position;
		taskBelow.position = tempPosition;
		await task.save();
		await taskBelow.save();
	}

	res.redirect('back');
});

// Recurring template management routes
app.get('/recurring', requireLogin, async (req, res) => {
	const allRecurring = await Recurring.find().sort({ title: 1 });
	
	// Group by pattern type
	const daily = allRecurring.filter(r => r.pattern?.type === 'daily');
	const weekly = allRecurring.filter(r => r.pattern?.type === 'weekly');
	const monthly = allRecurring.filter(r => r.pattern?.type === 'monthly');
	const yearly = allRecurring.filter(r => r.pattern?.type === 'yearly');
	const interval = allRecurring.filter(r => r.pattern?.type === 'interval');
	
	res.render('recurring', { 
		groups: [
			{ name: 'Daily', type: 'daily', items: daily },
			{ name: 'Weekly', type: 'weekly', items: weekly },
			{ name: 'Monthly', type: 'monthly', items: monthly },
			{ name: 'Yearly', type: 'yearly', items: yearly },
			{ name: 'Every N Days', type: 'interval', items: interval }
		],
		totalCount: allRecurring.length
	});
});

app.get('/recurring/new', requireLogin, (req, res) => {
	res.render('edit-recurring', { recurring: null, getLogicalToday });
});

app.post('/recurring', requireLogin, async (req, res) => {
	const { title, description, patternType, daysOfWeek, weeklyInterval, weeklyAnchor, dayOfMonth, yearlyMonth, yearlyDay, intervalDays } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	/** @type {{type: string, daysOfWeek?: number[], weeklyInterval?: number, weeklyAnchor?: Date, dayOfMonth?: number, yearlyMonth?: number, yearlyDay?: number, intervalDays?: number, intervalAnchor?: Date}} */
	const pattern = { type: patternType };

	switch (patternType) {
		case 'weekly':
			// daysOfWeek comes as an array of strings or a single string
			pattern.daysOfWeek = Array.isArray(daysOfWeek)
				? daysOfWeek.map(Number)
				: daysOfWeek ? [Number(daysOfWeek)] : [];
			pattern.weeklyInterval = Number(weeklyInterval) || 1;
			if (pattern.weeklyInterval > 1) {
				pattern.weeklyAnchor = weeklyAnchor ? getScheduleDate(weeklyAnchor) : new Date();
			}
			break;
		case 'monthly':
			pattern.dayOfMonth = Number(dayOfMonth);
			break;
		case 'yearly':
			pattern.yearlyMonth = Number(yearlyMonth);
			pattern.yearlyDay = Number(yearlyDay);
			break;
		case 'interval':
			pattern.intervalDays = Number(intervalDays);
			pattern.intervalAnchor = new Date();
			break;
	}

	const recurring = new Recurring({
		title: title.trim(),
		description: description?.trim() || '',
		pattern
	});

	await recurring.save();
	res.redirect('/recurring');
});

app.get('/recurring/:id/edit', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	res.render('edit-recurring', { recurring, getLogicalToday });
});

app.post('/recurring/:id/edit', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	const { title, description, patternType, daysOfWeek, weeklyInterval, weeklyAnchor, dayOfMonth, yearlyMonth, yearlyDay, intervalDays, isActive, pausedUntil } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	recurring.title = title.trim();
	recurring.description = description?.trim() || '';
	recurring.isActive = isActive === 'on' || isActive === 'true';

	if (pausedUntil) {
		recurring.pausedUntil = getScheduleDate(pausedUntil);
	} else {
		recurring.pausedUntil = null;
	}

	if (recurring.pattern) {
		recurring.pattern.type = patternType;

		switch (patternType) {
			case 'weekly':
				recurring.pattern.daysOfWeek = Array.isArray(daysOfWeek)
					? daysOfWeek.map(Number)
					: daysOfWeek ? [Number(daysOfWeek)] : [];
				recurring.pattern.weeklyInterval = Number(weeklyInterval) || 1;
				if (recurring.pattern.weeklyInterval > 1) {
					if (weeklyAnchor) {
						recurring.pattern.weeklyAnchor = getScheduleDate(weeklyAnchor);
					} else if (!recurring.pattern.weeklyAnchor) {
						recurring.pattern.weeklyAnchor = new Date();
					}
				}
				break;
			case 'monthly':
				recurring.pattern.dayOfMonth = Number(dayOfMonth);
				break;
			case 'yearly':
				recurring.pattern.yearlyMonth = Number(yearlyMonth);
				recurring.pattern.yearlyDay = Number(yearlyDay);
				break;
			case 'interval':
				recurring.pattern.intervalDays = Number(intervalDays);
				if (!recurring.pattern.intervalAnchor) {
					recurring.pattern.intervalAnchor = new Date();
				}
				break;
		}
	}

	await recurring.save();
	res.redirect('/recurring');
});

app.post('/recurring/:id/delete', requireLogin, async (req, res) => {
	await Recurring.findByIdAndDelete(req.params.id);
	res.redirect('/recurring');
});

app.post('/recurring/:id/pause', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	if (req.body.pausedUntil) {
		recurring.pausedUntil = getScheduleDate(req.body.pausedUntil);
	}

	await recurring.save();
	res.redirect('/recurring');
});

app.post('/recurring/:id/resume', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	recurring.pausedUntil = null;
	await recurring.save();

	res.redirect('/recurring');
});

const port = process.env.PORT || 3000;

/** @type {import('http').Server | import('https').Server | null} */
let server = null;

// Only start the server if this file is run directly (not imported by tests)
if (process.argv[1].includes('index.js')) {
	if (!process.env.MONGODB_URI) {
		throw new Error('MONGODB_URI environment variable is required');
	}

	mongoose.connect(process.env.MONGODB_URI);

	if (process.env.NODE_ENV === 'dev') {
		const options = {
			key: fs.readFileSync('./ssl/jogfile-key.pem'),
			cert: fs.readFileSync('./ssl/jogfile.pem'),
			requestCert: false
		};

		server = https.createServer(options, app);
		server.listen(port, () => {
			console.log(`JogFile listening on https://localhost:${port}`);
		});
	}
	else {
		server = app.listen(port, () => {
			console.log(`JogFile listening on port ${port}`);
		});
	}
}

process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down...');

	if (server) {
		server.close(() => {
			mongoose.connection.close(false).then(() => {
				console.log('Closed out remaining connections');
				process.exit(0);
			});
		});
	}
	else {
		process.exit(0);
	}
});

export default app;
