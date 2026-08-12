(function() {
  const API_ENDPOINT = 'https://hira-academy-agent-pink.vercel.app/api/chat'; 

  // Dynamically load KaTeX & Marked.js for Markdown & LaTeX Math rendering
  const katexCSS = document.createElement('link');
  katexCSS.rel = 'stylesheet';
  katexCSS.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  document.head.appendChild(katexCSS);

  const markedScript = document.createElement('script');
  markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
  document.head.appendChild(markedScript);

  const katexScript = document.createElement('script');
  katexScript.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
  document.head.appendChild(katexScript);

  const autoRenderScript = document.createElement('script');
  autoRenderScript.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';
  document.head.appendChild(autoRenderScript);

  const style = document.createElement('style');
  style.innerHTML = `
    #hira-chat-btn {
      position: fixed; bottom: 85px; right: 24px; width: 56px; height: 56px;
      background: linear-gradient(135deg, #0c4a6e 0%, #1e2a5e 50%, #4c1d95 100%); 
      color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 10px 25px -5px rgba(14, 165, 233, 0.4), 0 0 15px rgba(250, 204, 21, 0.3); 
      cursor: pointer; z-index: 9999;
      font-size: 24px; transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }
    #hira-chat-btn:hover { 
      transform: scale(1.08); 
      box-shadow: 0 12px 30px -5px rgba(14, 165, 233, 0.6), 0 0 20px rgba(250, 204, 21, 0.5);
    }
    #hira-chat-window {
      position: fixed; bottom: 152px; right: 24px; width: 350px; height: 480px;
      background: white; border-radius: 16px; box-shadow: 0 20px 50px rgba(11, 18, 32, 0.25);
      display: none; flex-direction: column; z-index: 9999; overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      border: 1px solid rgba(226, 232, 240, 0.8);
    }
    #hira-chat-header {
      background: linear-gradient(135deg, #0c4a6e 0%, #1e2a5e 50%, #4c1d95 100%); 
      color: white; padding: 14px 16px; font-weight: bold;
      display: flex; justify-content: space-between; align-items: center; font-size: 15px;
      font-family: Georgia, serif;
    }
    #hira-chat-close { cursor: pointer; font-size: 20px; color: rgba(255,255,255,0.8); transition: color 0.2s; }
    #hira-chat-close:hover { color: #facc15; }
    #hira-chat-messages {
      flex: 1; padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
      background: #f8fafc;
    }
    .hira-msg { padding: 10px 14px; border-radius: 14px; max-width: 85%; font-size: 13.5px; line-height: 1.5; word-wrap: break-word; }
    .hira-msg.user { 
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); 
      color: white; align-self: flex-end; border-bottom-right-radius: 4px; 
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.25);
    }
    .hira-msg.bot { 
      background: white; align-self: flex-start; border: 1px solid #e2e8f0; 
      color: #0b1220; border-bottom-left-radius: 4px; 
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    .hira-msg p { margin: 0 0 6px 0; }
    .hira-msg p:last-child { margin-bottom: 0; }
    .hira-msg ul, .hira-msg ol { margin: 4px 0 6px 18px; padding: 0; }
    #hira-chat-input-area {
      display: flex; padding: 12px; border-top: 1px solid #e2e8f0; background: white; gap: 8px;
    }
    #hira-chat-input {
      flex: 1; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 20px; outline: none; font-size: 13.5px;
      transition: border-color 0.2s;
    }
    #hira-chat-input:focus { border-color: #0ea5e9; }
    #hira-chat-send {
      background: #0ea5e9; color: white; border: none; padding: 0 16px;
      border-radius: 20px; cursor: pointer; font-weight: bold; font-size: 13px;
      transition: background 0.2s;
    }
    #hira-chat-send:hover { background: #0284c7; }
  `;
  document.head.appendChild(style);

  const widgetContainer = document.createElement('div');
  widgetContainer.innerHTML = `
    <div id="hira-chat-btn" title="Chat with Hira Assistant">💬</div>
    <div id="hira-chat-window">
      <div id="hira-chat-header">
        <span>Hira Academy Assistant</span>
        <span id="hira-chat-close">✖</span>
      </div>
      <div id="hira-chat-messages">
        <div class="hira-msg bot">Assalam-o-Alaikum! I am your Hira Academy assistant. Ask me anything about Class 9 & 10 Physics or Math!</div>
      </div>
      <div id="hira-chat-input-area">
        <input type="text" id="hira-chat-input" placeholder="Type your question..." />
        <button id="hira-chat-send">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(widgetContainer);

  const btn = document.getElementById('hira-chat-btn');
  const chatWindow = document.getElementById('hira-chat-window');
  const closeBtn = document.getElementById('hira-chat-close');
  const messagesDiv = document.getElementById('hira-chat-messages');
  const inputEl = document.getElementById('hira-chat-input');
  const sendBtn = document.getElementById('hira-chat-send');

  let conversationHistory = [];
  let lastMessageTime = 0;
  const COOLDOWN_TIME = 4000; // 4 seconds cooldown between messages

  btn.addEventListener('click', () => chatWindow.style.display = chatWindow.style.display === 'flex' ? 'none' : 'flex');
  closeBtn.addEventListener('click', () => chatWindow.style.display = 'none');

  function renderFormattedContent(element, text) {
    if (window.marked) {
      element.innerHTML = window.marked.parse(text);
    } else {
      element.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    }

    if (window.renderMathInElement) {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    }
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    // Cooldown Check to protect API quota
    const now = Date.now();
    if (now - lastMessageTime < COOLDOWN_TIME) {
      const remainingSecs = Math.ceil((COOLDOWN_TIME - (now - lastMessageTime)) / 1000);
      appendMessage('bot', `⚠️ Please wait ${remainingSecs}s before sending another message to keep our free assistant running smoothly.`);
      return;
    }
    lastMessageTime = Date.now();

    appendMessage('user', text);
    inputEl.value = '';
    conversationHistory.push({ role: 'user', content: text });

    const loadingId = appendMessage('bot', 'Thinking...');

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationHistory })
      });
      
      const data = await response.json();
      const reply = data.reply || data.error || 'No response returned.';
      const botMsgDiv = document.getElementById(loadingId);
      renderFormattedContent(botMsgDiv, reply);
      conversationHistory.push({ role: 'model', content: reply });

    } catch (err) {
      document.getElementById(loadingId).innerText = "Unable to connect. Please try again.";
    }
  }

  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `hira-msg ${role}`;
    msgDiv.id = 'msg-' + Date.now();
    
    if (role === 'user') {
      msgDiv.innerText = text;
    } else {
      renderFormattedContent(msgDiv, text);
    }

    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv.id;
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
})();
