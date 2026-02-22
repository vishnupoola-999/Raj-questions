// ═══════════════════════════════════════════════════════════
//  InterviewIQ — Frontend v3 (Multi-Page with Auth + Settings)
// ═══════════════════════════════════════════════════════════

const API = '';
let token = localStorage.getItem('iq_token');
let currentUser = null;
let researchData = null;
let isResearching = false; // Lock to prevent double-triggering

// ── Initialization ─────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // Restore saved email ("Remember me")
    const savedEmail = localStorage.getItem('iq_remembered_email');
    if (savedEmail) {
        const loginEmailEl = document.getElementById('loginEmail');
        const rememberCheckbox = document.getElementById('rememberMe');
        if (loginEmailEl) loginEmailEl.value = savedEmail;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }

    if (token) {
        const ok = await loadProfile();
        if (ok) {
            if (!currentUser.profileComplete) {
                navigateTo('setup');
                prefillSetup();
            } else {
                navigateTo('dashboard');
            }
        } else {
            logout();
        }
    } else {
        navigateTo('auth');
        // If we have a saved email, show login view instead of register
        if (savedEmail) showAuthView('login');
    }
});

// ── Navigation ─────────────────────────────────────────

function navigateTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) {
        page.classList.add('active');
        page.style.animation = 'none';
        page.offsetHeight; // trigger reflow
        page.style.animation = '';
        window.scrollTo(0, 0);
    }

    // Show/hide nav actions
    const navActions = document.getElementById('navActions');
    if (currentUser && pageId !== 'auth') {
        navActions.style.display = 'flex';
        document.getElementById('navUser').textContent = currentUser.name || currentUser.email;
    } else {
        navActions.style.display = 'none';
    }

    // Update dashboard welcome
    if (pageId === 'dashboard' && currentUser) {
        const name = currentUser.name?.split(' ')[0] || 'there';
        document.getElementById('dashWelcome').innerHTML =
            `Hey <span>${escapeHtml(name)}</span> 👋 Ready to craft some killer questions?`;
    }

    // Load settings when navigating to settings page
    if (pageId === 'settings' && currentUser) {
        loadSettingsPage();
    }

    if (window.lucide) lucide.createIcons();
}

// ── Auth Views ────────────────────────────────────────

