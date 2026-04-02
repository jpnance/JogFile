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
import Person from './models/Person.js';
import Chore from './models/Chore.js';
import Holiday from './models/Holiday.js';
import {
	getTodayRange,
	getTomorrowRange,
	getScheduleDate,
	formatDate,
	getLogicalToday,
	getPacificYmd,
	formatComingUpDayLabel,
	normalizeTimeOfDay,
	formatTaskTimeDisplay,
	isValidMonthDay,
	getNthWeekdayInMonth,
	sortHolidaysChronologically
} from './lib/dates.js';

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

/**
 * Get one scratch pad item eligible for advancement review.
 * Returns the oldest item that is 7+ days old and not currently snoozed.
 */
async function getScratchPadPrompt() {
	const now = new Date();
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	
	return Task.findOne({
		scheduledFor: null,
		status: 'pending',
		createdAt: { $lt: sevenDaysAgo },
		$or: [
			{ snoozedUntil: null },
			{ snoozedUntil: { $lte: now } }
		]
	}).sort({ createdAt: 1 });
}

/**
 * Get today's birthdays that haven't been acknowledged this year.
 */
async function getTodaysBirthdays() {
	const allPeople = await Person.find();
	const logicalTodayStr = getLogicalToday();
	const logicalTodayDate = new Date(logicalTodayStr + 'T12:00:00');
	const currentYear = logicalTodayDate.getFullYear();
	
	return allPeople.filter(person => {
		// @ts-ignore - Mongoose custom method
		return person.isBirthdayOn(logicalTodayDate) && person.lastAcknowledgedYear !== currentYear;
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
	const todaysBirthdays = await getTodaysBirthdays();
	const scratchPadPrompt = await getScratchPadPrompt();

	if (rolloverTasks.length === 0 && recurringPrompts.length === 0 && todaysBirthdays.length === 0 && !scratchPadPrompt) {
		return res.redirect('/');
	}

	// Calculate date strings for defer options
	const { start: tomorrowStart } = getTomorrowRange();
	const tomorrowDateStr = tomorrowStart.toISOString().split('T')[0];

	const today = new Date(tomorrowStart);
	today.setDate(today.getDate() - 1);
	const todayDayOfWeek = today.getDay();
	const daysUntilMonday = todayDayOfWeek === 0 ? 1 : 8 - todayDayOfWeek;
	const nextMonday = new Date(today);
	nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
	const nextWeekDateStr = nextMonday.toISOString().split('T')[0];

	const firstOfNextMonth = new Date(today);
	firstOfNextMonth.setMonth(firstOfNextMonth.getMonth() + 1);
	firstOfNextMonth.setDate(1);
	const nextMonthDateStr = firstOfNextMonth.toISOString().split('T')[0];

	res.render('advance', {
		rolloverTasks,
		recurringPrompts,
		todaysBirthdays,
		scratchPadPrompt,
		currentIndex: 0,
		formatDate,
		tomorrowDateStr,
		nextWeekDateStr,
		nextMonthDateStr
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
		url: recurring.url || '',
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
		url: recurring.url || '',
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

// Birthday advancement - acknowledge
app.post('/advance/birthday/:id/acknowledge', requireLogin, async (req, res) => {
	const person = await Person.findById(req.params.id);
	if (!person) {
		return res.status(404).send('Person not found');
	}

	const logicalTodayStr = getLogicalToday();
	const logicalTodayDate = new Date(logicalTodayStr + 'T12:00:00');
	person.lastAcknowledgedYear = logicalTodayDate.getFullYear();
	await person.save();

	res.redirect('/advance');
});

// Scratch pad advancement - schedule for today
app.post('/advance/scratchpad/:id/today', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start, end } = getTodayRange();
	const todayMiddle = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	task.scheduledFor = todayMiddle;
	task.snoozedUntil = null;
	await task.save();

	res.redirect('/advance');
});

// Scratch pad advancement - schedule for specific date
app.post('/advance/scratchpad/:id/defer', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const date = getScheduleDate(req.body.date);
	task.scheduledFor = date;
	task.snoozedUntil = null;
	await task.save();

	res.redirect('/advance');
});

// Scratch pad advancement - snooze (keep in scratch pad)
app.post('/advance/scratchpad/:id/snooze', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start } = getTodayRange();
	const snoozeDays = Math.floor(Math.random() * 6) + 5;
	task.snoozedUntil = new Date(start.getTime() + snoozeDays * 24 * 60 * 60 * 1000);
	await task.save();

	res.redirect('/advance');
});

