const { GoogleGenerativeAI } = require('@google/generative-ai');


const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

async function generateQuestions({
    interviewerName,
    interviewerStyle,
    channelDescription,
    guestName,
    guestContext,
    pastInterviewsSummary,
    questionCount = 15,
    geminiApiKey = '',
}) {
    const key = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('Gemini API Key is missing. Please configure it in Settings.');
    const genAI = new GoogleGenerativeAI(key);
    const systemPrompt = `You are the world's best interview question writer. You write questions that are SHORT, SIMPLE, and DEEPLY MEANINGFUL.

ABSOLUTE RULES FOR EVERY QUESTION:
1. MAX 2 LINES. A question can be 1 line, 1.5 lines, or 2 lines — NEVER more than 2 lines.
2. USE SIMPLE WORDS. Write like you're talking to a friend. No fancy vocabulary, no jargon, no complex sentences. A 15-year-old should understand every word.
3. DEEP MEANING. The simplicity should hide a powerful, thought-provoking depth. The question should hit the guest in a way they've never been hit before.
4. NEVER ASKED BEFORE. You have detailed analysis of every past interview. Your questions must be completely fresh — things no interviewer has ever thought to ask.
5. MATCH THE INTERVIEWER'S STYLE. Study the interviewer's tone, energy, and approach. The question should sound like THEM, not like a textbook.
6. NO GENERIC QUESTIONS. Never ask "What's your morning routine?", "What advice for young people?", "What's your biggest failure?" — these are dead.
7. MAKE THE GUEST THINK. The best question is one where the guest pauses, looks at the interviewer, and says "Wow, no one's ever asked me that."

EXAMPLES OF GOOD vs BAD:
❌ BAD (too long, too complex): "Given your extensive experience in navigating the complexities of the entrepreneurial landscape, how do you reconcile the fundamental tension between pursuing disruptive innovation and maintaining the operational stability required for sustainable growth?"
✅ GOOD (short, simple, deep): "You've built a billion-dollar company. But what's one thing money still can't fix in your life?"

❌ BAD: "What philosophical framework guides your decision-making process when confronted with ethically ambiguous business scenarios?"
✅ GOOD: "When was the last time you did something you knew was wrong — but did it anyway?"

❌ BAD: "How has your relationship with failure evolved throughout the different stages of your career?"
✅ GOOD: "What's a failure you still haven't forgiven yourself for?"

RESPOND WITH VALID JSON ONLY:
{
  "guestAnalysis": "2-3 sentence analysis of what makes this guest tick and what gaps exist in their past interviews",
  "categories": [
    {
      "name": "Category Name",
      "icon": "lucide-icon-name (e.g. 'zap', 'brain', 'target', 'compass', 'heart', 'flame', 'eye', 'unlock')",
      "questions": [
        {
          "question": "Short, punchy question (MAX 2 lines)",
          "reasoning": "Why this question works and what gap it fills (1 line)",
          "style_match": "How this matches the interviewer's style (brief)"
        }
      ]
    }
  ]
}`;

    // Use MORE of the research data — Gemini 2.5 Flash can handle large context
    let trimmedSummary = pastInterviewsSummary || '';
    if (trimmedSummary.length > 50000) {
        trimmedSummary = trimmedSummary.substring(0, 50000) + '\n... (truncated)';
    }

    const userPrompt = `
INTERVIEWER PROFILE:
- Name: ${interviewerName}
- Style: ${interviewerStyle || 'Conversational, curious, goes deep'}
- Channel/Show: ${channelDescription || 'Not specified'}

GUEST: ${guestName}
${guestContext ? `Interviewer's Focus/Angle: ${guestContext}` : ''}

DEEP RESEARCH ON ${guestName.toUpperCase()} (from analyzing real video transcripts, web articles, Wikipedia, social media):
${trimmedSummary || 'No specific research data available. Use your knowledge to generate unique questions.'}

TASK: Generate exactly ${questionCount} questions organized into 4-5 categories.

REMEMBER:
- MAX 2 LINES per question. Keep it SHORT.
- Use SIMPLE everyday words. No jargon.
- Make each question so deep that ${guestName} pauses and thinks.
- These must be questions ${guestName} has NEVER been asked.
- They should sound like ${interviewerName} is asking them naturally.
- Reference specific things from the research to show homework was done.`;

    let lastError = null;

    // Try each model with retry
    for (const modelName of MODELS) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                console.log(`  Trying ${modelName} (attempt ${attempt + 1})...`);

                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: systemPrompt,
                    generationConfig: {
                        temperature: 0.85,
                        maxOutputTokens: 8192,
                        responseMimeType: 'application/json',
                    },
                });

                const result = await model.generateContent(userPrompt);
                const responseText = result.response.text();

                // Clean markdown fences if present
                let cleaned = responseText.trim();
                if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
                else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
                if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
                cleaned = cleaned.trim();

                const parsed = JSON.parse(cleaned);
                console.log(`  ✅ Success with ${modelName}`);
                return { success: true, data: parsed };

            } catch (err) {
                lastError = err;
                console.error(`  ❌ ${modelName} attempt ${attempt + 1}: ${err.message?.substring(0, 120)}`);

                // If rate limited, wait before retry
                if (err.message?.includes('429') || err.message?.includes('quota')) {
                    console.log('  ⏳ Rate limited, waiting 20s...');
                    await new Promise(r => setTimeout(r, 20000));
                }
            }
        }
    }

    return {
        success: false,
        error: `All models failed. Last error: ${lastError?.message || 'Unknown error'}. Gemini API quota may be exhausted — resets in ~1 minute for RPM limits, or at midnight PT for daily limits. You can add your own API key in Settings.`,
    };
}

module.exports = { generateQuestions };
