const { google } = require('googleapis');
const { YoutubeTranscript } = require('youtube-transcript-plus');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Create YouTube client — uses custom key if provided, falls back to .env key.
 */
function createYoutubeClient(customKey) {
  const key = customKey || process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YouTube API Key is missing. Please configure it in Settings.');
  return google.youtube({
    version: 'v3',
    auth: key,
  });
}

/**
 * Create Gemini client — uses custom key if provided, falls back to .env key.
 */
function createGeminiClient(customKey) {
  const key = customKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini API Key is missing. Please configure it in Settings.');
  return new GoogleGenerativeAI(key);
}

/**
 * Search YouTube for past interviews/podcasts of a guest.
 * Uses MANY search strategies including Hindi and regional variants.
 * Loosened relevance filter to catch more results.
 */
async function researchGuest(guestName, youtubeApiKey) {
  const yt = createYoutubeClient(youtubeApiKey);

  // ── Build diverse search queries ──────────────────────
  const queries = [
    `"${guestName}" interview`,
    `"${guestName}" podcast`,
    `"${guestName}" conversation`,
    `"${guestName}" talk show`,
    `"${guestName}" full episode`,
    `"${guestName}" keynote speech`,
    `"${guestName}" panel discussion`,
    `"${guestName}" QnA`,
    `${guestName} interview full video`,
    `${guestName} podcast episode`,
    `"${guestName}" इंटरव्यू`,
    `"${guestName}" बातचीत`,
    `"${guestName}" पॉडकास्ट`,
  ];

  const allVideos = [];
  const seenIds = new Set();
  let quotaErrors = 0;

  for (const query of queries) {
    try {
      const response = await yt.search.list({
        part: 'snippet',
        q: query,
        type: 'video',
        maxResults: 50,
        order: 'relevance',
        videoDuration: 'long',
      });

      if (response.data.items) {
        for (const item of response.data.items) {
          if (!seenIds.has(item.id.videoId)) {
            seenIds.add(item.id.videoId);
            allVideos.push({
              videoId: item.id.videoId,
              title: item.snippet.title,
              description: item.snippet.description,
              channelTitle: item.snippet.channelTitle,
              publishedAt: item.snippet.publishedAt,
              thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            });
          }
        }
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('quota') || msg.includes('Quota') || msg.includes('exceeded')) {
        quotaErrors++;
        if (quotaErrors === 1) console.error('  ⚠️ YouTube API quota exceeded!');
      } else {
        console.error(`YouTube search error for "${query}":`, msg);
      }
    }
  }

  // If ALL queries failed due to quota, throw a clear error
  if (quotaErrors === queries.length && allVideos.length === 0) {
    throw new Error('QUOTA_EXHAUSTED: YouTube API daily quota exhausted. Resets at midnight Pacific Time (12:30 PM IST). Add your own API key in Settings to continue.');
  }

  // ── Loosened Relevance Filter ──────────────────────────
  const nameParts = guestName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
  const fullName = guestName.toLowerCase();
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';

  const relevant = allVideos.filter(v => {
    const title = v.title.toLowerCase();
    const desc = v.description.toLowerCase();
    const channel = v.channelTitle.toLowerCase();
    const all = title + ' ' + desc + ' ' + channel;

    if (all.includes(fullName)) return true;
    if (lastName && title.includes(lastName)) return true;
    if (firstName && lastName && all.includes(firstName) && all.includes(lastName)) return true;
    if (channel.includes(lastName) || channel.includes(firstName)) return true;
    return false;
  });

  console.log(`  YouTube: ${allVideos.length} raw → ${relevant.length} relevant (from ${queries.length} queries)`);

  relevant.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return {
    guestName,
    totalInterviewsFound: relevant.length,
    interviews: relevant,
  };
}

/**
 * Fetch transcripts for ALL videos (no cap).
 */
async function fetchTranscripts(videos, onProgress = null) {
  const results = [];
  const failed = [];
  let succeeded = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    let segments = null;
    let lang = 'unknown';

    try {
      segments = await YoutubeTranscript.fetchTranscript(video.videoId);
      if (segments && segments.length > 0) {
        lang = segments[0].lang || 'auto';
      }
    } catch (err) {
      const langs = ['en', 'hi', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'ar', 'ru', 'zh'];
      for (const tryLang of langs) {
        try {
          segments = await YoutubeTranscript.fetchTranscript(video.videoId, { lang: tryLang });
          if (segments && segments.length > 0) {
            lang = tryLang;
            break;
          }
        } catch { /* continue */ }
      }
    }

    if (segments && segments.length > 0) {
      const fullText = segments
        .map(seg => seg.text)
        .join(' ')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      if (fullText.length > 100) {
        results.push({
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          transcript: fullText.substring(0, 15000),
          lang,
        });
        succeeded++;
      } else {
        failed.push(video);
      }
    } else {
      failed.push(video);
    }

    if (onProgress) {
      onProgress({
        step: 'transcripts',
        status: 'active',
        message: `Read ${succeeded} transcripts (${i + 1}/${videos.length} videos scanned)...`,
      });
    }

    if (i < videos.length - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`  Transcripts: ${succeeded} fetched, ${failed.length} need Gemini analysis`);
  return { transcripts: results, failedVideos: failed };
}

/**
 * Use Gemini to "watch" and analyze a YouTube video by URL.
 */
async function analyzeVideoWithGemini(video, geminiApiKey) {
  const genAI = createGeminiClient(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.3, maxOutputTokens: 4000 },
  });

  const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

  const prompt = `Watch and analyze this YouTube video: ${videoUrl}

Video title: "${video.title}"
Channel: ${video.channelTitle}

Please provide:
1. **Summary**: What is this video about? (2-3 sentences)
2. **Key Questions Asked**: List the main questions or topics discussed
3. **Key Answers/Points**: What were the main points made by the guest/speaker?
4. **Notable Quotes**: Any memorable statements
5. **Topics Covered**: List the main themes/topics

Be specific and detailed — reference actual content from the video.`;

  try {
    const result = await model.generateContent(prompt);
    const analysis = result.response.text();

    if (analysis && analysis.length > 100) {
      return {
        videoId: video.videoId,
        title: video.title,
        channelTitle: video.channelTitle,
        transcript: analysis,
        lang: 'gemini-analyzed',
        source: 'gemini-video',
      };
    }
    return null;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('429') || msg.includes('quota')) {
      console.log(`    ⚠️ Gemini quota hit for video analysis`);
    } else {
      console.log(`    ❌ Gemini video analysis failed: ${msg.substring(0, 60)}`);
    }
    return null;
  }
}

/**
 * Analyze multiple videos with Gemini (for those without transcripts).
 */
async function analyzeVideosWithGemini(videos, onProgress = null, geminiApiKey = '') {
  const results = [];
  const batchSize = 3;

  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);

    if (onProgress) {
      onProgress({
        step: 'gemini_video',
        status: 'active',
        message: `AI watching video ${i + 1}–${Math.min(i + batchSize, videos.length)} of ${videos.length} (no transcript available)...`,
      });
    }

    const batchResults = await Promise.all(
      batch.map(video => analyzeVideoWithGemini(video, geminiApiKey))
    );

    for (const r of batchResults) {
      if (r) {
        results.push(r);
      }
    }

    if (i + batchSize < videos.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`  Gemini video analysis: ${results.length}/${videos.length} videos analyzed`);
  return results;
}

module.exports = { researchGuest, fetchTranscripts, analyzeVideosWithGemini };