// Scratch pad advancement - archive
app.post('/advance/scratchpad/:id/archive', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	task.status = 'archived';
	await task.save();

	res.redirect('/advance');
});

// Scratch pad advancement - edit (snooze first, then redirect to edit page)
app.post('/advance/scratchpad/:id/edit', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { start } = getTodayRange();
	const snoozeDays = Math.floor(Math.random() * 6) + 5;
	task.snoozedUntil = new Date(start.getTime() + snoozeDays * 24 * 60 * 60 * 1000);
	await task.save();

	res.redirect(`/tasks/${task._id}/edit`);
});

app.get('/', requireLogin, async (req, res) => {
	// Check for items that require advancement processing
	const rolloverTasks = await getRolloverTasks();
	const recurringPrompts = await getTodaysRecurringPrompts();
	const scratchPadPrompt = await getScratchPadPrompt();
	const todaysBirthdays = await getTodaysBirthdays();

	if (rolloverTasks.length > 0 || recurringPrompts.length > 0 || scratchPadPrompt || todaysBirthdays.length > 0) {
		return res.redirect('/advance');
	}

	const { start: todayStart, end: todayEnd } = getTodayRange();

	// Window: today through the next 6 days (7 calendar days); exclusive end for queries
	const weekWindowEnd = new Date(todayStart);
	weekWindowEnd.setDate(weekWindowEnd.getDate() + 7);

	// Today's tasks — chronological by time when set, else manual order (position)
	const tasks = await Task.find({
		scheduledFor: { $gte: todayStart, $lt: todayEnd },
		status: 'pending'
	}).sort({ position: 1 });
	tasks.sort((a, b) => {
		const ta = a.timeOfDay || '99:99';
		const tb = b.timeOfDay || '99:99';
		if (ta !== tb) return ta.localeCompare(tb);
		return (a.position ?? 0) - (b.position ?? 0);
	});

	// Pending tasks in the 7-day window (used to populate Coming up; today's bucket excluded there)
	const tasksInWeek = await Task.find({
		scheduledFor: { $gte: todayStart, $lt: weekWindowEnd },
		status: 'pending'
	}).sort({ scheduledFor: 1, position: 1 });

	/** @type {Map<string, any[]>} */
	const tasksByPacificYmd = new Map();
	for (const task of tasksInWeek) {
		const sf = task.scheduledFor;
		if (!sf) continue;
		const ymd = getPacificYmd(sf);
		let bucket = tasksByPacificYmd.get(ymd);
		if (!bucket) {
			bucket = [];
			tasksByPacificYmd.set(ymd, bucket);
		}
		bucket.push(task);
	}
	for (const arr of tasksByPacificYmd.values()) {
		arr.sort((a, b) => {
			const ta = a.timeOfDay || '99:99';
			const tb = b.timeOfDay || '99:99';
			if (ta !== tb) return ta.localeCompare(tb);
			return (a.position ?? 0) - (b.position ?? 0);
		});
	}

	// Later (beyond the 7-day window)
	const laterTasks = await Task.find({
		scheduledFor: { $gte: weekWindowEnd },
		status: 'pending'
	}).sort({ scheduledFor: 1, position: 1 });
	laterTasks.sort((a, b) => {
		const da =
			(a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0);
		if (da !== 0) return da;
		const ta = a.timeOfDay || '99:99';
		const tb = b.timeOfDay || '99:99';
		if (ta !== tb) return ta.localeCompare(tb);
		return (a.position ?? 0) - (b.position ?? 0);
	});

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

	const allPeople = await Person.find();
	const allHolidays = await Holiday.find().sort({ month: 1, day: 1, name: 1 });
	const logicalTodayStr = getLogicalToday();
	const logicalTodayDate = new Date(logicalTodayStr + 'T12:00:00');

	/** Today’s birthdays — shown above the task list (not in the Coming up grid). */
	const todayBirthdays = [];
	for (const person of allPeople) {
		// @ts-ignore - Mongoose method
		const nextBirthday = person.getNextBirthday();
		const diffTime = nextBirthday.getTime() - logicalTodayDate.getTime();
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		if (diffDays !== 0) continue;
		const hasNotes = Boolean(person.notes && String(person.notes).trim() !== '');
		todayBirthdays.push({
			person,
			hasNotes,
			// @ts-ignore - Mongoose method
			turningAge: person.getTurningAge(nextBirthday)
		});
	}
	todayBirthdays.sort((a, b) => String(a.person.name).localeCompare(String(b.person.name)));

	/** Today’s holidays — same strip pattern as birthdays; not in the Coming up grid. */
	const todayHolidays = [];
	for (const holiday of allHolidays) {
		// @ts-ignore - Mongoose method
		const nextOcc = holiday.getNextOccurrence();
		const diffTime = nextOcc.getTime() - logicalTodayDate.getTime();
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		if (diffDays !== 0) continue;
		const hasNotes = Boolean(holiday.notes && String(holiday.notes).trim() !== '');
		todayHolidays.push({ holiday, hasNotes });
	}
	todayHolidays.sort((a, b) => String(a.holiday.name).localeCompare(String(b.holiday.name)));

	/** Next 3 days (tomorrow through day after tomorrow): birthdays + holidays + dated tasks in the grid. */
	const comingUpDays = [];
	for (let offset = 1; offset < 4; offset++) {
		const dayDate = new Date(todayStart);
		dayDate.setDate(dayDate.getDate() + offset);
		const dayYmd = getPacificYmd(dayDate);

		/** @type {Array<{ kind: string, [key: string]: unknown }>} */
		const items = [];

		for (const person of allPeople) {
			// @ts-ignore - Mongoose method
			const nextBirthday = person.getNextBirthday();
			const diffTime = nextBirthday.getTime() - logicalTodayDate.getTime();
			const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
			if (diffDays !== offset) continue;
			const hasNotes = Boolean(person.notes && String(person.notes).trim() !== '');
			items.push({
				kind: 'birthday',
				person,
				hasNotes,
				// @ts-ignore - Mongoose method
				turningAge: person.getTurningAge(nextBirthday)
			});
		}

		for (const holiday of allHolidays) {
			// @ts-ignore - Mongoose method
			const nextOcc = holiday.getNextOccurrence();
			const diffTime = nextOcc.getTime() - logicalTodayDate.getTime();
			const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
			if (diffDays !== offset) continue;
			const hasNotes = Boolean(holiday.notes && String(holiday.notes).trim() !== '');
			items.push({ kind: 'holiday', holiday, hasNotes });
		}

		const dayTasks = tasksByPacificYmd.get(dayYmd) || [];
		for (const task of dayTasks) {
			items.push({ kind: 'task', task });
		}

		items.sort((a, b) => {
			/** @type {Record<string, number>} */
			const order = { birthday: 0, holiday: 1, task: 2 };
			const ao = order[a.kind] ?? 99;
			const bo = order[b.kind] ?? 99;
			if (ao !== bo) return ao - bo;
			if (a.kind === 'task' && b.kind === 'task') {
				// @ts-expect-error task payload from items.push above
				const ta = a.task.timeOfDay || '99:99';
				// @ts-expect-error
				const tb = b.task.timeOfDay || '99:99';
				if (ta !== tb) return ta.localeCompare(tb);
				// @ts-expect-error
				return ((a.task).position ?? 0) - ((b.task).position ?? 0);
			}
			if (a.kind === 'birthday' && b.kind === 'birthday') {
				// @ts-expect-error person on birthday item
				return String(a.person.name).localeCompare(String(b.person.name));
			}
			if (a.kind === 'holiday' && b.kind === 'holiday') {
				// @ts-expect-error holiday on item
				return String(a.holiday.name).localeCompare(String(b.holiday.name));
			}
			return 0;
		});

		comingUpDays.push({
			offset,
			label: formatComingUpDayLabel(offset, dayDate),
			items
		});
	}

	// Fetch chores for quick-add
	const chores = await Chore.find().sort({ title: 1 });

	res.render('today', {
		tasks,
		todayBirthdays,
		todayHolidays,
		laterTasks,
		scratchPadTasks,
		completedTasks,
		comingUpDays,
		chores,
		formatDate,
		formatTaskTimeDisplay
	});
});

