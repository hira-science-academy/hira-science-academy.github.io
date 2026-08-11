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
      background-color: #00796b; color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25); cursor: pointer; z-index: 9999;
      font-size: 24px; transition: transform 0.2s ease;
    }
    #hira-chat-btn:hover { transform: scale(1.08); }
    #hira-chat-window {
      position: fixed; bottom: 152px; right: 24px; width: 350px; height: 480px;
      background: white; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      display: none; flex-direction: column; z-index: 9999; overflow: hidden;
      font-family: Arial, sans-serif;
    }
    #hira-chat-header {
      background: #00796b; color: white; padding: 14px; font-weight: bold;
      display: flex; justify-content: space-between; align-items: center; font-size: 15px;
    }
    #hira-chat-close { cursor: pointer; font-size: 18px; }
    #hira-chat-messages {
      flex: 1; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
      background: #f8f9fa;
    }
    .hira-msg { padding: 10px 12px; border-radius: 12px; max-width: 85%; font-size: 13.5px; line-height: 1.5; word-wrap: break-word; }
    .hira-msg.user { background: #00796b; color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
    .hira-msg.bot { background: white; align-self: flex-start; border: 1px solid #e0e0e0; color: #222; border-bottom-left-radius: 2px; }
    .hira-msg p { margin: 0 0 6px 0; }
    .hira-msg p:last-child { margin-bottom: 0; }
    .hira-msg ul, .hira-msg ol { margin: 4px 0 6px 18px; padding: 0; }
    #hira-chat-input-area {
      display: flex; padding: 10px; border-top: 1px solid #eee; background: white; gap: 6px;
    }
    #hira-chat-input {
      flex: 1; padding: 9px 12px; border: 1px solid #ccc; border-radius: 20px; outline: none; font-size: 13.5px;
    }
    #hira-chat-send {
      background: #00796b; color: white; border: none; padding: 0 16px;
      border-radius: 20px; cursor: pointer; font-weight: bold; font-size: 13px;
    }
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
