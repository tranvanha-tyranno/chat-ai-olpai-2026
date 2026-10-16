import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.js";
import hljs from "./vendor/highlight.js";

export async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(field);
  field.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy unavailable");
  } finally { field.remove(); }
}

export function copyButton(text, onError, label = "Copy code") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await copyText(text);
      button.textContent = "Đã copy ✓";
      clearTimeout(button.copyTimer);
      button.copyTimer = setTimeout(() => { button.textContent = label; }, 2000);
    } catch { onError("Không thể copy. Hãy cho phép quyền clipboard hoặc chọn nội dung để sao chép."); }
  });
  return button;
}

export function renderMarkdown(target, source, onError) {
  const html = marked.parse(String(source || ""), { gfm: true, breaks: true });
  target.replaceChildren(DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
  }));
  for (const link of target.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const pre of target.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const block = document.createElement("div");
    block.className = "code-block";
    const header = document.createElement("div");
    header.className = "code-heading";
    const language = document.createElement("span");
    const declaredLanguage = code.className.match(/language-([\w#+.-]+)/)?.[1]?.toLowerCase();
    const originalCode = code.textContent;
    let highlighted;
    if (declaredLanguage && hljs.getLanguage(declaredLanguage)) {
      highlighted = hljs.highlight(originalCode, { language: declaredLanguage, ignoreIllegals: true });
    } else if (!declaredLanguage) {
      highlighted = hljs.highlightAuto(originalCode, ["python", "javascript", "typescript", "json", "xml", "css", "sql", "bash", "java", "cpp"]);
    }
    if (highlighted) {
      code.replaceChildren(DOMPurify.sanitize(highlighted.value, {
        RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"],
      }));
      code.classList.add("hljs");
    }
    language.textContent = declaredLanguage || highlighted?.language || "code";
    header.append(language, copyButton(originalCode, onError));
    pre.replaceWith(block);
    block.append(header, pre);
  }
  for (const table of target.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    table.replaceWith(scroll);
    scroll.append(table);
  }
}
