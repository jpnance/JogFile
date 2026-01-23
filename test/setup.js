import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/** @type {MongoMemoryServer | undefined} */
let mongoServer;

export async function connectTestDb() {
	mongoServer = await MongoMemoryServer.create();
	const uri = mongoServer.getUri();
	await mongoose.connect(uri);
}

export async function disconnectTestDb() {
	await mongoose.disconnect();
	if (mongoServer) {
		await mongoServer.stop();
	}
}

export async function clearTestDb() {
	const collections = mongoose.connection.collections;
	for (const key in collections) {
		await collections[key].deleteMany({});
	}
}
