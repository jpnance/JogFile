/**
 * Checks if the session cookie matches the password.
 * Attaches `res.locals.authenticated` boolean for use in routes and templates.
 * Always calls next() — doesn't block unauthenticated users.
 * Use on all routes via app.use().
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function attachSession(req, res, next) {
	res.locals.authenticated = req.cookies?.session === process.env.JOG_FILE_PASSWORD;
	next();
}

/**
 * Requires authentication. Redirects to /login if not authenticated.
 * Use on specific routes: app.get('/today', requireLogin, handler)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireLogin(req, res, next) {
	if (!res.locals.authenticated) {
		return res.redirect('/login');
	}
	next();
}
