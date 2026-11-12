// Conservative suggestions for the capture form; an explicit recipient always wins.
// Managers can use --to auto --capability for unambiguous specialist delegation.
export const CAPABILITIES = ['general', 'image-generation', 'computer-use'];
export function taskCapability(text) {
  const t = String(text || '').trim().replace(/^(?:(?:ok(?:ay)?[,!]?|please|(?:can|could|would|will) you|i (?:want|need) you to)\s+)+/i, '');
  if (/^\[image\]/i.test(t) || /^(?:please\s+)?(?:generate|create|draw|edit)\s+(?:(?:me|an?|the|this)\s+)*(?:image|illustration|picture|photo|logo)\b/i.test(t)) return 'image-generation';
  if (/^\[computer\]/i.test(t) || /^(?:please\s+)?(?:use|control)\s+(?:(?:my|the)\s+)?(?:chrome|browser|desktop|computer)\b/i.test(t)) return 'computer-use';
  // Action requests, not discussion of login flows or code that implements them.
  if (/^(?:open(?: up)?\s+and\s+)?(?:log|sign)\s*(?:into|in\s+(?:to|on))\s+\S/i.test(t)) return 'computer-use';
  const surface = '(?:(?:my|the|a|an)\\s+)?(?:linkedin|chrome|safari|firefox|edge|browser|website|webpage|web page|site|tab|https?:\\/\\/\\S+|[\\w-]+\\.(?:com|org|net|io|app)\\b)';
  if (new RegExp(`^(?:open(?: up)?|launch|visit|navigate to|go to|log\\s*in to|sign\\s*in to)\\s+${surface}`, 'i').test(t)) return 'computer-use';
  if (/^open(?: up)?\s+.+?\s+and\s+(?:log\s*in|sign\s*in)\b/i.test(t)) return 'computer-use';
  if (/^(?:scrape|extract|download|export|fill|click|check|read)\b/i.test(t)
    && /\b(?:in|on|from|using|through|with)\s+(?:(?:my|the|a)\s+)?(?:linkedin|chrome|safari|firefox|browser|website|webpage|web page|site|tab)\b/i.test(t)) return 'computer-use';
  return 'general';
}

export function pickSpecialist(agents, capability, now = new Date()) {
  if (capability === 'general') return null;
  const worker = (agents || []).find(a => a.runtime === 'codex-desktop'
    && a.dispatch?.verified && a.dispatch.model === 'gpt-6.1-terra'
    && a.dispatch.state !== 'uncertain');
  if (!worker) return null;
  // Fresh exhausted windows exclude automatic selection unless the same provider
  // bucket reports usable existing credits. Unknown credits never imply capacity.
  const u = worker.usage;
  const age = now.getTime() - Date.parse(u?.at);
  let usesCredits = false;
  if (age >= 0 && age < 15 * 60000 && (u.windows || []).some(w => {
    const credits = u.credits_by_limit_id?.[w.limit_id];
    const availableCredits = credits?.hasCredits === true || credits?.unlimited === true;
    const exhausted = Number(w.percent) >= 100 && (!w.resets_at || Date.parse(w.resets_at) > now.getTime());
    if (exhausted && availableCredits) usesCredits = true;
    return exhausted && !availableCredits;
  })) return null;
  return { name: worker.name, hint: `Picked for ${capability === 'image-generation' ? 'image generation with the image tool' : 'computer use'}: GPT Terra desktop worker${usesCredits ? '; included allowance exhausted; credits available' : ''}` };
}
