import mongoose from 'mongoose';

const stickyNoteSchema = new mongoose.Schema({
	text: { type: String, required: true },
	createdAt: { type: Date, default: Date.now }
});

const StickyNote = mongoose.model('StickyNote', stickyNoteSchema);

export default StickyNote;
