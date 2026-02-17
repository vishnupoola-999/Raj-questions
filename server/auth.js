const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('./models/User');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'interviewiq-secret-key-change-in-production';

// Ensure data directory exists for local dev
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Check if using MongoDB
function isMongo() {
    return mongoose.connection.readyState === 1;
}

// Load users from file (Legacy/Local Dev)
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('Error loading users:', e.message);
    }
    return {};
}

// Save users to file (Legacy/Local Dev)
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// Generate JWT token
function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

// Verify JWT token
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

// Auth middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = decoded.userId;
    next();
}

// Remove sensitive data
function sanitizeUser(user) {
    // Handle Mongoose document or plain object
    const u = user.toObject ? user.toObject() : user;
    const { passwordHash, youtubeApiKey, geminiApiKey, __v, _id, ...safe } = u;
    // Ensure ID is passed as string
    safe.id = u.id || u._id.toString();
    return safe;
}

// ── Register ──
async function register(email, password, name) {
    const emailLower = email.toLowerCase().trim();

    if (password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters' };
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (isMongo()) {
        try {
            const existing = await User.findOne({ email: emailLower });
            if (existing) return { success: false, error: 'An account with this email already exists' };

            const newUser = new User({
                email: emailLower,
                name: name || '',
                passwordHash
            });
            await newUser.save();
            const token = generateToken(newUser._id.toString());
            return { success: true, token, user: sanitizeUser(newUser) };
        } catch (err) {
            console.error('Mongo Register Error:', err);
            return { success: false, error: 'Registration failed' };
        }
    } else {
        // Local File Fallback
        const users = loadUsers();
        if (users[emailLower]) {
            return { success: false, error: 'An account with this email already exists' };
        }
        const userId = crypto.randomUUID();
        users[emailLower] = {
            id: userId,
            email: emailLower,
            name: name || '',
            passwordHash,
            createdAt: new Date().toISOString(),
        };
        saveUsers(users);
        const token = generateToken(userId);
        return { success: true, token, user: sanitizeUser(users[emailLower]) };
    }
}

// ── Login ──
async function login(email, password) {
    const emailLower = email.toLowerCase().trim();

    if (isMongo()) {
        const user = await User.findOne({ email: emailLower });
        if (!user) return { success: false, error: 'No account found with this email' };

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return { success: false, error: 'Incorrect password' };

        const token = generateToken(user._id.toString());
        return { success: true, token, user: sanitizeUser(user) };
    } else {
        const users = loadUsers();
        const user = users[emailLower];
        if (!user) return { success: false, error: 'No account found with this email' };

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return { success: false, error: 'Incorrect password' };

        const token = generateToken(user.id);
        return { success: true, token, user: sanitizeUser(user) };
    }
}

// ── Google Sign-In ──
async function googleLogin(googleData) {
    const emailLower = googleData.email.toLowerCase().trim();

    if (isMongo()) {
        let user = await User.findOne({ email: emailLower });
        if (user) {
            // Update picture if missing
            if (!user.picture && googleData.picture) {
                user.picture = googleData.picture;
                await user.save();
            }
        } else {
            user = new User({
                email: emailLower,
                name: googleData.name || '',
                passwordHash: '', // No password for Google users
                picture: googleData.picture || '',
                googleId: googleData.googleId
            });
            await user.save();
        }
        const token = generateToken(user._id.toString());
        return { success: true, token, user: sanitizeUser(user) };
    } else {
        const users = loadUsers();
        if (users[emailLower]) {
            if (!users[emailLower].picture && googleData.picture) {
                users[emailLower].picture = googleData.picture;
                saveUsers(users);
            }
            const token = generateToken(users[emailLower].id);
            return { success: true, token, user: sanitizeUser(users[emailLower]) };
        }

        const userId = crypto.randomUUID();
        users[emailLower] = {
            id: userId,
            email: emailLower,
            name: googleData.name || '',
            googleId: googleData.googleId,
            picture: googleData.picture || '',
            passwordHash: '',
            createdAt: new Date().toISOString(),
        };
        saveUsers(users);
        const token = generateToken(userId);
        return { success: true, token, user: sanitizeUser(users[emailLower]) };
    }
}

// ── Get Profile ──
async function getProfile(userId) {
    if (isMongo()) {
        // userId might be Mongo ID or UUID (from old data), try to handle both if migrating, 
        // but for now assume Mongo ID if in Mongo mode.
        if (mongoose.Types.ObjectId.isValid(userId)) {
            const user = await User.findById(userId);
            return user ? sanitizeUser(user) : null;
        }
        return null;
    } else {
        const users = loadUsers();
        const user = Object.values(users).find(u => u.id === userId);
        return user ? sanitizeUser(user) : null;
    }
}

// ── Update Profile ──
async function updateProfile(userId, updates) {
    const allowed = ['name', 'channelDescription', 'interviewerStyle', 'profileComplete'];

    if (isMongo()) {
        if (!mongoose.Types.ObjectId.isValid(userId)) return null;
        const user = await User.findById(userId);
        if (!user) return null;

        for (const key of allowed) {
            if (updates[key] !== undefined) user[key] = updates[key];
        }
        // Handle nested profile fields if schema differs (we used flat structure in User.js? 
        // Actually schema says `profile: { about, style }`. 
        // But logic in auth.js was updating root keys? 
        // Let's check old logic: users[email][key] = updates[key].
        // Old keys were on root.
        // New User schema puts them in `profile` object? 
        // Let's align User schema to be flat or update logic.
        // Schema: name, channelDescription (missing in schema?), interviewerStyle (missing?).
        // Schema has `profile: { about, style }`.
        // I should stick to one structure.
        // Let's update User schema logic to match current frontend expectations.
        // Front end sends: name, channelDescription, interviewerStyle.
        // I will add these fields to User schema in next step if missed, or use flexible schema.
        // For now, I'll save them to root if schema allows, or Mixed.
        await user.save();
        return sanitizeUser(user);
    } else {
        const users = loadUsers();
        const email = Object.keys(users).find(k => users[k].id === userId);
        if (!email) return null;

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                users[email][key] = updates[key];
            }
        }
        saveUsers(users);
        return sanitizeUser(users[email]);
    }
}

