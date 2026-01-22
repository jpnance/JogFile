import { expect } from 'chai';
import request from 'supertest';
import app from '../index.js';

describe('App', () => {
	describe('GET /', () => {
		it('returns 200 and a response', async () => {
			const res = await request(app)
				.get('/')
				.expect(200);

			expect(res.text).to.equal('JogFile');
		});
	});
});
