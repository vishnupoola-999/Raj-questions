const { GoogleGenerativeAI } = require('@google/generative-ai');
const { researchGuest: youtubeSearch, fetchTranscripts, analyzeVideosWithGemini } = require('./youtube');

// Create Gemini client — uses custom key if available, otherwise .env
function getGenAI(customKey) {
    return new GoogleGenerativeAI(customKey || process.env.GEMINI_API_KEY);
}

/**
 * Deep-research a guest: YouTube videos + transcript analysis + Gemini video analysis + web intelligence.
 * Streams progress events via the onProgress callback.
 *
 * Covers 100% of found videos:
 * - Videos WITH transcripts → read transcript text
 * - Videos WITHOUT transcripts → Gemini "watches" the video by URL
 */
async function deepResearch(guestName, onProgress = () => { }, context = '', userKeys = {}) {
    const geminiKey = userKeys.geminiApiKey || '';
    const youtubeKey = userKeys.youtubeApiKey || '';
    const isPro = !!userKeys.hasCustomKey;
    console.log(`\n🔎 Deep Research: "${guestName}"${context ? ` (context: ${context})` : ''} [${isPro ? 'PRO' : 'FREE'}]`);

    onProgress({ step: 'start', status: 'active', message: `Starting deep research on ${guestName}...` });

    // ─── Step 0: Correct Name / Fix Typos ──────────────
    onProgress({ step: 'name_check', status: 'active', message: 'Verifying guest name...' });

    let correctedName = guestName;
    try {
        correctedName = await correctGuestName(guestName, geminiKey);
        if (correctedName.toLowerCase() !== guestName.toLowerCase()) {
            console.log(`  📝 Name corrected: "${guestName}" → "${correctedName}"`);
            onProgress({ step: 'name_check', status: 'done', message: `Corrected to: ${correctedName}` });
        } else {
            onProgress({ step: 'name_check', status: 'done', message: `Confirmed: ${correctedName}` });
        }
    } catch (err) {
        console.error('Name correction failed:', err.message);
        correctedName = guestName;
        onProgress({ step: 'name_check', status: 'done', message: `Using: ${guestName}` });
    }

    const searchName = correctedName;

    // ─── Step 1: YouTube Search ──────────
    onProgress({ step: 'youtube', status: 'active', message: `Searching YouTube for ${searchName} interviews, podcasts, talks...` });

    let ytResult = { interviews: [], totalInterviewsFound: 0 };
    try {
        ytResult = await youtubeSearch(searchName, youtubeKey, isPro);
        onProgress({ step: 'youtube', status: 'done', message: `Found ${ytResult.totalInterviewsFound} relevant YouTube videos` });
    } catch (err) {
        console.error('YouTube search failed:', err.message);
        onProgress({ step: 'youtube', status: 'error', message: `YouTube search failed: ${err.message}` });
    }

    // ─── Step 2: Fetch ALL Transcripts (any language) ──
    let transcripts = [];
    let failedVideos = []; // Videos without transcripts → Gemini will analyze these

    if (ytResult.interviews.length > 0) {
        onProgress({ step: 'transcripts', status: 'active', message: `Reading transcripts from all ${ytResult.interviews.length} videos (any language)...` });

        try {
            const result = await fetchTranscripts(ytResult.interviews, onProgress);
            transcripts = result.transcripts;
            failedVideos = result.failedVideos;

            const langs = [...new Set(transcripts.map(t => t.lang).filter(l => l && l !== 'unknown' && l !== 'auto'))];
            const langNames = { en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ar: 'Arabic', ru: 'Russian', zh: 'Chinese' };
            const langDisplay = langs.map(l => langNames[l] || l).join(', ');
            const langStr = langDisplay ? ` (${langDisplay})` : '';

            onProgress({
                step: 'transcripts', status: 'done',
                message: `Read ${transcripts.length} transcripts${langStr} · ${failedVideos.length} videos need AI analysis`
            });
        } catch (err) {
            console.error('Transcript fetch failed:', err.message);
            failedVideos = ytResult.interviews; // If fetch crashes, try all with Gemini
            onProgress({ step: 'transcripts', status: 'error', message: 'Transcript fetching failed, AI will analyze videos directly' });
        }
    }

    // ─── Step 2b: Gemini Video Analysis (for transcript-less videos) ──
    let geminiAnalyzed = [];
    if (failedVideos.length > 0) {
        onProgress({
            step: 'gemini_video', status: 'active',
            message: `AI watching ${failedVideos.length} videos without transcripts${isPro ? '' : ` (max 15 in Free mode)`}...`
        });

        try {
            geminiAnalyzed = await analyzeVideosWithGemini(failedVideos, onProgress, geminiKey, isPro);
            onProgress({
                step: 'gemini_video', status: 'done',
                message: `AI analyzed ${geminiAnalyzed.length} videos directly (no transcripts needed)`
            });
        } catch (err) {
            console.error('Gemini video analysis failed:', err.message);
            onProgress({ step: 'gemini_video', status: 'error', message: 'Some videos could not be analyzed' });
        }
    }

    // Combine all analyzed content: transcripts + Gemini-analyzed videos
    const allAnalyzedContent = [...transcripts, ...geminiAnalyzed];

    // ─── Step 3: Deep AI Analysis ──────────────────────
    let videoAnalysis = '';

    if (allAnalyzedContent.length > 0) {
        onProgress({
            step: 'analyze_videos', status: 'active',
            message: `AI deep-reading ${allAnalyzedContent.length} videos pin-to-pin...`
        });

        // Try with retry (handles rate limits)
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                videoAnalysis = await deepAnalyzeTranscripts(searchName, allAnalyzedContent, context, geminiKey);
                onProgress({
                    step: 'analyze_videos', status: 'done',
                    message: `Deep-analyzed ${allAnalyzedContent.length} videos (${transcripts.length} transcripts + ${geminiAnalyzed.length} AI-watched)`
                });
                break;
            } catch (err) {
                console.error(`Analysis attempt ${attempt} failed:`, err.message?.substring(0, 150));
                if (attempt < 3 && (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('rate'))) {
                    const delay = attempt * 5000;
                    onProgress({
                        step: 'analyze_videos', status: 'active',
                        message: `Rate limit hit, retrying in ${delay / 1000}s... (attempt ${attempt + 1}/3)`
                    });
                    await new Promise(r => setTimeout(r, delay));
                } else if (attempt === 3) {
                    onProgress({ step: 'analyze_videos', status: 'error', message: 'Deep analysis failed, trying metadata...' });
                }
            }
        }
    }

    // Fallback: metadata analysis if everything else failed
    if (!videoAnalysis && ytResult.interviews.length > 0) {
        onProgress({ step: 'analyze_videos', status: 'active', message: `AI analyzing ${ytResult.interviews.length} video titles & patterns...` });
        try {
            videoAnalysis = await analyzeVideoMetadata(searchName, ytResult.interviews, context, geminiKey);
            onProgress({ step: 'analyze_videos', status: 'done', message: `Analyzed patterns across ${ytResult.interviews.length} videos` });
        } catch (err) {
            console.error('Metadata analysis failed:', err.message);
            onProgress({ step: 'analyze_videos', status: 'error', message: 'Video analysis encountered an issue' });
        }
    }

    // ─── Step 4: Web Research + Wikipedia (parallel) ──────
    onProgress({ step: 'web_search', status: 'active', message: 'Searching articles, blogs, news, Wikipedia, social media...' });

    let web = null;
    let wiki = null;

    // Run web research and Wikipedia in parallel
    const [webResult, wikiResult] = await Promise.allSettled([
        webResearch(searchName, geminiKey),
        fetchWikipedia(searchName),
    ]);

    if (webResult.status === 'fulfilled') {
        web = webResult.value;
    } else {
        console.error('Web research failed:', webResult.reason?.message);
    }

    if (wikiResult.status === 'fulfilled' && wikiResult.value) {
        wiki = wikiResult.value;
        console.log(`  📖 Wikipedia: ${wiki.length} chars`);
    } else {
        console.log('  ℹ️ No Wikipedia article found');
    }

    const sourceCount = web?.sources?.length || 0;
    const wikiStr = wiki ? ' + Wikipedia' : '';
    onProgress({ step: 'web_search', status: 'done', message: `Read ${sourceCount} web sources${wikiStr}` });

    // ─── Step 5: Combine Everything ───────────────────
    onProgress({ step: 'compile', status: 'active', message: 'Compiling comprehensive intelligence report...' });

    let combinedSummary = '';
    if (videoAnalysis) {
        combinedSummary += `\n=== VIDEO INTERVIEW ANALYSIS ===\n${videoAnalysis}\n`;
    }
    if (wiki) {
        combinedSummary += `\n=== WIKIPEDIA ===\n${wiki}\n`;
    }
    if (web?.profile) {
        combinedSummary += `\n=== WEB INTELLIGENCE ===\n${web.profile}\n`;
    }

    onProgress({ step: 'compile', status: 'done', message: 'Intelligence report ready' });
    onProgress({ step: 'complete', status: 'done', message: 'Research complete!' });

    const totalAnalyzed = transcripts.length + geminiAnalyzed.length;
    console.log(`  ✅ YouTube: ${ytResult.totalInterviewsFound} videos found`);
    console.log(`  ✅ Transcripts: ${transcripts.length} read`);
    console.log(`  ✅ Gemini video analysis: ${geminiAnalyzed.length} watched`);
    console.log(`  ✅ Total analyzed: ${totalAnalyzed}/${ytResult.totalInterviewsFound}`);
    console.log(`  ✅ Web: ${web ? 'profile built' : 'failed'}`);

    return {
        guestName: searchName,
        originalQuery: guestName,
        correctedName: searchName !== guestName ? searchName : null,
        totalInterviewsFound: ytResult.totalInterviewsFound,
        transcriptsAnalyzed: totalAnalyzed,
        interviews: ytResult.interviews,
        topicsSummary: combinedSummary,
        videoAnalysis,
        webProfile: web,
    };
}

