import { ALL_MODELS, MODEL_PROVIDERS, DEFAULT_MODEL_ID, findModel, findModelByKey, modelKey } from "./config/models.js";
import { renderMarkdown, copyButton } from "./markdown.js";
import { TOKEN_LIMIT, MIN_TOKEN_LIMIT, MAX_TOKEN_LIMIT, validTokenLimit, estimateTokens, estimateDraft } from "./tokens.js";

const BUDGET_STORAGE_KEY = "chat.tokenLimit";
function loadPreferredBudget() {
  try { const value = Number(localStorage.getItem(BUDGET_STORAGE_KEY)); if (validTokenLimit(value)) return value; }
  catch { /* Use the default when storage is unavailable. */ }
  return TOKEN_LIMIT;
}
let preferredTokenLimit = loadPreferredBudget();
const MODEL_STORAGE_KEY = "chat.modelSelection";
function loadModelSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_STORAGE_KEY) || "null");
    if (saved && Object.hasOwn(MODEL_PROVIDERS, saved.provider) && findModel(saved.modelId, saved.provider)) return { provider: saved.provider, modelId: saved.modelId };
    const legacy = localStorage.getItem("openrouter.modelId");
    if (findModel(legacy)) return { provider: "openrouter", modelId: legacy };
  } catch { /* Use the default when storage is unavailable. */ }
  return { provider: "openrouter", modelId: DEFAULT_MODEL_ID };
}
const state = { userId: null, sessionId: null, sessions: [], messages: [], usedTokens: 0, tokenLimit: preferredTokenLimit, busy: false, ...loadModelSelection(), pendingDraft: null, providers: { openrouter: { configured: false }, groq: { configured: false } } };
let budgetSaving = false;

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
  sessions: document.querySelector("#session-list"),
  sessionPicker: document.querySelector("#session-picker"),
  settings: document.querySelector("#settings-dialog"),
  modelPicker: document.querySelector("#model-picker"),
  activity: document.querySelector("#response-activity"),
  activityLabel: document.querySelector("#activity-label"),
  activityTime: document.querySelector("#activity-time"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteDescription: document.querySelector("#delete-description"),
  confirmDelete: document.querySelector("#confirm-delete"),
  tokenPreview: document.querySelector("#token-preview"),
  draftLabel: document.querySelector("#draft-token-label"),
  draftTokens: document.querySelector("#draft-token-count"),
  draftCharacters: document.querySelector("#draft-characters"),
  draftDelta: document.querySelector("#draft-token-delta"),
  contextTokens: document.querySelector("#context-token-count"),
  requestTokens: document.querySelector("#request-token-count"),
  replyTokens: document.querySelector("#reply-token-count"),
  tokenWarning: document.querySelector("#token-warning"),
  projectedBar: document.querySelector("#usage-preview-bar"),
  budgetButton: document.querySelector("#budget-button"),
  budgetSummary: document.querySelector("#budget-summary"),
  budgetPopover: document.querySelector("#budget-popover"),
  budgetDock: document.querySelector("#budget-dock"),
  composerWrap: document.querySelector("#composer-wrap"),
  composerBudgetButton: document.querySelector("#composer-budget-button"),
  composerTokenHint: document.querySelector("#composer-token-hint"),
  composerAlert: document.querySelector("#composer-alert"),
  modelNotice: document.querySelector("#model-notice"),
  modelNoticeText: document.querySelector("#model-notice-text"),
  modelAvailabilityNote: document.querySelector("#model-availability-note"),
  budgetForm: document.querySelector("#session-budget-form"),
  budgetInput: document.querySelector("#session-token-limit"),
  budgetApply: document.querySelector("#save-session-budget"),
  budgetStatus: document.querySelector("#session-budget-status"),
};

