import 'dotenv/config';

import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.set('view engine', 'pug');

app.get('/', (req, res) => {
	res.send('JogFile');
});

const port = process.env.PORT || 3000;

// Only start the server if this file is run directly (not imported by tests)
if (process.argv[1].includes('index.js')) {
	app.listen(port, () => {
		console.log(`JogFile listening on port ${port}`);
	});
}

export default app;