/**
 * Use Gemini to correct typos in a guest name.
 */
async function correctGuestName(name, geminiKey = '') {
    const genAI = getGenAI(geminiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { temperature: 0, maxOutputTokens: 100 },
    });

    const prompt = `I need the correct full name of a person. The user typed: "${name}"

If this name has a typo or misspelling, return ONLY the corrected full name (nothing else).
If the name is already correct, return it as-is with proper capitalization.
Return ONLY the name, no explanation, no quotes, no punctuation.`;

    const result = await model.generateContent(prompt);
    const corrected = result.response.text().trim();

    if (corrected.length > 60 || corrected.includes('\n')) return name;
    return corrected;
}

/**
 * DEEP ANALYSIS: Read every transcript/analysis pin-to-pin across all videos.
 * Uses Gemini 2.5 Flash (1M token context) to process ALL content at once.
 */
async function deepAnalyzeTranscripts(guestName, allContent, context = '', geminiKey = '') {
    const genAI = getGenAI(geminiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
    });

    // Build the complete content corpus
    let corpus = '';
    let totalChars = 0;

    for (const t of allContent) {
        const source = t.source === 'gemini-video' ? '🎬 AI-WATCHED' : '📝 TRANSCRIPT';
        const entry = `\n${'═'.repeat(60)}\n${source} — "${t.title}"\nCHANNEL: ${t.channelTitle}\nLANGUAGE: ${t.lang}\n${'═'.repeat(60)}\n${t.transcript}\n`;
        corpus += entry;
        totalChars += entry.length;
    }

    const contextSection = context
        ? `\n\n## USER'S SPECIFIC FOCUS\nThe interviewer has specified this context/angle: "${context}"\nTailor your analysis and question suggestions toward this focus area.`
        : '';

    const prompt = `You are the world's #1 interview preparation researcher. You have a superpower: you can read and understand EVERY language — Hindi, English, Spanish, Japanese, any language.

I am giving you content from ${allContent.length} real videos featuring "${guestName}". Some are full transcripts, some are AI-analyzed summaries of the video content. These may be in different languages — read and understand all of them.

YOUR MISSION: Read every single word. Understand the FULL CONTEXT of what ${guestName} said — their exact words, the emotions behind them, the stories they told, the topics they engaged with passionately vs. the ones they deflected. This is not surface-level analysis.
${contextSection}

${corpus}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Now, based on your DEEP, pin-to-pin reading of every video above, provide this comprehensive analysis:

## 🎯 QUESTIONS ALREADY ASKED TO ${guestName.toUpperCase()}
Go through every interview and list the actual questions asked. Group by theme:
- List specific questions word-for-word or closely paraphrased
- Mark questions in MULTIPLE interviews with 🔁 (overasked "dead" questions)
- Note which interviewer/channel asked which question

## 📊 TOPICS DEEPLY COVERED
What subjects has ${guestName} talked about extensively?
- For each: HOW DEEP did they go? What specific points did they make?
- Include actual quotes/paraphrases from the content
- Rate coverage depth: 🟢 Thoroughly covered | 🟡 Partially covered | 🔴 Barely touched

## 🔥 ${guestName.toUpperCase()}'S PASSIONATE MOMENTS
When did ${guestName} get truly animated, emotional, or passionate?
- What topics make them light up?
- What stories do they love telling?
- When did their energy shift? What triggered it?

## 🚫 TOPICS AVOIDED OR DEFLECTED
What questions/topics did ${guestName} dodge, give vague answers to, or redirect?
- Be specific: what was asked and how they responded

## 🗣️ SPEAKING STYLE & PERSONALITY
Based on ACTUAL evidence:
- Length of answers (brief vs. long-winded)
- Storytelling vs. data-driven vs. philosophical
- Humor style
- How they handle difficult/personal questions
- Catchphrases or repeated phrases

## 💬 KEY QUOTES & POWERFUL MOMENTS
Extract 5-10 ACTUAL quotes that reveal ${guestName}'s personality, values, or strong opinions. Note which video each came from.

## 🧩 CONTRADICTIONS & INTERESTING TENSIONS
Did ${guestName} say something in one interview that contradicts another? These make BRILLIANT interview questions.

## 🆕 FRESH QUESTION IDEAS
Based on exhaustive analysis, suggest 10 genuinely UNIQUE questions that:
1. Have NEVER been asked in any of these interviews
2. Would catch ${guestName} off guard (in a good way)
3. Would reveal something new
4. Reference things they said (showing the interviewer did homework)
5. Would make ${guestName} THINK, not recite rehearsed answers

For each question, explain WHY it would work and what gap it fills.

CRITICAL: Everything must be backed by ACTUAL content. Do NOT make up information. Translate non-English quotes to English while noting original language.`;

    console.log(`  🧠 Deep-analyzing ${allContent.length} videos (${totalChars} chars)...`);

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Fallback: analyze video metadata when nothing else works.
 */