const modelAvailability = new Map();
const unavailableModels = new Set();
let availabilityRequest = 0;
function modelUnavailable(modelId, provider = state.provider) {
  const key = modelKey(provider, modelId);
  return unavailableModels.has(key) || modelAvailability.get(key) === false;
}
function needsProviderKey() {
  const status = state.providers[state.provider];
  return !status?.configured || Boolean(status.keyRejected);
}
function renderModelAvailability() {
  for (const option of elements.modelPicker.options) {
    const model = findModelByKey(option.value);
    const unavailable = modelUnavailable(model.id, model.provider);
    option.disabled = unavailable;
    option.textContent = `${MODEL_PROVIDERS[model.provider].label} · ${model.label} · ${model.params}${unavailable ? " — Không khả dụng" : ""}`;
  }
  const providerLabel = MODEL_PROVIDERS[state.provider].label;
  const model = findModel(state.modelId, state.provider);
  const unavailable = modelUnavailable(state.modelId);
  const missingKey = needsProviderKey();
  const keyName = state.provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY";
  elements.modelNotice.hidden = !unavailable && !missingKey;
  elements.modelNoticeText.textContent = missingKey ? `Hãy kiểm tra ${keyName} trong file .env. Nội dung đang gõ được giữ nguyên.`
    : unavailable ? `${model.label} hiện không khả dụng trên ${providerLabel}. Chọn model khác để tiếp tục; nội dung đang gõ được giữ nguyên.` : "";
  document.querySelector("#change-unavailable-model").textContent = missingKey ? "Kiểm tra lại" : "Đổi model";
  elements.modelAvailabilityNote.textContent = missingKey ? `${keyName} chưa được cấu hình hoặc chưa hợp lệ trong .env.`
    : unavailable ? `Model đã chọn không có trong danh mục ${providerLabel} của tài khoản. Hãy chọn model khác.`
      : modelAvailability.get(modelKey(state.provider, state.modelId)) === true ? `Model có trong danh mục hiện tại của ${providerLabel}.`
        : `Chưa xác minh được danh mục ${providerLabel}. Bạn vẫn có thể thử gửi với model này.`;
  elements.modelAvailabilityNote.classList.toggle("unavailable", unavailable || missingKey);
  document.querySelector("#model-connection-status").textContent = `${missingKey ? "Cần API key" : unavailable ? "Không khả dụng" : "Đã chọn"} · ${providerLabel}`;
  document.querySelector(".model-mini").classList.toggle("model-unavailable", unavailable || missingKey);
  updateTokenPreview();
}
async function loadModelAvailability() {
  const userId = state.userId;
  const requestId = ++availabilityRequest;
  try {
    const response = await fetch(userId ? `/api/models?userId=${encodeURIComponent(userId)}` : "/api/models");
    if (!response.ok) throw new Error("Catalog unavailable");
    const data = await response.json();
    if (state.userId !== userId || requestId !== availabilityRequest) return;
    for (const model of data.models || []) {
      const provider = model.provider || "openrouter";
      if (findModel(model.id, provider)) modelAvailability.set(modelKey(provider, model.id), model.available);
    }
    if (data.providers) state.providers = { ...state.providers, ...data.providers };
  } catch { /* Keep the configured models usable if the catalog cannot be checked. */ }
  renderModelAvailability();
}
function openSettings() {
  hideBudget();
  if (!elements.settings.open) elements.settings.showModal();
  loadModelAvailability();
}
document.querySelector("#change-unavailable-model").addEventListener("click", () => {
  if (needsProviderKey()) loadModelAvailability(); else openSettings();
});

