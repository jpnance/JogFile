import mongoose from 'mongoose';

const quickListSchema = new mongoose.Schema({
	name: { type: String, required: true },
	items: [{
		text: { type: String, required: true }
	}],
	position: { type: Number, default: 0 },
	createdAt: { type: Date, default: Date.now }
});

const QuickList = mongoose.model('QuickList', quickListSchema);

export default QuickList;