app.post('/tasks', requireLogin, async (req, res) => {
	const { title, description, scheduledFor, destination, timeOfDay } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	// Determine the scheduled date
	let taskDate = null;
	let positionStart, positionEnd;
	const { start, end } = getTodayRange();
	const defaultDate = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	if (destination === 'scratch') {
		taskDate = null;
		positionStart = positionEnd = null;
	} else if (destination === 'tomorrow') {
		const { start: tomorrowStart, end: tomorrowEnd } = getTomorrowRange();
		taskDate = new Date(tomorrowStart.getTime() + (tomorrowEnd.getTime() - tomorrowStart.getTime()) / 2);
		positionStart = tomorrowStart;
		positionEnd = tomorrowEnd;
	} else if (scheduledFor) {
		taskDate = getScheduleDate(scheduledFor);
		positionStart = start;
		positionEnd = end;
	} else {
		taskDate = defaultDate;
		positionStart = start;
		positionEnd = end;
	}

	// Get the highest position for this day/scratch pad
	const positionQuery = taskDate
		? { scheduledFor: { $gte: positionStart, $lt: positionEnd }, status: 'pending' }
		: { scheduledFor: null, status: 'pending' };

	const lastTask = await Task.findOne(positionQuery).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	const task = new Task({
		title: title.trim(),
		description: description?.trim() || '',
		scheduledFor: taskDate,
		position: newPosition,
		timeOfDay: taskDate ? normalizeTimeOfDay(timeOfDay) : null
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
	task.timeOfDay = null;
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
	// Only set a date if it was originally a scheduled task (not scratch pad)
	if (task.scheduledFor !== null) {
		const { start, end } = getTodayRange();
		task.scheduledFor = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
	}
	await task.save();

	res.redirect('/');
});

app.get('/tasks/:id/edit', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id).populate('generatedFrom');
	if (!task) {
		return res.status(404).send('Task not found');
	}

	res.render('edit-task', { task, formatDate, formatTaskTimeDisplay });
});