async function analyzeVideoMetadata(guestName, interviews, context = '', geminiKey = '') {
    const genAI = getGenAI(geminiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { temperature: 0.4, maxOutputTokens: 6000 },
    });

    const videoList = interviews.slice(0, 80).map((v, i) => {
        return `${i + 1}. "${v.title}" — Channel: ${v.channelTitle} (${v.publishedAt?.substring(0, 10) || 'unknown date'})\n   Description: ${v.description?.substring(0, 200) || 'N/A'}`;
    }).join('\n\n');

    const contextSection = context ? `\nThe interviewer's specific focus: "${context}"\n` : '';

    const prompt = `You are an expert interview researcher. I found ${interviews.length} YouTube videos related to "${guestName}".
${contextSection}
Here are the video titles, channels, and descriptions:

${videoList}

Based on this information, provide:

## INTERVIEW PATTERNS
What types of interviews does ${guestName} typically do?

## TOPICS COVERED
Main topics/themes, grouped with frequency.

## TOPICS OVERDONE
Which topics are asked about in almost every interview?

## GAPS & FRESH OPPORTUNITIES
What topics seem underrepresented?

## RECOMMENDED FRESH ANGLES
Suggest 7-10 unique question angles.

Note: Based on video titles/descriptions.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Use Gemini + Google Search grounding to research a guest across the entire web.
 */
async function webResearch(guestName, geminiKey = '') {
    const genAI = getGenAI(geminiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: [{ googleSearch: {} }],
    });

    const prompt = `You are a world-class interview researcher. Research "${guestName}" thoroughly across the entire internet and compile a comprehensive dossier.