elements.budgetInput.min = String(MIN_TOKEN_LIMIT);
elements.budgetInput.max = String(MAX_TOKEN_LIMIT);
elements.budgetInput.value = String(state.tokenLimit);
elements.budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy || budgetSaving || !state.userId) return;
  const tokenLimit = Number(elements.budgetInput.value);
  if (!validTokenLimit(tokenLimit) || tokenLimit < state.usedTokens) {
    elements.budgetStatus.textContent = `Ngân sách phải từ ${number(Math.max(MIN_TOKEN_LIMIT, state.usedTokens))} đến ${number(MAX_TOKEN_LIMIT)} token, không thấp hơn số đã dùng.`;
    return;
  }
  const sessionId = state.sessionId;
  budgetSaving = true;
  updateTokenPreview();
  try {
    const data = sessionId ? await api("/api/sessions/budget", { userId: state.userId, sessionId, tokenLimit }) : null;
    preferredTokenLimit = tokenLimit;
    try { localStorage.setItem(BUDGET_STORAGE_KEY, String(tokenLimit)); } catch { /* Current session still uses the saved server budget. */ }
    if (state.sessionId === sessionId) {
      state.tokenLimit = tokenLimit;
      if (data) { state.sessions = data.sessions; renderSessions(); }
      elements.budgetInput.value = String(tokenLimit);
      elements.budgetStatus.textContent = `Đã lưu ${number(tokenLimit)} token.`;
      updateUsage();
    }
  } catch (error) { elements.budgetStatus.textContent = error.message; }
  finally { budgetSaving = false; updateTokenPreview(); }
});

let budgetPinned = false;
let budgetHideTimer;
function positionBudget() {
  if (!elements.budgetPopover.matches(":popover-open")) return;
  const docked = budgetPinned && innerWidth > 760;
  elements.budgetPopover.classList.toggle("is-docked", docked);
  elements.budgetDock.hidden = !docked;
  if (docked) {
    const slot = elements.budgetDock.getBoundingClientRect();
    elements.budgetPopover.style.width = `${slot.width}px`;
    elements.budgetPopover.style.maxHeight = `${Math.max(140, innerHeight - 380)}px`;
    elements.budgetDock.style.height = `${elements.budgetPopover.getBoundingClientRect().height}px`;
    const dock = elements.budgetDock.getBoundingClientRect();
    elements.budgetPopover.style.left = `${dock.left}px`;
    elements.budgetPopover.style.top = `${dock.top}px`;
    elements.budgetPopover.style.right = "auto";
    return;
  }
  elements.budgetDock.style.height = "";
  elements.budgetPopover.style.width = "";
  elements.budgetPopover.style.maxHeight = "";
  elements.budgetPopover.style.left = "auto";
  const anchor = elements.budgetButton.getBoundingClientRect();
  const panel = elements.budgetPopover.getBoundingClientRect();
  elements.budgetPopover.style.top = `${Math.max(12, Math.min(anchor.bottom + 12, innerHeight - panel.height - 12))}px`;
  elements.budgetPopover.style.right = `${Math.max(12, Math.min(innerWidth - anchor.right, innerWidth - panel.width - 12))}px`;
}
function showBudget(pin = false) {
  clearTimeout(budgetHideTimer);
  if (!state.userId) return;
  budgetPinned ||= pin;
  if (!elements.budgetPopover.matches(":popover-open")) elements.budgetPopover.showPopover();
  positionBudget();
}
function hideBudget() {
  clearTimeout(budgetHideTimer);
  budgetPinned = false;
  if (elements.budgetPopover.matches(":popover-open")) elements.budgetPopover.hidePopover();
  elements.budgetDock.hidden = true;
  elements.budgetDock.style.height = "";
  elements.budgetPopover.classList.remove("is-docked");
}
function scheduleBudgetHide() {
  clearTimeout(budgetHideTimer);
  budgetHideTimer = setTimeout(() => {
    if (!budgetPinned && !elements.budgetPopover.matches(":hover") && !elements.budgetButton.matches(":hover") && !elements.budgetPopover.contains(document.activeElement)) hideBudget();
  }, 180);
}
elements.budgetButton.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") showBudget(); });
elements.budgetButton.addEventListener("pointerleave", scheduleBudgetHide);
elements.budgetPopover.addEventListener("pointerenter", () => clearTimeout(budgetHideTimer));
elements.budgetPopover.addEventListener("pointerleave", scheduleBudgetHide);
elements.budgetButton.addEventListener("click", () => {
  if (budgetPinned && elements.budgetPopover.matches(":popover-open")) hideBudget();
  else showBudget(true);
});
elements.composerBudgetButton.addEventListener("click", () => showBudget(true));
document.querySelector("#close-budget").addEventListener("click", () => { hideBudget(); elements.budgetButton.focus(); });
elements.budgetPopover.addEventListener("toggle", (event) => {
  const open = event.newState === "open";
  elements.budgetButton.setAttribute("aria-expanded", String(open));
  elements.composerBudgetButton.setAttribute("aria-expanded", String(open));
  if (!open) { budgetPinned = false; clearTimeout(budgetHideTimer); }
});
window.addEventListener("resize", positionBudget);
new ResizeObserver(positionBudget).observe(elements.budgetPopover);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.budgetPopover.matches(":popover-open") && !document.querySelector("dialog[open]")) hideBudget();
});

