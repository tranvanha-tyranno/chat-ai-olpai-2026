const LIMIT = 3000;
const state = { userId: null, sessionId: null, messages: [], usedTokens: 0 };

const elements = {
  login: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginId: document.querySelector("#login-id"),
  loginError: document.querySelector("#login-error"),
  app: document.querySelector("#app-shell"),
  welcome: document.querySelector("#welcome"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chat-form"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  usage: document.querySelector("#usage-text"),
  bar: document.querySelector("#usage-bar"),
  session: document.querySelector("#session-label"),
  toast: document.querySelector("#toast"),
  stage: document.querySelector("#chat-stage"),
  accountId: document.querySelector("#account-id"),
  accountAvatar: document.querySelector("#account-avatar"),
};

function persist() {
  if (!state.userId) return;
  localStorage.setItem("qwen-active-user", state.userId);
  localStorage.setItem(`qwen:${state.userId}:session-id`, state.sessionId || "");
}

function updateUsage(usage = {}) {
  if (typeof usage.used === "number") state.usedTokens = usage.used;
  const percent = Math.min(100, Math.round((state.usedTokens / LIMIT) * 100));
  elements.usage.textContent = `${state.usedTokens.toLocaleString("vi-VN")} / 3.000 token`;
  elements.bar.style.width = `${percent}%`;
  elements.bar.style.background = percent > 85 ? "#e39f45" : "var(--lime-dark)";
  persist();
}

function renderMessage(message) {
  const item = document.createElement("div");
  item.className = `message ${message.role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "assistant" ? "✦" : "•";
  const content = document.createElement("div");
  content.className = "message-content";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = message.role === "assistant" ? "QWEN3 32B" : "BẠN";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.content;
  content.append(meta, bubble);
  item.append(avatar, content);
  elements.messages.appendChild(item);
}

function renderAll() {
  elements.messages.innerHTML = "";
  state.messages.forEach(renderMessage);
  elements.welcome.style.display = state.messages.length ? "none" : "block";
  if (state.messages.length) requestAnimationFrame(() => { elements.stage.scrollTop = elements.stage.scrollHeight; });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 3500);
}

function setLoading(loading) {
  elements.send.disabled = loading;
  elements.input.disabled = loading;
  if (loading) {
    const typing = document.createElement("div");
    typing.className = "message assistant typing";
    typing.id = "typing";
    typing.innerHTML = '<div class="message-avatar">✦</div><div class="bubble"><i></i><i></i><i></i></div>';
    elements.messages.appendChild(typing);
    elements.stage.scrollTop = elements.stage.scrollHeight;
  } else document.querySelector("#typing")?.remove();
}

async function login(userId) {
  const id = userId.trim();
  if (!id) return;
  elements.loginError.textContent = "";
  const button = elements.loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Không thể đăng nhập.");
    state.userId = data.user.id;
    state.sessionId = crypto.randomUUID();
    state.messages = Array.isArray(data.messages) ? data.messages : [];
    state.usedTokens = Number(data.usage?.used) || 0;
    elements.accountId.textContent = state.userId;
    elements.accountAvatar.textContent = state.userId.slice(0, 1).toUpperCase();
    elements.session.textContent = state.messages.length ? "Đang trò chuyện" : "Phiên chat mới";
    elements.login.hidden = true;
    elements.app.hidden = false;
    updateUsage({ used: state.usedTokens });
    renderAll();
    elements.input.focus();
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function sendMessage(content) {
  const text = content.trim();
  if (!text || elements.send.disabled) return;
  if (state.usedTokens >= LIMIT) return showToast("Phiên chat đã hết ngân sách. Hãy tạo phiên mới.");
  const userMessage = { role: "user", content: text };
  state.messages.push(userMessage);
  renderMessage(userMessage);
  elements.welcome.style.display = "none";
  elements.input.value = "";
  elements.input.style.height = "auto";
  setLoading(true);
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: state.userId, sessionId: state.sessionId, messages: state.messages }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Không thể gửi tin nhắn.");
    state.messages.push(data.message);
    updateUsage(data.usage);
    renderMessage(data.message);
    elements.session.textContent = "Đang trò chuyện";
  } catch (error) {
    state.messages.pop();
    renderAll();
    showToast(error.message);
  } finally {
    setLoading(false);
    persist();
    elements.input.disabled = false;
    elements.input.focus();
  }
}

async function newChat() {
  const previousSession = state.sessionId;
  state.sessionId = crypto.randomUUID();
  state.messages = [];
  state.usedTokens = 0;
  elements.session.textContent = "Phiên chat mới";
  updateUsage({ used: 0 });
  renderAll();
  elements.input.focus();
  if (state.userId) {
    await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: state.userId, sessionId: previousSession }) }).catch(() => {});
  }
}

function logout() {
  localStorage.removeItem("qwen-active-user");
  state.userId = null;
  state.messages = [];
  elements.app.hidden = true;
  elements.login.hidden = false;
  elements.loginId.value = "";
  elements.loginError.textContent = "";
  elements.loginId.focus();
}

elements.loginForm.addEventListener("submit", (event) => { event.preventDefault(); login(elements.loginId.value); });
document.querySelectorAll("[data-login-id]").forEach((button) => button.addEventListener("click", () => { elements.loginId.value = button.dataset.loginId; elements.loginId.focus(); }));
elements.form.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(elements.input.value); });
elements.input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); elements.form.requestSubmit(); } });
elements.input.addEventListener("input", () => { elements.input.style.height = "auto"; elements.input.style.height = `${Math.min(elements.input.scrollHeight, 120)}px`; });
document.querySelector("#new-chat").addEventListener("click", newChat);
document.querySelector("#clear-chat").addEventListener("click", () => { if (state.messages.length) newChat(); });
document.querySelector("#account-button").addEventListener("click", logout);
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { elements.input.value = button.dataset.prompt; elements.input.focus(); elements.input.dispatchEvent(new Event("input")); }));

elements.app.hidden = true;
elements.login.hidden = false;
elements.loginId.focus();
