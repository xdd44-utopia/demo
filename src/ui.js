import { triggerSync, getSelectedIds } from './sync.js';

const messagesEl   = document.getElementById('messages');
const inputEl      = document.getElementById('message-input');
const sendBtn      = document.getElementById('send-btn');
const convListEl   = document.getElementById('conv-list');
const newConvBtn   = document.getElementById('new-conv-btn');
const settingsBtn  = document.getElementById('settings-btn');
const settingsDrw  = document.getElementById('settings-drawer');
const selBadge     = document.getElementById('selection-badge');

// Per-conversation display messages: convId → [{text, role}]
const convMessages = new Map();
let activeConvId = null;

// ── Settings drawer ────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  settingsDrw.classList.toggle('open');
});

// ── Phase indicator ────────────────────────────────────────────────────────
let _phaseTimer = null;

function setPhase(label) {
  clearInterval(_phaseTimer);
  sendBtn.disabled = true;
  sendBtn.classList.add('loading');
  let n = 0;
  sendBtn.textContent = label;
  _phaseTimer = setInterval(() => {
    n = (n % 3) + 1;
    sendBtn.textContent = label + '.'.repeat(n);
  }, 380);
}

function clearPhase() {
  clearInterval(_phaseTimer);
  _phaseTimer = null;
  sendBtn.classList.remove('loading');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';
}

// ── Conversation list rendering ────────────────────────────────────────────
function renderConvList(conversations) {
  convListEl.innerHTML = '';
  for (const conv of conversations) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === activeConvId ? ' active' : '');
    item.dataset.id = conv.id;

    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = conv.title;

    const del = document.createElement('button');
    del.className = 'conv-delete';
    del.textContent = '×';
    del.title = 'Delete conversation';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      await deleteConversation(conv.id);
    });

    item.append(title, del);
    item.addEventListener('click', () => switchConversation(conv.id, conv.title));
    convListEl.appendChild(item);
  }
}

function updateConvTitle(id, title) {
  const item = convListEl.querySelector(`.conv-item[data-id="${id}"] .conv-title`);
  if (item) item.textContent = title;
}

// ── Switching conversations ────────────────────────────────────────────────
function switchConversation(id, title) {
  activeConvId = id;

  convListEl.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  messagesEl.innerHTML = '';
  const stored = convMessages.get(id) || [];
  if (stored.length === 0) {
    const p = document.createElement('p');
    p.className = 'placeholder-msg';
    p.innerHTML = 'Describe what you\'d like to create<br>or modify in the scene.';
    messagesEl.appendChild(p);
  } else {
    for (const { text, role } of stored) renderMessage(text, role);
  }
}

// ── Message rendering ──────────────────────────────────────────────────────
function renderMessage(text, role) {
  const placeholder = messagesEl.querySelector('.placeholder-msg');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function appendMessage(text, role) {
  renderMessage(text, role);
  if (activeConvId) {
    if (!convMessages.has(activeConvId)) convMessages.set(activeConvId, []);
    convMessages.get(activeConvId).push({ text, role });
  }
}

// ── API helpers ────────────────────────────────────────────────────────────
async function loadAndRenderConversations() {
  const res = await fetch('/api/conversations');
  const list = await res.json();
  renderConvList(list);
  return list;
}

async function createNewConversation() {
  const res = await fetch('/api/conversations', { method: 'POST' });
  const conv = await res.json();
  convMessages.set(conv.id, []);
  const list = await loadAndRenderConversations();
  switchConversation(conv.id, conv.title);
  return conv;
}

async function deleteConversation(id) {
  await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  convMessages.delete(id);
  const list = await loadAndRenderConversations();
  if (id === activeConvId) {
    if (list.length > 0) {
      switchConversation(list[0].id, list[0].title);
    } else {
      await createNewConversation();
    }
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
export function initUI() {
  window.addEventListener('rhino-selection', e => {
    const n = e.detail.count;
    if (n > 0) {
      selBadge.textContent = `${n} object${n === 1 ? '' : 's'} selected — prompt will target selection`;
      selBadge.style.display = 'block';
    } else {
      selBadge.style.display = 'none';
    }
  });

  newConvBtn.addEventListener('click', () => createNewConversation());

  sendBtn.addEventListener('click', async () => {
    const text = inputEl.value.trim();
    if (!text || !activeConvId) return;
    const selectedIds = getSelectedIds();
    appendMessage(text, 'user');
    inputEl.value = '';
    inputEl.focus();

    try {
      setPhase('Prompting');
      const body = { conversationId: activeConvId, message: text };
      if (selectedIds.length > 0) body.selectedIds = selectedIds;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.text) appendMessage(data.text, 'assistant');
      if (data.title) updateConvTitle(activeConvId, data.title);
      if (data.toolsUsed) {
        setPhase('Syncing');
        await triggerSync(true);
      }
    } catch (err) {
      appendMessage(`Error: ${err.message}`, 'assistant');
    } finally {
      clearPhase();
    }
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  loadAndRenderConversations().then(async list => {
    if (list.length > 0) {
      switchConversation(list[0].id, list[0].title);
    } else {
      await createNewConversation();
    }
  });
}
