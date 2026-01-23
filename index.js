import 'dotenv/config';

import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

import { attachSession, requireLogin } from './auth/middleware.js';

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

app.get('/', requireLogin, (req, res) => {
	res.send('JogFile - You are logged in!');
});

const port = process.env.PORT || 3000;

// Only start the server if this file is run directly (not imported by tests)
if (process.argv[1].includes('index.js')) {
	app.listen(port, () => {
		console.log(`JogFile listening on port ${port}`);
	});
}

export default app;