app.post('/tasks/:id/edit', requireLogin, async (req, res) => {
	const task = await Task.findById(req.params.id);
	if (!task) {
		return res.status(404).send('Task not found');
	}

	const { title, description, url, scheduledFor, timeOfDay } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	task.title = title.trim();
	task.description = description?.trim() || '';
	task.url = url?.trim() || '';

	if (scheduledFor === '') {
		task.scheduledFor = null;
		task.timeOfDay = null;
	} else if (scheduledFor) {
		task.scheduledFor = getScheduleDate(scheduledFor);
		task.timeOfDay = normalizeTimeOfDay(timeOfDay);
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
	const { title, description, url, patternType, daysOfWeek, weeklyInterval, weeklyAnchor, dayOfMonth, yearlyMonth, yearlyDay, intervalDays } = req.body;

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
		url: url?.trim() || '',
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

	const { title, description, url, patternType, daysOfWeek, weeklyInterval, weeklyAnchor, dayOfMonth, yearlyMonth, yearlyDay, intervalDays, isActive, pausedUntil } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	recurring.title = title.trim();
	recurring.description = description?.trim() || '';
	recurring.url = url?.trim() || '';
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

app.post('/recurring/:id/create-task', requireLogin, async (req, res) => {
	const recurring = await Recurring.findById(req.params.id);
	if (!recurring) {
		return res.status(404).send('Recurring template not found');
	}

	const { start, end } = getTodayRange();
	const todayMiddle = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	const lastTask = await Task.findOne({
		scheduledFor: { $gte: start, $lt: end },
		status: 'pending'
	}).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	const task = new Task({
		title: recurring.title,
		description: recurring.description,
		url: recurring.url || '',
		scheduledFor: todayMiddle,
		position: newPosition,
		generatedFrom: recurring._id
	});
	await task.save();

	res.redirect('/');
});

// ============================================
// Birthday / People Routes
// ============================================

app.get('/birthdays', requireLogin, async (req, res) => {
	const people = await Person.find().sort({ birthMonth: 1, birthDay: 1, name: 1 });
	
	// Calculate upcoming birthdays (next 30 days)
	const today = new Date();
	today.setHours(12, 0, 0, 0);
	
	const upcoming = [];
	for (const person of people) {
		// @ts-ignore - Mongoose instance methods
		const nextBirthday = person.getNextBirthday();
		const diffTime = nextBirthday.getTime() - today.getTime();
		const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		
		if (daysUntil >= 0 && daysUntil <= 30) {
			upcoming.push({
				person,
				daysUntil,
				isToday: daysUntil === 0,
				// @ts-ignore - Mongoose instance methods
				turningAge: person.getTurningAge(nextBirthday)
			});
		}
	}
	upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
	
	// Group by month
	const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'];
	
	const byMonth = [];
	for (let m = 1; m <= 12; m++) {
		const monthPeople = people.filter(p => p.birthMonth === m);
		if (monthPeople.length > 0) {
			byMonth.push({ month: m, name: monthNames[m], people: monthPeople });
		}
	}
	
	res.render('birthdays', { upcoming, byMonth, totalCount: people.length });
});

app.get('/birthdays/new', requireLogin, (req, res) => {
	res.render('edit-birthday', { person: null });
});

app.post('/birthdays', requireLogin, async (req, res) => {
	const { name, birthMonth, birthDay, birthYear, notes } = req.body;
	
	await Person.create({
		name: name.trim(),
		birthMonth: parseInt(birthMonth, 10),
		birthDay: parseInt(birthDay, 10),
		birthYear: birthYear ? parseInt(birthYear, 10) : null,
		notes: notes || ''
	});
	
	res.redirect('/birthdays');
});

app.get('/birthdays/:id/edit', requireLogin, async (req, res) => {
	const person = await Person.findById(req.params.id);
	if (!person) {
		return res.status(404).send('Person not found');
	}
	res.render('edit-birthday', { person });
});

app.post('/birthdays/:id/edit', requireLogin, async (req, res) => {
	const person = await Person.findById(req.params.id);
	if (!person) {
		return res.status(404).send('Person not found');
	}
	
	const { name, birthMonth, birthDay, birthYear, notes } = req.body;
	
	person.name = name.trim();
	person.birthMonth = parseInt(birthMonth, 10);
	person.birthDay = parseInt(birthDay, 10);
	person.birthYear = birthYear ? parseInt(birthYear, 10) : null;
	person.notes = notes || '';
	
	await person.save();
	res.redirect('/birthdays');
});

app.post('/birthdays/:id/delete', requireLogin, async (req, res) => {
	await Person.findByIdAndDelete(req.params.id);
	res.redirect('/birthdays');
});

// ============================================
// Holidays (annual — fixed date or nth weekday in month; not Recurring)
// ============================================

/**
 * @param {import('express').Request} req
 * @returns {{ recurrenceType: 'fixed' | 'nth_weekday', name: string, month: number, day: number | null, weekday: number | null, weekOrdinal: number | null, notes: string }}
 */
function parseHolidayBody(req) {
	const recurrenceType = req.body.recurrenceType === 'nth_weekday' ? 'nth_weekday' : 'fixed';
	const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
	const month = parseInt(req.body.month, 10);
	const notes = typeof req.body.notes === 'string' ? req.body.notes : '';

	if (recurrenceType === 'fixed') {
		const day = parseInt(req.body.day, 10);
		return { recurrenceType, name, month, day, weekday: null, weekOrdinal: null, notes };
	}

	const weekday = parseInt(req.body.weekday, 10);
	const weekOrdinal = parseInt(req.body.weekOrdinal, 10);
	return { recurrenceType, name, month, day: null, weekday, weekOrdinal, notes };
}

/**
 * @param {{ recurrenceType: string, name: string, month: number, day: number | null, weekday: number | null, weekOrdinal: number | null }} p
 * @returns {string | null} error message or null
 */
function validateHolidayPayload(p) {
	if (!p.name) {
		return 'Name is required';
	}
	if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12) {
		return 'Invalid month';
	}

	if (p.recurrenceType === 'fixed') {
		if (!Number.isInteger(p.day) || p.day === null || !isValidMonthDay(p.month, p.day)) {
			return 'Invalid month and day';
		}
		return null;
	}

	if (!Number.isInteger(p.weekday) || p.weekday === null || p.weekday < 0 || p.weekday > 6) {
		return 'Invalid weekday';
	}
	if (p.weekOrdinal === null || ![1, 2, 3, 4, -1].includes(p.weekOrdinal)) {
		return 'Invalid week';
	}
	const probe = getNthWeekdayInMonth(2025, p.month, p.weekday, p.weekOrdinal);
	if (!probe) {
		return 'That weekday does not occur that many times in the chosen month';
	}

	return null;
}

app.get('/holidays', requireLogin, async (req, res) => {
	const holidays = sortHolidaysChronologically(await Holiday.find());

	const today = new Date();
	today.setHours(12, 0, 0, 0);

	const upcoming = [];
	for (const holiday of holidays) {
		// @ts-ignore - Mongoose method
		const nextOcc = holiday.getNextOccurrence();
		const diffTime = nextOcc.getTime() - today.getTime();
		const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

		if (daysUntil >= 0 && daysUntil <= 30) {
			upcoming.push({
				holiday,
				daysUntil,
				isToday: daysUntil === 0
			});
		}
	}
	upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

	const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'];

	const byMonth = [];
	for (let m = 1; m <= 12; m++) {
		const monthHolidays = holidays.filter(
			/** @param {{ month: number }} h */ h => h.month === m
		);
		if (monthHolidays.length > 0) {
			byMonth.push({ month: m, name: monthNames[m], holidays: monthHolidays });
		}
	}

	res.render('holidays', { upcoming, byMonth, totalCount: holidays.length });
});

app.get('/holidays/new', requireLogin, (req, res) => {
	res.render('edit-holiday', { holiday: null });
});

app.post('/holidays', requireLogin, async (req, res) => {
	const p = parseHolidayBody(req);
	const err = validateHolidayPayload(p);
	if (err) {
		return res.status(400).send(err);
	}

	await Holiday.create({
		name: p.name,
		recurrenceType: p.recurrenceType,
		month: p.month,
		day: p.recurrenceType === 'fixed' ? p.day : null,
		weekday: p.recurrenceType === 'nth_weekday' ? p.weekday : null,
		weekOrdinal: p.recurrenceType === 'nth_weekday' ? p.weekOrdinal : null,
		notes: p.notes || ''
	});

	res.redirect('/holidays');
});

app.get('/holidays/:id/edit', requireLogin, async (req, res) => {
	const holiday = await Holiday.findById(req.params.id);
	if (!holiday) {
		return res.status(404).send('Holiday not found');
	}
	res.render('edit-holiday', { holiday });
});

app.post('/holidays/:id/edit', requireLogin, async (req, res) => {
	const holiday = await Holiday.findById(req.params.id);
	if (!holiday) {
		return res.status(404).send('Holiday not found');
	}

	const p = parseHolidayBody(req);
	const verr = validateHolidayPayload(p);
	if (verr) {
		return res.status(400).send(verr);
	}

	holiday.name = p.name;
	holiday.recurrenceType = p.recurrenceType;
	holiday.month = p.month;
	holiday.notes = p.notes || '';
	if (p.recurrenceType === 'fixed') {
		holiday.day = p.day;
		holiday.weekday = null;
		holiday.weekOrdinal = null;
	} else {
		holiday.day = null;
		holiday.weekday = p.weekday;
		holiday.weekOrdinal = p.weekOrdinal;
	}

	await holiday.save();
	res.redirect('/holidays');
});

app.post('/holidays/:id/delete', requireLogin, async (req, res) => {
	await Holiday.findByIdAndDelete(req.params.id);
	res.redirect('/holidays');
});

// Chore Routes
app.get('/chores', requireLogin, async (req, res) => {
	const chores = await Chore.find().sort({ title: 1 });
	res.render('chores', { chores });
});

app.get('/chores/new', requireLogin, (req, res) => {
	res.render('edit-chore', { chore: null });
});

app.post('/chores', requireLogin, async (req, res) => {
	const { title, description, url } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	const chore = new Chore({
		title: title.trim(),
		description: description?.trim() || '',
		url: url?.trim() || ''
	});

	await chore.save();
	res.redirect('/chores');
});

app.get('/chores/:id/edit', requireLogin, async (req, res) => {
	const chore = await Chore.findById(req.params.id);
	if (!chore) {
		return res.status(404).send('Chore not found');
	}
	res.render('edit-chore', { chore });
});

app.post('/chores/:id/edit', requireLogin, async (req, res) => {
	const chore = await Chore.findById(req.params.id);
	if (!chore) {
		return res.status(404).send('Chore not found');
	}

	const { title, description, url } = req.body;

	chore.title = title.trim();
	chore.description = description?.trim() || '';
	chore.url = url?.trim() || '';

	await chore.save();
	res.redirect('/chores');
});

app.post('/chores/:id/delete', requireLogin, async (req, res) => {
	await Chore.findByIdAndDelete(req.params.id);
	res.redirect('/chores');
});

app.post('/chores/:id/create-task', requireLogin, async (req, res) => {
	const chore = await Chore.findById(req.params.id);
	if (!chore) {
		return res.status(404).send('Chore not found');
	}

	const { destination, scheduledFor } = req.body;

	let taskDate = null;
	let positionStart, positionEnd;
	const { start, end } = getTodayRange();

	if (destination === 'tomorrow') {
		const { start: tomorrowStart, end: tomorrowEnd } = getTomorrowRange();
		taskDate = new Date(tomorrowStart.getTime() + (tomorrowEnd.getTime() - tomorrowStart.getTime()) / 2);
		positionStart = tomorrowStart;
		positionEnd = tomorrowEnd;
	} else if (destination === 'date' && scheduledFor) {
		taskDate = getScheduleDate(scheduledFor);
		positionStart = start;
		positionEnd = end;
	} else {
		taskDate = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
		positionStart = start;
		positionEnd = end;
	}

	const positionQuery = { scheduledFor: { $gte: positionStart, $lt: positionEnd }, status: 'pending' };
	const lastTask = await Task.findOne(positionQuery).sort({ position: -1 });
	const newPosition = lastTask ? lastTask.position + 1 : 0;

	const task = new Task({
		title: chore.title,
		description: chore.description,
		url: chore.url,
		scheduledFor: taskDate,
		position: newPosition
	});

	await task.save();
	res.redirect('/');
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