const number = (value) => value.toLocaleString("vi-VN");
let previousDraftTokens = 0;
function updateTokenPreview(trackDelta = false) {
  const budget = state.pendingDraft || estimateDraft(state.messages, elements.input.value, state.usedTokens, state.tokenLimit);
  const delta = budget.draftTokens - previousDraftTokens;
  previousDraftTokens = budget.draftTokens;
  elements.draftLabel.textContent = state.pendingDraft ? "Tin đang gửi" : "Tin đang gõ";
  elements.draftTokens.textContent = `~${number(budget.draftTokens)}`;
  elements.draftCharacters.textContent = `${number(budget.characters)} ký tự`;
  elements.draftDelta.textContent = trackDelta ? `(${delta >= 0 ? "+" : ""}${number(delta)} token)` : "";
  elements.contextTokens.textContent = `~${number(budget.contextTokens)}`;
  elements.requestTokens.textContent = `~${number(budget.requestTokens)}`;
  elements.replyTokens.textContent = `~${number(budget.replyTokens)}`;
  elements.projectedBar.style.left = `${Math.min(100, state.usedTokens / state.tokenLimit * 100)}%`;
  elements.projectedBar.style.width = `${Math.min(budget.requestTokens, Math.max(0, state.tokenLimit - state.usedTokens)) / state.tokenLimit * 100}%`;
  elements.tokenPreview.classList.toggle("over-budget", budget.blocked);
  elements.tokenWarning.textContent = budget.blocked
    ? "Không đủ ngân sách cho lượt gửi này. Hãy rút ngắn tin nhắn hoặc tạo chat mới."
    : budget.requestTokens > 0 && budget.replyTokens < 128
      ? "Ngân sách cho câu trả lời còn ít; phản hồi có thể bị ngắt."
      : "";
  elements.tokenWarning.hidden = !elements.tokenWarning.textContent;
  elements.budgetSummary.textContent = `${number(state.usedTokens)} / ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(state.tokenLimit)}`;
  elements.budgetButton.style.setProperty("--budget-fill", `${Math.min(100, state.usedTokens / state.tokenLimit * 100)}%`);
  elements.budgetButton.classList.toggle("budget-warning", budget.blocked || state.usedTokens / state.tokenLimit > .85 || (budget.requestTokens > 0 && budget.replyTokens < 128));
  elements.budgetButton.setAttribute("aria-label", `Ngân sách token: đã dùng ${number(state.usedTokens)} trên ${number(state.tokenLimit)}. Mở chi tiết`);
  elements.composerTokenHint.textContent = budget.draftTokens > 0 ? `Tin ~${number(budget.draftTokens)} · Gửi ~${number(budget.requestTokens)} token` : "Xem ngân sách token";
  elements.composerWrap.classList.toggle("has-draft", Boolean(elements.input.value));
  elements.composerWrap.classList.toggle("is-busy", state.busy);
  elements.composerAlert.textContent = budget.blocked ? "Không đủ token cho lượt gửi này. Rút ngắn tin nhắn hoặc tạo chat mới." : "";
  elements.composerAlert.hidden = !elements.composerAlert.textContent;
  elements.send.title = needsProviderKey() ? "Hãy kiểm tra API key trong .env" : modelUnavailable(state.modelId) ? "Hãy chọn model đang khả dụng" : budget.blocked ? "Không đủ ngân sách token" : "Gửi tin nhắn";
  elements.send.disabled = state.busy || budgetSaving || budget.blocked || modelUnavailable(state.modelId) || needsProviderKey() || !elements.input.value.trim();
  elements.budgetInput.disabled = state.busy || budgetSaving;
  elements.budgetApply.disabled = state.busy || budgetSaving || !state.userId;
  positionBudget();
}

