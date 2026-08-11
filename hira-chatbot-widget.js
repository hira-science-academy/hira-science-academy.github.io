(function() {
  const API_ENDPOINT = 'https://hira-academy-agent-git-main-hira-academy.vercel.app/api/chat'; 
  
  const style = document.createElement('style');
  style.innerHTML = `
    #hira-chat-btn {
      position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px;
      background-color: #00796b; color: white; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2); cursor: pointer; z-index: 9999;
      font-size: 26px; transition: transform 0.2s ease;
    }
    #hira-chat-btn:hover { transform: scale(1.08); }
    #hira-chat-window {
      position: fixed; bottom: 90px; right: 20px; width: 340px; height: 460px;
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
    .hira-msg { padding: 10px 12px; border-radius: 12px; max-width: 82%; font-size: 13.5px; line-height: 1.4; word-wrap: break-word; }
    .hira-msg.user { background: #00796b; color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
    .hira-msg.bot { background: white; align-self: flex-start; border: 1px solid #e0e0e0; color: #222; border-bottom-left-radius: 2px; }
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
      document.getElementById(loadingId).innerText = data.reply || data.error;
      conversationHistory.push({ role: 'model', content: data.reply });

    } catch (err) {
      document.getElementById(loadingId).innerText = "Unable to connect. Please try again.";
    }
  }

  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `hira-msg ${role}`;
    msgDiv.id = 'msg-' + Date.now();
    msgDiv.innerText = text;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv.id;
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
})();
