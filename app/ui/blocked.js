// A blocked agent: what it waits for, the question on its screen, and for a permission question, buttons to answer it.
// The Agents page and the agent strip of the Inbox show the same box (memo 912). The numbers are the choices of the
// question, as the screen shows them; each button sends one key to the agent (POST /api/agent/answer, src/agents.js).
// run(path, body): the page sends the request and loads its agents again.
import { el, button, age } from './common.js';

export function blockedView(agent, run) {
  const b = agent.blocked;
  const parts = [el('p', { className: 'blocked' }, b.reason === 'sign-in'
    ? `Blocked since ${age(b.since)}: Claude needs a new sign-in. On the Mac, in Terminal: tmux attach -t memo-${agent.name}, then type /login.`
    : `Blocked since ${age(b.since)}: it waits for your answer to this question.`)];
  if (b.prompt) parts.push(el('pre', { className: 'prompt' }, b.prompt));
  if (b.reason === 'permission') {
    parts.push(el('div', { className: 'row' },
      ...['1', '2', '3'].map((k) => button(`Choose ${k}`, () => run('/api/agent/answer', { name: agent.name, key: k }), `Answer the question with choice ${k}`)),
      button('Cancel', () => run('/api/agent/answer', { name: agent.name, key: 'Escape' }), 'Press Escape: the agent does not get the permission')));
  }
  return el('div', { className: 'blocked-box' }, ...parts);
}
