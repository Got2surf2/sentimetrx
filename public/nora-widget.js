(function() {
  'use strict';
  var API = 'https://www.sentimetrx.ai/api/nora-chat';
  var SUGGESTIONS = [
    'What kind of food do you serve?',
    'Where are your locations?',
    'How do I make a reservation?',
    'Do you have vegetarian options?',
  ];

  var messages = [
    { role: 'assistant', content: "Welcome to Tabla! I'm Nora, your virtual host. I can help you find a location, explore the menu, make a reservation, or learn about catering. What can I help you with?" }
  ];
  var loading = false;

  var style = document.createElement('style');
  style.textContent = [
    '@keyframes noraDot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}',
    '.nora-fab{position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#D4A843,#B8922F);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(212,168,67,.4);transition:transform .2s,box-shadow .2s;font-family:system-ui,sans-serif}',
    '.nora-fab:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(212,168,67,.5)}',
    '.nora-fab svg{width:28px;height:28px;fill:#5C1010}',
    '.nora-fab .nf-close{display:none}',
    '.nora-fab.open .nf-open{display:none}',
    '.nora-fab.open .nf-close{display:block}',
    '.nora-panel{position:fixed;bottom:5.5rem;right:1.5rem;z-index:99998;width:380px;max-height:520px;background:#FDF8F3;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.15),0 0 0 1px #E8DDD0;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.95);pointer-events:none;transition:opacity .25s,transform .25s;font-family:system-ui,-apple-system,sans-serif}',
    '.nora-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
    '.nora-hdr{background:linear-gradient(135deg,#8B1A1A,#5C1010);padding:1rem 1.25rem;display:flex;align-items:center;gap:.65rem;flex-shrink:0}',
    '.nora-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#D4A843,#B8922F);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;color:#5C1010}',
    '.nora-hdr-title{color:#fff;font-weight:700;font-size:.9rem;font-family:Georgia,serif}',
    '.nora-hdr-sub{color:rgba(255,255,255,.45);font-size:.7rem}',
    '.nora-reset{margin-left:auto;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.3);background:transparent;color:rgba(255,255,255,.7);font-size:.65rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}',
    '.nora-reset:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.nora-msgs{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.75rem;scroll-behavior:smooth}',
    '.nora-msgs::-webkit-scrollbar{width:4px}.nora-msgs::-webkit-scrollbar-thumb{background:#E8DDD0;border-radius:4px}',
    '.nora-msg{display:flex;gap:.5rem;max-width:88%}',
    '.nora-msg.user{align-self:flex-end;flex-direction:row-reverse}',
    '.nora-msg-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#D4A843,#B8922F);display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#5C1010;font-weight:700}',
    '.nora-bubble{padding:.6rem .85rem;border-radius:16px 16px 16px 4px;background:#fff;border:1px solid #E8DDD0;font-size:.82rem;line-height:1.55;color:#1a1a1a}',
    '.nora-msg.user .nora-bubble{background:#8B1A1A;color:#fff;border:none;border-radius:16px 16px 4px 16px}',
    '.nora-sug{display:flex;flex-wrap:wrap;gap:.4rem;padding:0 1rem .75rem}',
    '.nora-sug button{padding:.4rem .85rem;border-radius:20px;background:#fff;border:1.5px solid #E8DDD0;color:#8B6914;font-size:.72rem;font-weight:500;cursor:pointer;font-family:inherit;transition:border-color .15s,color .15s}',
    '.nora-sug button:hover{border-color:#D4A843;color:#8B1A1A}',
    '.nora-dots{padding:.6rem 1rem;border-radius:16px 16px 16px 4px;background:#fff;border:1px solid #E8DDD0;display:flex;gap:5px;align-items:center}',
    '.nora-dots span{width:7px;height:7px;border-radius:50%;background:#D4A843;animation:noraDot 1.4s infinite ease-in-out both}',
    '.nora-dots span:nth-child(2){animation-delay:.2s}.nora-dots span:nth-child(3){animation-delay:.4s}',
    '.nora-input{padding:.65rem .85rem;border-top:1px solid #E8DDD0;display:flex;gap:.5rem;align-items:flex-end;flex-shrink:0;background:#fff}',
    '.nora-input textarea{flex:1;resize:none;padding:.55rem .85rem;border-radius:20px;border:1.5px solid #E8DDD0;outline:none;font-size:.82rem;font-family:inherit;line-height:1.45;max-height:80px;background:#FDF8F3}',
    '.nora-input textarea:focus{border-color:#D4A843}',
    '.nora-input textarea::placeholder{color:#B8ADA0}',
    '.nora-send{width:36px;height:36px;border-radius:50%;background:#E8DDD0;color:#fff;border:none;cursor:default;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;flex-shrink:0;transition:background .15s}',
    '.nora-send.active{background:#8B1A1A;cursor:pointer}',
    '@media(max-width:500px){.nora-panel{right:.5rem;left:.5rem;bottom:5rem;width:auto;max-height:70vh}.nora-fab{bottom:1rem;right:1rem;width:54px;height:54px}}'
  ].join('\n');
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.className = 'nora-fab';
  fab.setAttribute('aria-label', 'Open chat');
  fab.innerHTML = '<svg class="nf-open" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg><svg class="nf-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  document.body.appendChild(fab);

  var panel = document.createElement('div');
  panel.className = 'nora-panel';
  panel.innerHTML = '<div class="nora-hdr"><div class="nora-av">N</div><div><div class="nora-hdr-title">Nora</div><div class="nora-hdr-sub">Tabla Cuisine Virtual Host</div></div><button class="nora-reset" id="nora-reset" style="display:none">New Conversation</button></div><div class="nora-msgs" id="nora-msgs"></div><div class="nora-sug" id="nora-sug"></div><div class="nora-input"><textarea id="nora-inp" rows="1" placeholder="Ask Nora about Tabla..."></textarea><button class="nora-send" id="nora-send">&#8593;</button></div>';
  document.body.appendChild(panel);

  var msgsEl = document.getElementById('nora-msgs');
  var sugEl = document.getElementById('nora-sug');
  var inp = document.getElementById('nora-inp');
  var sendBtn = document.getElementById('nora-send');
  var resetBtn = document.getElementById('nora-reset');
  var INITIAL_MSG = messages[0];

  function toggle() {
    var open = panel.classList.toggle('open');
    fab.classList.toggle('open', open);
    if (open) setTimeout(function() { inp.focus(); }, 300);
  }

  function fmt(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
      .replace(/- /g, '&bull; ')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>')
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline">$1</a>');
  }

  function render() {
    msgsEl.innerHTML = '';
    var lastWrap = null;
    messages.forEach(function(msg) {
      var wrap = document.createElement('div');
      wrap.className = 'nora-msg' + (msg.role === 'user' ? ' user' : '');
      if (msg.role === 'assistant') {
        var av = document.createElement('div');
        av.className = 'nora-msg-av';
        av.textContent = 'N';
        wrap.appendChild(av);
      }
      var bubble = document.createElement('div');
      bubble.className = 'nora-bubble';
      bubble.innerHTML = fmt(msg.content);
      wrap.appendChild(bubble);
      msgsEl.appendChild(wrap);
      lastWrap = wrap;
    });
    var last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && messages.length > 1 && lastWrap) {
      requestAnimationFrame(function() { lastWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    } else {
      requestAnimationFrame(function() { msgsEl.scrollTop = msgsEl.scrollHeight; });
    }
    sugEl.style.display = messages.length > 1 ? 'none' : 'flex';
    resetBtn.style.display = messages.length > 1 ? 'block' : 'none';
    updateSend();
  }

  function showTyping() {
    var w = document.createElement('div');
    w.className = 'nora-msg';
    w.id = 'nora-typing';
    var av = document.createElement('div');
    av.className = 'nora-msg-av';
    av.textContent = 'N';
    var d = document.createElement('div');
    d.className = 'nora-dots';
    d.innerHTML = '<span></span><span></span><span></span>';
    w.appendChild(av); w.appendChild(d);
    msgsEl.appendChild(w);
    requestAnimationFrame(function() { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }

  function hideTyping() {
    var el = document.getElementById('nora-typing');
    if (el) el.remove();
  }

  function updateSend() {
    var has = inp.value.trim().length > 0;
    sendBtn.classList.toggle('active', has && !loading);
  }

  function send(text) {
    if (!text.trim() || loading) return;
    messages.push({ role: 'user', content: text.trim() });
    inp.value = '';
    inp.style.height = 'auto';
    loading = true;
    render();
    showTyping();

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.map(function(m) { return { role: m.role, content: m.content }; }) })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      messages.push({ role: 'assistant', content: data.reply || 'Sorry, something went wrong.' });
    })
    .catch(function() {
      messages.push({ role: 'assistant', content: "I'm having trouble connecting. Please try again." });
    })
    .finally(function() {
      loading = false;
      hideTyping();
      render();
      setTimeout(function() { inp.focus(); }, 100);
    });
  }

  fab.addEventListener('click', toggle);
  resetBtn.addEventListener('click', function() {
    messages.length = 0;
    messages.push(INITIAL_MSG);
    loading = false;
    inp.value = '';
    render();
  });
  sendBtn.addEventListener('click', function() { send(inp.value); });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); }
  });
  inp.addEventListener('input', function() {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 80) + 'px';
    updateSend();
  });

  SUGGESTIONS.forEach(function(s) {
    var btn = document.createElement('button');
    btn.textContent = s;
    btn.addEventListener('click', function() { send(s); });
    sugEl.appendChild(btn);
  });

  render();

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) toggle();
  });
})();
