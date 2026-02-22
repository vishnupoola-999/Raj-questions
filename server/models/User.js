const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    passwordHash: {
        type: String,
        default: ''
    },
    name: {
        type: String,
        trim: true
    },
    youtubeApiKey: {
        type: String,
        default: ''
    },
    geminiApiKey: {
        type: String,
        default: ''
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    picture: {
        type: String,
        default: ''
    },
    channelDescription: {
        type: String,
        default: ''
    },
    interviewerStyle: {
        type: String,
        default: ''
    },
    profileComplete: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('User', userSchema);