function showAuthView(view) {
    document.querySelectorAll('.auth-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
}

// ── Login ──────────────────────────────────────────────

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    setLoading(btn, true);
    try {
        const res = await apiFetch('/api/auth/login', 'POST', { email, password });
        token = res.token;
        localStorage.setItem('iq_token', token);
        currentUser = res.user;

        // Remember me
        const rememberCheckbox = document.getElementById('rememberMe');
        if (rememberCheckbox && rememberCheckbox.checked) {
            localStorage.setItem('iq_remembered_email', email);
        } else {
            localStorage.removeItem('iq_remembered_email');
        }

        if (!currentUser.profileComplete) {
            navigateTo('setup');
            prefillSetup();
        } else {
            navigateTo('dashboard');
        }
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

// ── Register ───────────────────────────────────────────

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn = document.getElementById('registerBtn');

    setLoading(btn, true);
    try {
        const res = await apiFetch('/api/auth/register', 'POST', { email, password, name });
        token = res.token;
        localStorage.setItem('iq_token', token);
        currentUser = res.user;
        navigateTo('setup');
        prefillSetup();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

// ── Logout ────────────────────────────────────────────

function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('iq_token');
    navigateTo('auth');
    showAuthView('login');
}

// ── Profile Setup ──────────────────────────────────────

function prefillSetup() {
    if (currentUser) {
        document.getElementById('setupName').value = currentUser.name || '';
        document.getElementById('setupChannel').value = currentUser.channelDescription || '';
        document.getElementById('setupStyle').value = currentUser.interviewerStyle || '';
    }
}

async function handleProfileSetup(e) {
    e.preventDefault();
    const btn = document.getElementById('setupBtn');
    setLoading(btn, true);

    try {
        const updates = {
            name: document.getElementById('setupName').value.trim(),
            channelDescription: document.getElementById('setupChannel').value.trim(),
            interviewerStyle: document.getElementById('setupStyle').value.trim(),
            profileComplete: true,
        };

        const res = await apiFetch('/api/profile', 'PUT', updates);
        currentUser = res.user;
        navigateTo('dashboard');
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

// ── Load Profile ───────────────────────────────────────

async function loadProfile() {
    try {
        const res = await apiFetch('/api/profile', 'GET');
        currentUser = res.user;
        return true;
    } catch {
        return false;
    }
}

// ── Research Guest ─────────────────────────────────────

async function researchGuest() {
    // ── Prevent double-triggering ──
    if (isResearching) return;

    const guestName = document.getElementById('guestName').value.trim();
    if (!guestName) { showError("Please enter the guest's name"); return; }

    isResearching = true;

    const btn = document.getElementById('researchBtn');
    const nameInput = document.getElementById('guestName');
    const contextInput = document.getElementById('guestContext');

    // Lock all inputs during research
    setLoading(btn, true);
    if (nameInput) { nameInput.disabled = true; nameInput.style.opacity = '0.5'; }
    if (contextInput) { contextInput.disabled = true; contextInput.style.opacity = '0.5'; }

    // Show progress panel, hide results
    const progressEl = document.getElementById('researchProgress');
    const stepsEl = document.getElementById('progressSteps');
    const titleEl = document.getElementById('progressTitle');
    document.getElementById('researchResults').style.display = 'none';
    progressEl.style.display = 'block';
    stepsEl.innerHTML = '';
    titleEl.textContent = `Researching ${guestName}...`;
    progressEl.scrollIntoView({ behavior: 'smooth' });

    // Track step elements by step name
    const stepElements = {};

    function addOrUpdateStep(data) {
        const { step, status, message } = data;
        if (step === 'start' || step === 'complete') {
            // Update title only
            if (step === 'complete') titleEl.textContent = 'Research complete!';
            return;
        }

        if (stepElements[step]) {
            // Update existing step
            const el = stepElements[step];
            const iconEl = el.querySelector('.step-icon');
            const msgEl = el.querySelector('.step-message');
            msgEl.textContent = message;

            if (status === 'done') {
                el.className = 'progress-step done';
                iconEl.innerHTML = '<span class="step-check">✓</span>';
            } else if (status === 'error') {
                el.className = 'progress-step';
                iconEl.innerHTML = '<span class="step-error">✗</span>';
            }
        } else {
            // Create new step
            const el = document.createElement('div');
            el.className = `progress-step ${status === 'active' ? 'active' : 'done'}`;

            let iconHtml = '<div class="step-spinner"></div>';
            if (status === 'done') iconHtml = '<span class="step-check">✓</span>';
            if (status === 'error') iconHtml = '<span class="step-error">✗</span>';

            el.innerHTML = `
                <div class="step-icon">${iconHtml}</div>
                <span class="step-message">${escapeHtml(message)}</span>
            `;
            stepsEl.appendChild(el);
            stepElements[step] = el;
        }
    }

    try {
        const contextEl = document.getElementById('guestContext');
        const context = contextEl ? contextEl.value.trim() : '';

        const response = await fetch(API + '/api/research-guest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ guestName, context }),
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events (data: {...}\n\n)
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // Keep incomplete chunk

            for (const part of parts) {
                const lines = part.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const event = JSON.parse(line.slice(6));
                            if (event.type === 'progress') {
                                addOrUpdateStep(event);
                            } else if (event.type === 'result') {
                                researchData = event.data;
                                // Small delay to let the user see "complete"
                                setTimeout(() => {
                                    progressEl.style.display = 'none';
                                    displayResearch(researchData);
                                }, 800);
                            } else if (event.type === 'error') {
                                // Check for quota errors and show helpful message
                                const msg = event.message || '';
                                if (msg.includes('QUOTA_EXHAUSTED') || msg.includes('quota')) {
                                    showError(msg.replace('QUOTA_EXHAUSTED: ', ''));
                                } else {
                                    showError(msg);
                                }
                            }
                        } catch (parseErr) {
                            console.warn('SSE parse error:', parseErr);
                        }
                    }
                }
            }
        }
    } catch (err) {
        showError(err.message);
        progressEl.style.display = 'none';
    } finally {
        // Unlock all inputs after research completes
        isResearching = false;
        setLoading(btn, false);
        if (nameInput) { nameInput.disabled = false; nameInput.style.opacity = '1'; }
        if (contextInput) { contextInput.disabled = false; contextInput.style.opacity = '1'; }
    }
}

function displayResearch(data) {
    const transcriptNote = data.transcriptsAnalyzed > 0 ? ` · ${data.transcriptsAnalyzed} transcripts read` : '';
    document.getElementById('interviewCount').textContent = `${data.totalInterviewsFound} videos found${transcriptNote}`;

    const list = document.getElementById('interviewsList');
    list.innerHTML = data.interviews.map(iv => `
    <a class="interview-card" href="https://youtube.com/watch?v=${iv.videoId}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">
      <img class="interview-thumb" src="${iv.thumbnail || ''}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="interview-info">
        <div class="interview-title">${escapeHtml(iv.title)}</div>
        <div class="interview-channel">${escapeHtml(iv.channelTitle)}</div>
      </div>
    </a>
  `).join('');

    // Show video analysis if available
    const videoAnalysisEl = document.getElementById('videoAnalysis');
    if (data.videoAnalysis && videoAnalysisEl) {
        const analysisHtml = formatWebProfile(data.videoAnalysis);
        videoAnalysisEl.innerHTML = `
        <div class="web-profile-header">
          <i data-lucide="video" class="icon-sm"></i>
          <span>Interview Analysis</span>
          <span class="badge-source">${data.transcriptsAnalyzed} Transcripts</span>
        </div>
        <div class="web-profile-body">${analysisHtml}</div>
      `;
        videoAnalysisEl.style.display = 'block';
    } else if (videoAnalysisEl) {
        videoAnalysisEl.style.display = 'none';
    }

    // Show web profile if available
    const webProfileEl = document.getElementById('webProfile');
    if (data.webProfile && data.webProfile.profile && webProfileEl) {
        const profileHtml = formatWebProfile(data.webProfile.profile);

        let sourcesHtml = '';
        if (data.webProfile.sources && data.webProfile.sources.length > 0) {
            const sourceLinks = data.webProfile.sources.map(s => {
                const domain = s.title || new URL(s.url).hostname.replace('www.', '');
                return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="source-pill" title="${escapeHtml(s.url)}">${escapeHtml(domain)}</a>`;
            }).join('');
            sourcesHtml = `
              <div class="web-sources">
                <div class="sources-label"><i data-lucide="link" class="icon-sm"></i> Sources (${data.webProfile.sources.length})</div>
                <div class="sources-list">${sourceLinks}</div>
              </div>
            `;
        }

        webProfileEl.innerHTML = `
        <div class="web-profile-header">
          <i data-lucide="globe" class="icon-sm"></i>
          <span>Web Intelligence</span>
          <span class="badge-source">${data.webProfile.source === 'gemini-google-search' ? 'Live Search' : 'AI Knowledge'}</span>
        </div>
        <div class="web-profile-body">${profileHtml}</div>
        ${sourcesHtml}
      `;
        webProfileEl.style.display = 'block';
    } else if (webProfileEl) {
        webProfileEl.style.display = 'none';
    }

    document.getElementById('researchResults').style.display = 'block';
    document.getElementById('researchResults').scrollIntoView({ behavior: 'smooth' });

    if (window.lucide) lucide.createIcons();
}

function formatWebProfile(text) {
    // Convert the plain-text profile into styled HTML sections
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^### (.+)$/gm, '<h4 class="profile-section-title">$1</h4>')
        .replace(/^## (.+)$/gm, '<h3 class="profile-section-title">$1</h3>')
        .replace(/^# (.+)$/gm, '<h3 class="profile-section-title">$1</h3>')
        .replace(/^([A-Z][A-Z &/]+):$/gm, '<h4 class="profile-section-title">$1</h4>')
        .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="profile-list">$&</ul>')
        .replace(/\n{2,}/g, '<br><br>')
        .replace(/\n/g, '<br>');
}

// ── Generate Questions ─────────────────────────────────

async function generateQuestions() {
    const guestName = document.getElementById('guestName').value.trim();
    const guestContext = document.getElementById('guestContext').value.trim();
    const questionCount = parseInt(document.getElementById('questionCount').value);

    const btn = document.getElementById('generateBtn');
    setLoading(btn, true);

    try {
        const res = await apiFetch('/api/generate-questions', 'POST', {
            interviewerName: currentUser.name,
            interviewerStyle: currentUser.interviewerStyle,
            channelDescription: currentUser.channelDescription,
            guestName,
            guestContext,
            pastInterviewsSummary: researchData?.topicsSummary || '',
            questionCount,
        });

        if (res.success === false) {
            showError(res.error || 'Question generation failed. Please try again.');
            return;
        }
        displayQuestions(res.data, currentUser.name, guestName);
        navigateTo('results');
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

function displayQuestions(data, interviewerName, guestName) {
    document.getElementById('questionsSubtitle').textContent =
        `Tailored for ${interviewerName} interviewing ${guestName}`;

    const analysisEl = document.getElementById('guestAnalysis');
    if (data.guestAnalysis) {
        analysisEl.innerHTML = `
      <h4><i data-lucide="search-check" class="icon-sm"></i> Analysis</h4>
      <p>${escapeHtml(data.guestAnalysis)}</p>
    `;
        analysisEl.style.display = 'block';
    } else {
        analysisEl.style.display = 'none';
    }

    const container = document.getElementById('questionsContainer');
    container.innerHTML = '';

    if (data.categories && data.categories.length > 0) {
        data.categories.forEach((category, catIdx) => {
            const block = document.createElement('div');
            block.className = 'category-block';

            // Handle icon fallback if backend sends old 'emoji' key or invalid icon
            const iconName = category.icon || 'hash';

            let html = `
        <div class="category-header">
          <i data-lucide="${escapeHtml(iconName)}" class="category-icon"></i>
          <span class="category-name">${escapeHtml(category.name)}</span>
        </div>
      `;

            category.questions.forEach(q => {
                html += `
          <div class="question-card">
            <div class="question-text">${escapeHtml(q.question)}</div>
            <div class="question-meta">
              <span class="meta-label">Why:</span> ${escapeHtml(q.reasoning || '')}
            </div>
            <button class="btn-copy" title="Copy">
              <i data-lucide="copy" class="icon-sm"></i>
            </button>
          </div>
        `;
            });

            block.innerHTML = html;

            // Attach event listeners
            const cards = block.querySelectorAll('.question-card');
            category.questions.forEach((q, i) => {
                const btn = cards[i].querySelector('.btn-copy');
                btn.addEventListener('click', () => copyQuestion(btn, q.question));
            });

            container.appendChild(block);
        });
    }

    // Initialize new icons
    if (window.lucide) lucide.createIcons();
}

// ── Copy ───────────────────────────────────────────────

function copyQuestion(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied');
        // Change icon to check
        const icon = btn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', 'check');
            lucide.createIcons();
        }

        setTimeout(() => {
            btn.classList.remove('copied');
            if (icon) {
                icon.setAttribute('data-lucide', 'copy');
                lucide.createIcons();
            }
        }, 2000);
    }).catch(() => showError('Failed to copy'));
}

// ── Settings Page ──────────────────────────────────────

async function loadSettingsPage() {
    // Prefill profile
    if (currentUser) {
        document.getElementById('settingsName').value = currentUser.name || '';
        document.getElementById('settingsChannel').value = currentUser.channelDescription || '';
        document.getElementById('settingsStyle').value = currentUser.interviewerStyle || '';
    }

    // Load API key
    try {
        const res = await apiFetch('/api/settings/keys', 'GET');
        const keys = res.keys;

        const apiInput = document.getElementById('settingApiKey');
        apiInput.value = keys.hasApiKey ? keys.apiKey : '';

        // Update status indicator
        updateKeyStatus('apiKeyStatus', keys.hasApiKey);

        // Show/hide Pro mode banner
        const banner = document.getElementById('proModeBanner');
        if (banner) banner.style.display = keys.hasApiKey ? 'flex' : 'none';
    } catch (err) {
        console.error('Failed to load API key:', err);
    }
}

function updateKeyStatus(elementId, hasKey) {
    const el = document.getElementById(elementId);
    if (hasKey) {
        el.innerHTML = '<span class="key-active"><i data-lucide="check-circle" class="icon-xs"></i> Key saved — Pro mode active</span>';
    } else {
        el.innerHTML = '<span class="key-inactive"><i data-lucide="alert-circle" class="icon-xs"></i> No key — using Free mode</span>';
    }
    if (window.lucide) lucide.createIcons();
}

async function saveApiKeys() {
    const btn = document.getElementById('saveKeysBtn');
    setLoading(btn, true);

    try {
        const apiKey = document.getElementById('settingApiKey').value.trim();

        // Don't send masked values back (they contain • characters)
        if (apiKey.includes('•')) {
            showSuccess('No changes to save');
            return;
        }

        await apiFetch('/api/settings/keys', 'PUT', { apiKey });
        showSuccess(apiKey ? 'API key saved — Pro mode activated!' : 'API key cleared');

        // Reload to update statuses
        await loadSettingsPage();
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

async function clearApiKeys() {
    if (!confirm('Remove your API key? You will switch back to Free mode with limited usage.')) return;

    try {
        await apiFetch('/api/settings/keys', 'PUT', { apiKey: '' });

        document.getElementById('settingApiKey').value = '';

        showSuccess('API key cleared — switched to Free mode');
        await loadSettingsPage();
    } catch (err) {
        showError(err.message);
    }
}

function toggleKeyVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        const icon = btn.querySelector('i');
        if (icon) { icon.setAttribute('data-lucide', 'eye-off'); lucide.createIcons(); }
    } else {
        input.type = 'password';
        const icon = btn.querySelector('i');
        if (icon) { icon.setAttribute('data-lucide', 'eye'); lucide.createIcons(); }
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const btn = document.getElementById('updateProfileBtn');
    setLoading(btn, true);

    try {
        const updates = {
            name: document.getElementById('settingsName').value.trim(),
            channelDescription: document.getElementById('settingsChannel').value.trim(),
            interviewerStyle: document.getElementById('settingsStyle').value.trim(),
        };

        const res = await apiFetch('/api/profile', 'PUT', updates);
        currentUser = res.user;
        showSuccess('Profile updated!');
    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btn, false);
    }
}

// ── API Helper ─────────────────────────────────────────

async function apiFetch(url, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(API + url, opts);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
}

// ── Utilities ──────────────────────────────────────────

function setLoading(btn, loading) {
    if (loading) { btn.classList.add('loading'); btn.disabled = true; }
    else { btn.classList.remove('loading'); btn.disabled = false; }
}

// ── UI Interactions ────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Pill Selector Logic
    const pills = document.querySelectorAll('#countSelector .pill-btn');
    const hiddenInput = document.getElementById('questionCount');

    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            if (hiddenInput) hiddenInput.value = pill.dataset.value;
        });
    });

    // Enter Key Logic for Guest Name
    const nameInput = document.getElementById('guestName');
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                researchGuest();
            }
        });
    }

    // Context Input: Auto-expand + Enter Logic
    const contextInput = document.getElementById('guestContext');
    if (contextInput) {
        // Auto-expand height
        contextInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';

            // Toggle scrollbar if max-height reached (200px)
            if (this.scrollHeight > 200) {
                this.style.overflowY = 'auto';
            } else {
                this.style.overflowY = 'hidden';
            }
        });

        // Enter to submit, Shift+Enter for newline
        contextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Prevent default newline
                researchGuest();
            }
        });
    }
});

function showError(msg) {
    const toast = document.getElementById('errorToast');
    const msgEl = document.getElementById('toastMessage');
    msgEl.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 6000);
}

function showSuccess(msg) {
    const toast = document.getElementById('successToast');
    const msgEl = document.getElementById('successToastMessage');
    msgEl.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