function renderModel() {
  const model = findModel(state.modelId, state.provider);
  elements.modelPicker.value = modelKey(model.provider, model.id);
  document.querySelectorAll("[data-model-label]").forEach((element) => { element.textContent = model.label; });
  document.querySelector("#active-model-id").textContent = model.id;
  document.querySelector("#active-provider").textContent = MODEL_PROVIDERS[model.provider].label;
}

for (const [provider, info] of Object.entries(MODEL_PROVIDERS)) {
  const group = document.createElement("optgroup");
  group.label = info.label;
  for (const model of ALL_MODELS.filter((item) => item.provider === provider)) {
    group.append(new Option(`${info.label} · ${model.label} · ${model.params}`, modelKey(provider, model.id)));
  }
  elements.modelPicker.append(group);
}
renderModel();
document.querySelector("#settings-button").addEventListener("click", openSettings);
document.querySelector("#close-settings").addEventListener("click", () => elements.settings.close());
elements.modelPicker.addEventListener("change", () => {
  const model = findModelByKey(elements.modelPicker.value);
  if (!model) return;
  state.modelId = model.id;
  state.provider = model.provider;
  renderModel();
  renderModelAvailability();
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify({ provider: state.provider, modelId: state.modelId }));
    showToast("Đã lưu model.");
  } catch {
    showToast("Đã đổi model. Trình duyệt không cho phép lưu lựa chọn khi tải lại.");
  }
});

async function api(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Không thể kết nối máy chủ."), { code: data.code, modelId: data.modelId, provider: data.provider, status: response.status });
  return data;
}

function applySessionData(data) {
  if (data.providers) state.providers = { ...state.providers, ...data.providers };
  state.sessions = data.sessions || [];
  state.sessionId = data.session?.id || null;
  state.messages = data.session?.messages || [];
  state.usedTokens = data.session?.usedTokens || 0;
  state.tokenLimit = data.session?.tokenLimit || preferredTokenLimit;
  elements.budgetInput.value = String(state.tokenLimit);
  elements.budgetStatus.textContent = "";
  elements.session.textContent = data.session?.title || "Phiên chat mới";
  elements.input.value = "";
  elements.input.style.height = "auto";
  updateUsage();
  renderAll();
  renderSessions();
  renderModelAvailability();
}

