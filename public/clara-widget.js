(function() {
  'use strict';
  var API = 'https://www.sentimetrx.ai/api/clara-chat';
  var SUGGESTIONS = [
    'What is Craniometrix?',
    "I'm a caregiver — how can you help?",
    'How does the GUIDE program work?',
    "I'm a provider interested in GUIDE",
  ];

  var messages = [
    { role: 'assistant', content: "Hi, I'm Clara — your Craniometrix assistant. I'm here to help you learn about how we support dementia patients, caregivers, and providers. Are you a caregiver or a healthcare provider?" }
  ];
  var loading = false;

  // Inject CSS
  var style = document.createElement('style');
  style.textContent = [
    '@keyframes claraDot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}',
    '.clara-fab{position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#8ae0e5,#5bbfc4);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(138,224,229,.4);transition:transform .2s,box-shadow .2s;font-family:system-ui,sans-serif}',
    '.clara-fab:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(138,224,229,.5)}',
    '.clara-fab svg{width:28px;height:28px;fill:#2f3c4c}',
    '.clara-fab .cf-close{display:none}',
    '.clara-fab.open .cf-open{display:none}',
    '.clara-fab.open .cf-close{display:block}',
    '.clara-panel{position:fixed;bottom:5.5rem;right:1.5rem;z-index:99998;width:380px;max-height:520px;background:#f6fdfe;border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.15),0 0 0 1px #d8eff0;display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.95);pointer-events:none;transition:opacity .25s,transform .25s;font-family:"Be Vietnam Pro","Nunito Sans",system-ui,sans-serif}',
    '.clara-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
    '.clara-hdr{background:linear-gradient(135deg,#2f3c4c,#1e2a36);padding:1rem 1.25rem;display:flex;align-items:center;gap:.65rem;flex-shrink:0}',
    '.clara-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#8ae0e5,#5bbfc4);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;color:#2f3c4c}',
    '.clara-hdr-title{color:#fff;font-weight:700;font-size:.9rem}',
    '.clara-hdr-sub{color:rgba(255,255,255,.45);font-size:.7rem}',
    '.clara-reset{margin-left:auto;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.3);background:transparent;color:rgba(255,255,255,.7);font-size:.65rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}',
    '.clara-reset:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.clara-msgs{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.75rem;scroll-behavior:smooth}',
    '.clara-msgs::-webkit-scrollbar{width:4px}.clara-msgs::-webkit-scrollbar-thumb{background:#d8eff0;border-radius:4px}',
    '.clara-msg{display:flex;gap:.5rem;max-width:88%}',
    '.clara-msg.user{align-self:flex-end;flex-direction:row-reverse}',
    '.clara-msg-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#8ae0e5,#5bbfc4);display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#2f3c4c;font-weight:700}',
    '.clara-bubble{padding:.6rem .85rem;border-radius:16px 16px 16px 4px;background:#fff;border:1px solid #d8eff0;font-size:.82rem;line-height:1.55;color:#1a1a1a}',
    '.clara-msg.user .clara-bubble{background:#2f3c4c;color:#fff;border:none;border-radius:16px 16px 4px 16px}',
    '.clara-sug{display:flex;flex-wrap:wrap;gap:.4rem;padding:0 1rem .75rem}',
    '.clara-sug button{padding:.4rem .85rem;border-radius:20px;background:#fff;border:1.5px solid #d8eff0;color:#566476;font-size:.72rem;font-weight:500;cursor:pointer;font-family:inherit;transition:border-color .15s,color .15s}',
    '.clara-sug button:hover{border-color:#8ae0e5;color:#2f3c4c}',
    '.clara-dots{padding:.6rem 1rem;border-radius:16px 16px 16px 4px;background:#fff;border:1px solid #d8eff0;display:flex;gap:5px;align-items:center}',
    '.clara-dots span{width:7px;height:7px;border-radius:50%;background:#8ae0e5;animation:claraDot 1.4s infinite ease-in-out both}',
    '.clara-dots span:nth-child(2){animation-delay:.2s}.clara-dots span:nth-child(3){animation-delay:.4s}',
    '.clara-input{padding:.65rem .85rem;border-top:1px solid #d8eff0;display:flex;gap:.5rem;align-items:flex-end;flex-shrink:0;background:#fff}',
    '.clara-input textarea{flex:1;resize:none;padding:.55rem .85rem;border-radius:20px;border:1.5px solid #d8eff0;outline:none;font-size:.82rem;font-family:inherit;line-height:1.45;max-height:80px;background:#f6fdfe}',
    '.clara-input textarea:focus{border-color:#8ae0e5}',
    '.clara-input textarea::placeholder{color:#a0b0b8}',
    '.clara-send{width:36px;height:36px;border-radius:50%;background:#d8eff0;color:#fff;border:none;cursor:default;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;flex-shrink:0;transition:background .15s}',
    '.clara-send.active{background:#2f3c4c;cursor:pointer}',
    '@media(max-width:500px){.clara-panel{right:.5rem;left:.5rem;bottom:5rem;width:auto;max-height:70vh}.clara-fab{bottom:1rem;right:1rem;width:54px;height:54px}}'
  ].join('\n');
  document.head.appendChild(style);

  // FAB
  var fab = document.createElement('button');
  fab.className = 'clara-fab';
  fab.setAttribute('aria-label', 'Open chat');
  fab.innerHTML = '<svg class="cf-open" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg><svg class="cf-close" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  document.body.appendChild(fab);

  // Panel
  var panel = document.createElement('div');
  panel.className = 'clara-panel';
  panel.innerHTML = '<div class="clara-hdr"><div class="clara-av">C</div><div><div class="clara-hdr-title">Clara</div><div class="clara-hdr-sub">Craniometrix Assistant</div></div><button class="clara-reset" id="clara-reset" style="display:none">New Conversation</button></div><div class="clara-msgs" id="clara-msgs"></div><div class="clara-sug" id="clara-sug"></div><div class="clara-input"><textarea id="clara-inp" rows="1" placeholder="Ask Clara about Craniometrix..."></textarea><button class="clara-send" id="clara-send">&#8593;</button></div>';
  document.body.appendChild(panel);

  var msgsEl = document.getElementById('clara-msgs');
  var sugEl = document.getElementById('clara-sug');
  var inp = document.getElementById('clara-inp');
  var sendBtn = document.getElementById('clara-send');
  var resetBtn = document.getElementById('clara-reset');
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
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline">$1</a>')
      .replace(/(?<![\/\w])((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|ai|io)(?:\/[^\s<)]*)?)/g, function(m) { return m.indexOf('href=') !== -1 ? m : '<a href="https://' + m + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">' + m + '</a>'; });
  }

  function render() {
    msgsEl.innerHTML = '';
    var lastWrap = null;
    messages.forEach(function(msg) {
      var wrap = document.createElement('div');
      wrap.className = 'clara-msg' + (msg.role === 'user' ? ' user' : '');
      if (msg.role === 'assistant') {
        var av = document.createElement('div');
        av.className = 'clara-msg-av';
        av.textContent = 'C';
        wrap.appendChild(av);
      }
      var bubble = document.createElement('div');
      bubble.className = 'clara-bubble';
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
    w.className = 'clara-msg';
    w.id = 'clara-typing';
    var av = document.createElement('div');
    av.className = 'clara-msg-av';
    av.textContent = 'C';
    var d = document.createElement('div');
    d.className = 'clara-dots';
    d.innerHTML = '<span></span><span></span><span></span>';
    w.appendChild(av); w.appendChild(d);
    msgsEl.appendChild(w);
    requestAnimationFrame(function() { msgsEl.scrollTop = msgsEl.scrollHeight; });
  }

  function hideTyping() {
    var el = document.getElementById('clara-typing');
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
