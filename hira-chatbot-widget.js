(function() {
  const widgetHTML = `
  <div id="hsa-chatbot-container" style="font-family: 'Inter', system-ui, -apple-system, sans-serif;">
    <button id="hsa-chat-toggle" onclick="toggleHsaChat()" aria-label="Open Chat Assistant">
      <img src="https://hiraacademy.com.pk/images/logo.webp" alt="Hira Science Academy Logo" width="32" height="32" style="border-radius: 50%; object-fit: cover;">
      <span class="hsa-toggle-badge">1</span>
    </button>
    <div id="hsa-chat-window" class="hsa-chat-hidden">
      <div class="hsa-chat-header">
        <div class="hsa-header-info">
          <img src="https://hiraacademy.com.pk/images/logo.webp" alt="HSA Logo" class="hsa-header-logo">
          <div>
            <h3 class="hsa-header-title">Hira Science Academy</h3>
            <p class="hsa-header-status"><span class="hsa-status-dot"></span> PECTAA Support Online</p>
          </div>
        </div>
        <button onclick="toggleHsaChat()" class="hsa-close-btn">&times;</button>
      </div>
      <div id="hsa-chat-messages" class="hsa-chat-body">
        <div class="hsa-message hsa-bot-msg">
          👋 Assalamu Alaikum! Welcome to <strong>Hira Science Academy</strong>. How can I help you with Class 9 & 10 notes, 2027 pairing schemes, or admissions today?
        </div>
        <div class="hsa-quick-pills">
          <button onclick="sendQuickMsg('Class 10 Notes')">📗 Class 10 Notes</button>
          <button onclick="sendQuickMsg('2027 Pairing Scheme')">📋 2027 Pairing Scheme</button>
          <button onclick="sendQuickMsg('Contact Info')">📞 Contact Info</button>
        </div>
      </div>
      <div class="hsa-chat-footer">
        <input type="text" id="hsa-chat-input" placeholder="Type your message..." onkeypress="handleKeyPress(event)">
        <button id="hsa-send-btn" onclick="sendMessage()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  </div>`;

  const widgetCSS = `
  :root {
    --hsa-primary: #0ea5e9;
    --hsa-primary-dark: #0284c7;
    --hsa-aurora-bg: linear-gradient(135deg, #0c4a6e 0%, #1e2a5e 50%, #4c1d95 100%);
    --hsa-gold: #facc15;
    --hsa-ink: #0b1220;
    --hsa-bg-light: #f8fafc;
  }
  #hsa-chatbot-container { position: fixed; bottom: 24px; right: 24px; z-index: 9999; }
  #hsa-chat-toggle { width: 60px; height: 60px; border-radius: 50%; background: var(--hsa-aurora-bg); border: 2px solid rgba(255, 255, 255, 0.3); box-shadow: 0 10px 25px -5px rgba(14, 165, 233, 0.5), 0 0 15px rgba(250, 204, 21, 0.4); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); position: relative; }
  #hsa-chat-toggle:hover { transform: scale(1.08); }
  .hsa-toggle-badge { position: absolute; top: -2px; right: -2px; background-color: var(--hsa-gold); color: var(--hsa-ink); font-size: 11px; font-weight: 800; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; }
  #hsa-chat-window { width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 100px); background: #ffffff; border-radius: 20px; box-shadow: 0 20px 50px rgba(11, 18, 32, 0.25); display: flex; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s; position: absolute; bottom: 75px; right: 0; border: 1px solid rgba(226, 232, 240, 0.8); }
  #hsa-chat-window.hsa-chat-hidden { opacity: 0; visibility: hidden; transform: translateY(20px) scale(0.95); pointer-events: none; }
  .hsa-chat-header { background: var(--hsa-aurora-bg); color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
  .hsa-header-info { display: flex; align-items: center; gap: 12px; }
  .hsa-header-logo { width: 38px; height: 38px; border-radius: 10px; border: 2px solid rgba(255, 255, 255, 0.3); object-fit: cover; }
  .hsa-header-title { margin: 0; font-size: 15px; font-weight: 700; color: #ffffff; font-family: Georgia, serif; }
  .hsa-header-status { margin: 2px 0 0 0; font-size: 11px; color: #bae6fd; display: flex; align-items: center; gap: 5px; }
  .hsa-status-dot { width: 7px; height: 7px; background-color: #22c55e; border-radius: 50%; display: inline-block; }
  .hsa-close-btn { background: transparent; border: none; color: rgba(255, 255, 255, 0.8); font-size: 24px; cursor: pointer; line-height: 1; }
  .hsa-close-btn:hover { color: var(--hsa-gold); }
  .hsa-chat-body { flex: 1; padding: 16px; background-color: var(--hsa-bg-light); overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .hsa-message { max-width: 82%; padding: 12px 16px; border-radius: 16px; font-size: 13.5px; line-height: 1.5; word-wrap: break-word; }
  .hsa-bot-msg { background: #ffffff; color: var(--hsa-ink); border-bottom-left-radius: 4px; border: 1px solid #e2e8f0; }
  .hsa-user-msg { background: linear-gradient(135deg, var(--hsa-primary) 0%, var(--hsa-primary-dark) 100%); color: #ffffff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .hsa-quick-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .hsa-quick-pills button { background: #ffffff; border: 1px solid #cbd5e1; color: #0284c7; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 20px; cursor: pointer; transition: all 0.2s ease; }
  .hsa-quick-pills button:hover { background: #e0f2fe; border-color: #38bdf8; }
  .hsa-chat-footer { padding: 12px; background: #ffffff; border-top: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; }
  #hsa-chat-input { flex: 1; border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px 14px; font-size: 13.5px; outline: none; }
  #hsa-chat-input:focus { border-color: var(--hsa-primary); }
  #hsa-send-btn { background: var(--hsa-primary); color: white; border: none; width: 40px; height: 40px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  #hsa-send-btn:hover { background: var(--hsa-primary-dark); }`;

  // Inject Styles
  const styleEl = document.createElement('style');
  styleEl.innerHTML = widgetCSS;
  document.head.appendChild(styleEl);

  // Inject HTML Container
  const divEl = document.createElement('div');
  divEl.innerHTML = widgetHTML;
  document.body.appendChild(divEl);
})();

