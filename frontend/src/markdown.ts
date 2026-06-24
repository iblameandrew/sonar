function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lightweight markdown → HTML for colony answers (no external deps). */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inCode = false;
  let codeBuf: string[] = [];

  const closeUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };

  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
    codeBuf = [];
    inCode = false;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) flushCode();
      else {
        closeUl();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    if (!line.trim()) {
      closeUl();
      continue;
    }

    if (line.startsWith("### ")) {
      closeUl();
      out.push(`<h3>${inlineFormat(escapeHtml(line.slice(4)))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeUl();
      out.push(`<h2>${inlineFormat(escapeHtml(line.slice(3)))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeUl();
      out.push(`<h1>${inlineFormat(escapeHtml(line.slice(2)))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(escapeHtml(line.slice(2)))}</li>`);
      continue;
    }
    if (line.startsWith("---")) {
      closeUl();
      out.push("<hr />");
      continue;
    }

    closeUl();
    out.push(`<p>${inlineFormat(escapeHtml(line))}</p>`);
  }

  flushCode();
  closeUl();
  return out.join("\n");
}

function inlineFormat(safe: string): string {
  return safe
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}