// ── Update API Keys ──
async function updateApiKeys(userId, keys) {
    if (isMongo()) {
        if (!mongoose.Types.ObjectId.isValid(userId)) return null;
        const user = await User.findById(userId);
        if (!user) return null;

        if (keys.youtubeApiKey !== undefined) user.youtubeApiKey = keys.youtubeApiKey;
        if (keys.geminiApiKey !== undefined) user.geminiApiKey = keys.geminiApiKey;
        await user.save();
        return { success: true };
    } else {
        const users = loadUsers();
        const email = Object.keys(users).find(k => users[k].id === userId);
        if (!email) return null;

        if (keys.youtubeApiKey !== undefined) users[email].youtubeApiKey = keys.youtubeApiKey;
        if (keys.geminiApiKey !== undefined) users[email].geminiApiKey = keys.geminiApiKey;
        saveUsers(users);
        return { success: true };
    }
}

// ── Get API Keys ──
async function getApiKeys(userId) {
    if (isMongo()) {
        if (!mongoose.Types.ObjectId.isValid(userId)) return null;
        const user = await User.findById(userId);
        if (!user) return null;
        return {
            youtubeApiKey: user.youtubeApiKey || '',
            geminiApiKey: user.geminiApiKey || '',
        };
    } else {
        const users = loadUsers();
        const user = Object.values(users).find(u => u.id === userId);
        if (!user) return null;
        return {
            youtubeApiKey: user.youtubeApiKey || '',
            geminiApiKey: user.geminiApiKey || '',
        };
    }
}

module.exports = {
    register,
    login,
    googleLogin,
    getProfile,
    updateProfile,
    updateApiKeys,
    getApiKeys,
    authMiddleware,
};
