import 'dotenv/config';

import fs from 'fs';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import { attachSession, requireLogin } from './auth/middleware.js';
import Task from './models/Task.js';
import { getTodayRange } from './lib/dates.js';

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

app.get('/', requireLogin, async (req, res) => {
	const { start, end } = getTodayRange();

	const tasks = await Task.find({
		scheduledFor: { $gte: start, $lt: end },
		status: 'pending'
	}).sort({ position: 1 });

	res.render('today', { tasks });
});

app.post('/tasks', requireLogin, async (req, res) => {
	const { title, description, scheduledFor } = req.body;

	if (!title || title.trim() === '') {
		return res.status(400).send('Title is required');
	}

	// Default to middle of today if no date specified
	const { start, end } = getTodayRange();
	const defaultDate = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);

	const task = new Task({
		title: title.trim(),
		description: description?.trim() || '',
		scheduledFor: scheduledFor ? new Date(scheduledFor) : defaultDate
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
