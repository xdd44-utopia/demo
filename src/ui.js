const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('message-input');
const sendBtn    = document.getElementById('send-btn');

export function appendMessage(text, role) {
  const placeholder = messagesEl.querySelector('.placeholder-msg');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function initUI() {
  sendBtn.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (!text) return;
    appendMessage(text, 'user');
    inputEl.value = '';
    inputEl.focus();
    // Backend integration point — no-op for now
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
}
