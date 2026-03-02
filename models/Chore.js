import mongoose from 'mongoose';

const choreSchema = new mongoose.Schema({
	title: { type: String, required: true },
	description: { type: String, default: '' },
	url: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now }
});

const Chore = mongoose.model('Chore', choreSchema);

export default Chore;
