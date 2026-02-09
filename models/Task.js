import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
	title: { type: String, required: true },
	description: { type: String, default: '' },
	url: { type: String, default: '' },  // Quick-action URL for this task
	checklist: [{
		text: { type: String, required: true },
		done: { type: Boolean, default: false }
	}],
	scheduledFor: { type: Date, default: null },
	status: {
		type: String,
		enum: ['pending', 'completed', 'archived'],
		default: 'pending'
	},
	position: { type: Number, default: 0 },
	createdAt: { type: Date, default: Date.now },
	completedAt: { type: Date, default: null },
	rollovers: { type: Number, default: 0 },
	lastRolloverDate: { type: Date, default: null },
	generatedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Recurring', default: null }
});

const Task = mongoose.model('Task', taskSchema);

export default Task;