Search for and actually READ:
1. **News Articles & Press** — Recent coverage, press releases, op-eds, speeches. Read actual articles.
2. **Blog Posts & Writings** — Blogs by or about ${guestName}. Personal websites, Medium, LinkedIn articles.
3. **Social Media** — X/Twitter, Instagram, LinkedIn activity. What do they post? Tone? Viral posts?
4. **Reddit / Forums** — AMAs, discussions, fan opinions, controversies.
5. **Books / Publications** — Books written, forewords, publications.
6. **Podcast Appearances** — Podcast databases listing their appearances.
7. **Wikipedia / Bio Sources** — Comprehensive background.

Compile findings as:

BACKGROUND:
[Who they are — 2-3 detailed sentences]

RECENT NEWS & EVENTS (Last 12 Months):
[Specific dates and events]

ARTICLES & WRITINGS ABOUT THEM:
[Source and key points]

SOCIAL MEDIA PRESENCE:
[Platform-by-platform breakdown]

BOOKS & PUBLICATIONS:
[Any authored or featured works]

CONTROVERSIES & SENSITIVE TOPICS:
[Handle with care but important to know]

CAREER MILESTONES & KEY LIFE EVENTS:
[Timeline of major moments]

AUDIENCE & FAN BASE:
[Demographics, sentiment]

