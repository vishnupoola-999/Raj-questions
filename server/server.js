require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose'); // Add mongoose
const { deepResearch } = require('./research');
const { generateQuestions } = require('./gemini');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('✅ Connected to MongoDB'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// ── Auth Routes ─────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const result = await auth.register(email, password, name); // Await
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.status(201).json(result);
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await auth.login(email, password); // Await
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        // Verify Google token (omitted for brevity, assuming verified on client or using library)
        // For simplicity, we assume client sends user info, but real app should verify ID token.
        // Assuming body contains { email, name, googleId, picture } for now to match auth.js
        const result = await auth.googleLogin(req.body); // Await
        res.json(result);
    } catch (err) {
        console.error('Google login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ── Profile Routes (protected) ──────────────────────────

app.get('/api/profile', auth.authMiddleware, async (req, res) => {
    const profile = await auth.getProfile(req.userId); // Await
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ success: true, user: profile });
});

app.put('/api/profile', auth.authMiddleware, async (req, res) => {
    const updated = await auth.updateProfile(req.userId, req.body); // Await
    if (!updated) return res.status(404).json({ error: 'Profile not found' });
    res.json({ success: true, user: updated });
});

// ── API Keys Settings (protected) ───────────────────────

app.get('/api/settings/keys', auth.authMiddleware, async (req, res) => {
    const keys = await auth.getApiKeys(req.userId); // Await
    if (!keys) return res.status(404).json({ error: 'User not found' });
    // Mask keys for display (show only last 4 chars if long enough, else hide all)
    res.json({
        success: true,
        keys: {
            youtubeApiKey: keys.youtubeApiKey ? (keys.youtubeApiKey.length <= 4 ? '•'.repeat(keys.youtubeApiKey.length) : '•'.repeat(keys.youtubeApiKey.length - 4) + keys.youtubeApiKey.slice(-4)) : '',
            geminiApiKey: keys.geminiApiKey ? (keys.geminiApiKey.length <= 4 ? '•'.repeat(keys.geminiApiKey.length) : '•'.repeat(keys.geminiApiKey.length - 4) + keys.geminiApiKey.slice(-4)) : '',
            hasYoutubeKey: !!keys.youtubeApiKey,
            hasGeminiKey: !!keys.geminiApiKey,
        },
    });
});

app.put('/api/settings/keys', auth.authMiddleware, async (req, res) => {
    const { youtubeApiKey, geminiApiKey } = req.body;
    const result = await auth.updateApiKeys(req.userId, { youtubeApiKey, geminiApiKey }); // Await
    if (!result) return res.status(404).json({ error: 'User not found' });
    console.log(`🔑 API keys updated for user ${req.userId}`);
    res.json({ success: true, message: 'API keys saved' });
});

// Helper: get user's API keys (full, unmasked) for server-side use
async function getUserKeys(userId) {
    return (await auth.getApiKeys(userId)) || {}; // Await
}

// ── Research (protected) ────────────────────────────────

app.post('/api/research-guest', auth.authMiddleware, async (req, res) => {
    const { guestName, context } = req.body;
    if (!guestName) return res.status(400).json({ error: 'Guest name is required' });

    // Get user's custom API keys
    const userKeys = await getUserKeys(req.userId); // Await

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onProgress = (data) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...data })}\n\n`);
    };

    try {
        console.log(`🔎 Streaming research: ${guestName}${context ? ` (context: ${context})` : ''}${userKeys.youtubeApiKey ? ' [custom YT key]' : ''}${userKeys.geminiApiKey ? ' [custom Gemini key]' : ''}`);
        const research = await deepResearch(guestName, onProgress, context || '', userKeys);
        res.write(`data: ${JSON.stringify({ type: 'result', data: research })}\n\n`);
    } catch (err) {
        console.error('Research error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }

    res.end();
});

// ── Question Generation (protected) ─────────────────────

app.post('/api/generate-questions', auth.authMiddleware, async (req, res) => {
    const { interviewerName, interviewerStyle, channelDescription, guestName, guestContext, pastInterviewsSummary, questionCount } = req.body;

    // Get user's custom API keys
    const userKeys = await getUserKeys(req.userId);

    try {
        const result = await generateQuestions({
            interviewerName,
            interviewerStyle,
            channelDescription,
            guestName,
            guestContext,
            pastInterviewsSummary,
            questionCount,
            geminiApiKey: userKeys.geminiApiKey,
        });
        res.json(result);
    } catch (err) {
        console.error('Question generation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve frontend for any other route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n🎙️  InterviewIQ Server — http://localhost:${PORT}\n`);
});