// Chat Logic Functions
function toggleHsaChat() {
  const chatWin = document.getElementById('hsa-chat-window');
  if(chatWin) chatWin.classList.toggle('hsa-chat-hidden');
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}

function sendQuickMsg(text) {
  appendMessage(text, 'user');
  respondToMsg(text);
}

function sendMessage() {
  const input = document.getElementById('hsa-chat-input');
  if(!input) return;
  const text = input.value.trim();
  if (!text) return;

  appendMessage(text, 'user');
  input.value = '';
  respondToMsg(text);
}

function appendMessage(text, sender) {
  const body = document.getElementById('hsa-chat-messages');
  if(!body) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `hsa-message ${sender === 'user' ? 'hsa-user-msg' : 'hsa-bot-msg'}`;
  msgDiv.innerHTML = text;
  body.appendChild(msgDiv);
  body.scrollTop = body.scrollHeight;
}

function respondToMsg(userText) {
  const lower = userText.toLowerCase();
  let reply = "Thank you for reaching out! You can browse all study resources and notes directly on our site.";

  if (lower.includes('10th') || lower.includes('class 10')) {
    reply = "📗 <strong>Class 10 Notes (2026 PECTAA Syllabus)</strong> are available for Mathematics, Physics, Chemistry, Biology, and Pak Studies! Check out the Class 10 section above.";
  } else if (lower.includes('pairing') || lower.includes('scheme') || lower.includes('2027')) {
    reply = "📋 You can download the <strong>Class 9 & 10 2027 Pairing Scheme PDF</strong> directly from our Pairing Scheme hub page!";
  } else if (lower.includes('contact') || lower.includes('phone') || lower.includes('address')) {
    reply = "📞 <strong>Contact Details:</strong><br>• Sir Muhammad Tayyab: 0333 8114798<br>• Sir Mirza Abid: 0346 4645878<br>📍 Location: Near Masjid Usman Ghani, Model Town, Daska";
  }

  setTimeout(() => {
    appendMessage(reply, 'bot');
  }, 500);
}
