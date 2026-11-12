// Keep the action from a terminal permission dialog, without its answer choices or terminal borders.
export function permissionPrompt(text) {
  const lines = String(text || '').split('\n').map((line) => line.replace(/[\u2500-\u257f]/g, ''));
  const firstChoice = lines.findIndex((line) => /^\s*[❯>]?\s*\d+\.\s/.test(line));
  const action = (firstChoice < 0 ? lines : lines.slice(0, firstChoice))
    .map((line) => line.replace(/^\s*[⏺⎿❯]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
  return redactSecrets(action).slice(0, 400).trim();
}

export function redactSecrets(text) {
  return String(text || '')
    .replace(/\b(password|token|key|secret)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=redacted')
    .replace(/\bAuthorization:\s*[^\n]+/gi, 'Authorization: redacted')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer redacted')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|xox[A-Za-z0-9_-]+)\b/gi, 'redacted')
    .replace(/(?<![A-Za-z0-9_+/=-])[A-Za-z0-9+/]{20,}={0,2}(?![A-Za-z0-9_+/=-])/g, 'redacted');
}

export function blockText(name, reason, prompt) {
  const attach = `On the Mac, open Terminal and type: tmux attach -t memo-${name} . When you are done, press Control-b, then d, to leave the agent running.`;
  if (reason === 'sign-in') {
    return `**${name} is blocked: Claude needs you to sign in again.**\n\n${attach} In the agent, type /login and follow the steps.\n\nThis memo closes by itself when ${name} works again.`;
  }
  const action = permissionPrompt(prompt);
  const detail = action ? `What it asks to do:\n${action}\n\n` : '';
  return `**${name} waits for you to answer a permission question.**\n\n${detail}Open the Agents page in Memo: it shows the question with buttons to answer it, also on your phone. Or: ${attach}\n\nThis memo closes by itself when ${name} works again.`;
}