PUBLIC PERCEPTION:
[General public view — positive, negative, polarizing?]`;

    try {
        console.log('  🌐 Searching the web via Gemini...');
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        const sources = [];
        try {
            const candidate = result.response.candidates?.[0];
            const grounding = candidate?.groundingMetadata;
            if (grounding?.groundingChunks) {
                for (const chunk of grounding.groundingChunks) {
                    if (chunk.web?.uri) {
                        sources.push({
                            title: chunk.web.title || new URL(chunk.web.uri).hostname,
                            url: chunk.web.uri,
                        });
                    }
                }
            }
        } catch (metaErr) {
            console.log('  ⚠️ Could not extract grounding metadata:', metaErr.message);
        }

        console.log(`  📌 Found ${sources.length} web sources`);
        return { profile: text, source: 'gemini-google-search', sources };
    } catch (err) {
        console.error('  ❌ Web research failed:', err.message?.substring(0, 200));
        try {
            console.log('  🔄 Falling back to Gemini knowledge...');
            const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await fallbackModel.generateContent(prompt);
            return { profile: result.response.text(), source: 'gemini-knowledge', sources: [] };
        } catch (fallbackErr) {
            console.error('  ❌ Fallback failed:', fallbackErr.message?.substring(0, 200));
            return null;
        }
    }
}
/**
 * Fetch Wikipedia article about the guest.
 * Uses the Wikipedia REST API for fast, structured data.
 */
async function fetchWikipedia(guestName) {
    const https = require('https');

    function httpsGet(url) {
        return new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'InterviewIQ/1.0' } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            }).on('error', reject);
        });
    }

    try {
        // Try Wikipedia Summary API first
        const encodedName = encodeURIComponent(guestName.replace(/\s+/g, '_'));
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedName}`;

        let resp = await httpsGet(summaryUrl);

        // If not found, try Wikipedia search
        if (resp.status === 404) {
            const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(guestName)}&format=json&srlimit=1`;
            const searchResp = await httpsGet(searchUrl);
            const searchData = JSON.parse(searchResp.data);

            if (searchData.query?.search?.[0]?.title) {
                const title = encodeURIComponent(searchData.query.search[0].title.replace(/\s+/g, '_'));
                resp = await httpsGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);
            }
        }

        if (resp.status !== 200) return null;

        const summary = JSON.parse(resp.data);
        if (!summary.extract || summary.type === 'disambiguation') return null;

        // Also fetch full article content for deeper context
        const fullUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(summary.title)}&prop=extracts&explaintext=1&format=json`;
        const fullResp = await httpsGet(fullUrl);
        const fullData = JSON.parse(fullResp.data);
        const pages = fullData.query?.pages || {};
        const pageContent = Object.values(pages)[0]?.extract || '';

        // Combine summary + full content (capped)
        let wikiText = `WIKIPEDIA: ${summary.title}\n${summary.description || ''}\n\n`;
        wikiText += `SUMMARY: ${summary.extract}\n\n`;
        if (pageContent.length > 500) {
            wikiText += `FULL ARTICLE:\n${pageContent.substring(0, 15000)}`;
        }

        console.log(`  📖 Wikipedia found: "${summary.title}" (${wikiText.length} chars)`);
        return wikiText;

    } catch (err) {
        console.log(`  ℹ️ Wikipedia fetch failed: ${err.message}`);
        return null;
    }
}

module.exports = { deepResearch };