function renderSessions() {
  elements.sessions.replaceChildren();
  elements.sessionPicker.replaceChildren();
  if (!state.sessions.length) {
    const empty = document.createElement("p");
    empty.className = "sessions-empty";
    empty.textContent = "Các cuộc trò chuyện sẽ được lưu tại đây.";
    elements.sessions.append(empty);
    elements.sessionPicker.add(new Option("Chưa có cuộc trò chuyện", ""));
  }
  for (const session of state.sessions) {
    const row = document.createElement("div");
    row.className = "session-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-item${session.id === state.sessionId ? " active" : ""}`;
    button.setAttribute("aria-pressed", String(session.id === state.sessionId));
    button.disabled = state.busy;
    const title = document.createElement("span");
    title.className = "session-item-title";
    title.textContent = session.title;
    const detail = document.createElement("small");
    detail.textContent = `${new Date(session.updatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${session.usedTokens.toLocaleString("vi-VN")} / ${(session.tokenLimit || TOKEN_LIMIT).toLocaleString("vi-VN")} token`;
    button.append(title, detail);
    button.addEventListener("click", () => selectSession(session.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "session-delete";
    remove.textContent = "×";
    remove.title = `Xóa: ${session.title}`;
    remove.setAttribute("aria-label", `Xóa cuộc trò chuyện: ${session.title}`);
    remove.disabled = state.busy;
    remove.addEventListener("click", () => askDelete(session.id));
    row.append(button, remove);
    elements.sessions.append(row);
    elements.sessionPicker.add(new Option(session.title, session.id, false, session.id === state.sessionId));
  }
  document.querySelectorAll("[data-delete-all]").forEach((button) => { button.disabled = state.busy || !state.sessions.length; });
  document.querySelector("#delete-current").disabled = state.busy || !state.sessionId;
}

function updateUsage(usage = {}) {
  if (typeof usage.used === "number") state.usedTokens = usage.used;
  const percent = Math.min(100, Math.round((state.usedTokens / state.tokenLimit) * 100));
  elements.usage.textContent = `${number(state.usedTokens)} / ${number(state.tokenLimit)} token`;
  elements.bar.style.width = `${percent}%`;
  elements.bar.style.background = percent > 85 ? "#e39f45" : "var(--lime-dark)";
  updateTokenPreview();
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
  const responseProvider = message.provider || "openrouter";
  meta.textContent = message.role === "assistant" ? `${MODEL_PROVIDERS[responseProvider]?.label || responseProvider} · ${findModel(message.modelId, responseProvider)?.label || message.modelId || "TRỢ LÝ AI"}` : `BẠN · ~${number(estimateTokens(message.content))} token`;
  if (message.role === "assistant" && Number.isFinite(message.responseTimeMs)) {
    meta.classList.add("assistant-meta");
    const time = document.createElement("span");
    time.className = "response-time";
    time.textContent = `⏱ Phản hồi ${(message.responseTimeMs / 1000).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} giây`;
    time.title = "Thời gian từ lúc server gọi model đến khi nhận đầy đủ phản hồi.";
    meta.append(time);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (message.role === "assistant") {
    bubble.classList.add("markdown");
    if (message.reasoning) {
      const details = document.createElement("details");
      details.className = "reasoning";
      const summary = document.createElement("summary");
      summary.textContent = "Xem phần tư duy từ model";
      const reasoning = document.createElement("div");
      reasoning.className = "reasoning-content";
      renderMarkdown(reasoning, message.reasoning, showToast);
      details.append(summary, reasoning);
      bubble.append(details);
    }
    const answer = document.createElement("div");
    answer.className = "answer-content";
    renderMarkdown(answer, message.content, showToast);
    bubble.append(answer);
    if (message.truncated) {
      const notice = document.createElement("p");
      notice.className = "truncated-note";
      notice.textContent = "Phản hồi bị ngắt do giới hạn token.";
      bubble.append(notice);
    }
    const footer = document.createElement("div");
    footer.className = "message-footer";
    if (message.tokenUsage) {
      const usage = message.tokenUsage;
      const stats = document.createElement("div");
      stats.className = "message-token-stats";
      stats.title = "Gửi gồm ngữ cảnh và tin nhắn. Token tư duy đã nằm trong token nhận. Dấu ~ chỉ số ước tính khi API không báo đủ dữ liệu.";
      for (const [label, count, estimated] of [
        ["Gửi", usage.promptTokens, usage.promptEstimated],
        ["Nhận", usage.completionTokens, usage.completionEstimated],
        ["Tổng", usage.totalTokens, usage.totalEstimated],
      ]) {
        if (!Number.isFinite(count)) continue;
        const badge = document.createElement("span");
        badge.textContent = `${label} ${estimated ? "~" : ""}${number(count)} token`;
        stats.append(badge);
      }
      if (usage.reasoningTokens > 0) {
        const reasoningTokens = document.createElement("span");
        reasoningTokens.textContent = `Tư duy ${number(usage.reasoningTokens)} (trong phần nhận)`;
        stats.append(reasoningTokens);
      }
      footer.append(stats);
    }
    footer.append(copyButton(message.content, showToast, "Copy phản hồi"));
    bubble.append(footer);
  } else bubble.textContent = message.content;
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

function setLoading(loading, waitingForModel = false) {
  clearInterval(setLoading.timer);
  state.busy = loading;
  elements.send.disabled = loading;
  elements.input.disabled = loading;
  elements.modelPicker.disabled = loading;
  document.querySelectorAll("#new-chat, #clear-chat, #account-button, #mobile-new-chat, #session-picker").forEach((button) => { button.disabled = loading; });
  elements.activity.hidden = !loading;
  elements.activityLabel.textContent = waitingForModel ? "Đang chờ model suy nghĩ và phản hồi…" : "Đang tải cuộc trò chuyện…";
  elements.activityTime.textContent = "0,0 giây";
  renderSessions();
  updateTokenPreview();
  if (loading && waitingForModel) {
    const startedAt = performance.now();
    setLoading.timer = setInterval(() => {
      elements.activityTime.textContent = `${((performance.now() - startedAt) / 1000).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} giây`;
    }, 100);
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
    const data = await api("/api/auth/login", { userId: id });
    state.userId = data.user.id;
    elements.accountId.textContent = state.userId;
    elements.accountAvatar.textContent = state.userId.slice(0, 1).toUpperCase();
    elements.login.hidden = true;
    elements.app.hidden = false;
    applySessionData(data);
    loadModelAvailability();
    elements.stage.focus({ preventScroll: true });
  } catch (error) {
    elements.loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function sendMessage(content) {
  const text = content.trim();
  if (!text || state.busy || budgetSaving) return;
  if (needsProviderKey()) return loadModelAvailability();
  if (modelUnavailable(state.modelId)) return openSettings();
  if (state.usedTokens >= state.tokenLimit) return showToast("Phiên chat đã hết ngân sách. Hãy tăng ngân sách hoặc tạo phiên mới.");
  if (estimateDraft(state.messages, text, state.usedTokens, state.tokenLimit).blocked) {
    return showToast("Tổng token dự kiến gửi vượt ngân sách còn lại. Hãy rút ngắn tin hoặc tạo chat mới.");
  }
  if (!state.sessionId) {
    setLoading(true);
    try {
      applySessionData(await api("/api/sessions", { userId: state.userId, tokenLimit: preferredTokenLimit }));
    } catch (error) {
      showToast(error.message);
      return;
    } finally { setLoading(false); }
  }
  state.pendingDraft = estimateDraft(state.messages, text, state.usedTokens, state.tokenLimit);
  const userMessage = { role: "user", content: text };
  state.messages.push(userMessage);
  renderMessage(userMessage);
  elements.welcome.style.display = "none";
  elements.input.value = "";
  elements.input.style.height = "auto";
  elements.stage.focus({ preventScroll: true });
  setLoading(true, true);
  let failed = false;
  try {
    const data = await api("/api/chat", { userId: state.userId, sessionId: state.sessionId, content: text, modelId: state.modelId, provider: state.provider });
    state.pendingDraft = null;
    applySessionData(data);
  } catch (error) {
    failed = true;
    state.pendingDraft = null;
    state.messages.pop();
    renderAll();
    elements.input.value = text;
    if (error.code === "MODEL_UNAVAILABLE") {
      unavailableModels.add(modelKey(error.provider || state.provider, error.modelId || state.modelId));
      renderModelAvailability();
    } else if (["API_KEY_INVALID", "API_KEY_REQUIRED"].includes(error.code) && state.providers[error.provider]) {
      state.providers[error.provider].keyRejected = true;
      renderModelAvailability();
    } else showToast(error.message);
  } finally {
    setLoading(false);
    elements.input.disabled = false;
    if (failed) elements.input.focus();
  }
}

async function newChat() {
  if (state.busy || !state.userId) return;
  setLoading(true);
  try { applySessionData(await api("/api/sessions", { userId: state.userId, tokenLimit: preferredTokenLimit })); }
  catch (error) { showToast(error.message); }
  finally { setLoading(false); elements.input.focus(); }
}

async function selectSession(sessionId) {
  if (state.busy || !sessionId || sessionId === state.sessionId) return;
  setLoading(true);
  try { applySessionData(await api("/api/sessions/select", { userId: state.userId, sessionId })); }
  catch (error) { showToast(error.message); }
  finally { setLoading(false); elements.stage.focus({ preventScroll: true }); }
}

let pendingDelete = null;
function askDelete(sessionId = null) {
  if (state.busy || !state.userId) return;
  if (sessionId && !state.sessions.some((session) => session.id === sessionId)) return;
  if (!sessionId && !state.sessions.length) return;
  pendingDelete = { userId: state.userId, sessionId };
  document.querySelector("#delete-error").textContent = "";
  const title = state.sessions.find((session) => session.id === sessionId)?.title;
  elements.deleteDescription.textContent = sessionId
    ? `Xóa cuộc trò chuyện “${title}”? Tin nhắn trong cuộc trò chuyện này sẽ bị xóa vĩnh viễn.`
    : `Xóa toàn bộ ${state.sessions.length} cuộc trò chuyện của ${state.userId}? Lịch sử sẽ bị xóa vĩnh viễn.`;
  elements.deleteDialog.showModal();
}

elements.confirmDelete.addEventListener("click", async () => {
  if (!pendingDelete || state.busy) return;
  const target = pendingDelete;
  elements.confirmDelete.disabled = true;
  document.querySelector("#cancel-delete").disabled = true;
  setLoading(true);
  try {
    const path = target.sessionId ? "/api/sessions/delete" : "/api/sessions/clear";
    applySessionData(await api(path, target));
    elements.deleteDialog.close();
    showToast(target.sessionId ? "Đã xóa cuộc trò chuyện." : "Đã xóa toàn bộ lịch sử.");
  } catch (error) { document.querySelector("#delete-error").textContent = error.message; }
  finally {
    elements.confirmDelete.disabled = false;
    document.querySelector("#cancel-delete").disabled = false;
    setLoading(false);
  }
});
elements.deleteDialog.addEventListener("close", () => { pendingDelete = null; });
elements.deleteDialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
document.querySelector("#cancel-delete").addEventListener("click", () => elements.deleteDialog.close());
document.querySelector("#delete-current").addEventListener("click", () => { if (state.sessionId) askDelete(state.sessionId); });
document.querySelectorAll("[data-delete-all]").forEach((button) => button.addEventListener("click", () => askDelete()));

function logout() {
  if (state.busy) return;
  hideBudget();
  state.userId = null;
  state.sessionId = null;
  state.sessions = [];
  state.messages = [];
  state.providers = { openrouter: { configured: false }, groq: { configured: false } };
  for (const model of ALL_MODELS.filter((item) => item.provider === "groq")) {
    modelAvailability.delete(modelKey("groq", model.id));
    unavailableModels.delete(modelKey("groq", model.id));
  }
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
elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 120)}px`;
  updateTokenPreview(true);
  if (elements.input.value) showBudget(true);
});

let followingLatest = true;
elements.stage.addEventListener("scroll", () => {
  followingLatest = elements.stage.scrollHeight - elements.stage.scrollTop - elements.stage.clientHeight < 48;
});
new ResizeObserver(() => {
  if (followingLatest && state.messages.length) elements.stage.scrollTop = elements.stage.scrollHeight;
}).observe(elements.stage);
document.querySelector("#new-chat").addEventListener("click", newChat);
document.querySelector("#clear-chat").addEventListener("click", newChat);
document.querySelector("#mobile-new-chat").addEventListener("click", newChat);
elements.sessionPicker.addEventListener("change", () => selectSession(elements.sessionPicker.value));
document.querySelector("#account-button").addEventListener("click", logout);

elements.app.hidden = true;
elements.login.hidden = false;
updateTokenPreview();
loadModelAvailability();
elements.loginId.focus();
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && state.userId) {
    event.preventDefault();
    newChat();
  }
});
