import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';

describe('App', () => {
	describe('GET /', () => {
		it('redirects to /login when not authenticated', async () => {
			const res = await request(app)
				.get('/')
				.expect(302);

			expect(res.headers.location).to.equal('/login');
		});

		it('returns 200 when authenticated', async () => {
			const res = await request(app)
				.get('/')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(200);

			expect(res.text).to.include('logged in');
		});
	});

	describe('GET /login', () => {
		it('shows login page when not authenticated', async () => {
			const res = await request(app)
				.get('/login')
				.expect(200);

			expect(res.text).to.include('Password');
		});

		it('redirects to / when already authenticated', async () => {
			const res = await request(app)
				.get('/login')
				.set('Cookie', `session=${process.env.JOG_FILE_PASSWORD}`)
				.expect(302);

			expect(res.headers.location).to.equal('/');
		});
	});

	describe('POST /login', () => {
		it('sets cookie and redirects on correct password', async () => {
			const res = await request(app)
				.post('/login')
				.send({ password: process.env.JOG_FILE_PASSWORD })
				.expect(302);

			expect(res.headers.location).to.equal('/');
			expect(res.headers['set-cookie'][0]).to.include('session=');
		});

		it('shows error on wrong password', async () => {
			const res = await request(app)
				.post('/login')
				.send({ password: 'wrong' })
				.expect(200);

			expect(res.text).to.include('Invalid password');
		});
	});
});
