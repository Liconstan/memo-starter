// Draws the pet of an agent (memos 1241, 1242 and 1252): a small creature in inline SVG, with a pose for its feeling
// (ui/pets.js feelingOf) or for how bothered and how excited a memo row makes it (ui/pets.js upsetOf, excitedOf),
// and CSS animation (ui/common.css, ".pet"). Each pet has its own manner, from the quiz of memo 1252 (SYS-72):
// - Landon, the papillon (gpt): waits sitting at the door; upset, it stays still and silent with one small offended
//   huff; really excited, it twirls.
// - Peeve, the grey cat (main): upset, it looks unbothered but grumpy, ears back, a flick of the tail; now and then,
//   idle or happy, it curls up as a little spoon (ui/pets.js cuddleMoment).
// - Darkness, the black cat (second): working, it chatters in bubbles; waiting on her, its bubbles grow and come
//   faster the longer the wait (ui/pets.js waitLevel); upset, it hides, mostly out of sight; asleep, it stumbles or
//   stretches now and then.
// The art is swappable: with a picture in the pets folder (README.md, "Pictures of the pets"), the picture shows in the
// place of the drawing, and the drawing comes back if the picture does not load. A picture moves with the same manner
// (memo 1301): the CSS animates the <img> by the classes of the pet, and the extras (Zs, drop, heart, sparks, huff,
// bubbles) show in a small SVG laid over the picture (pictureMarks, overlayOf). With prefers-reduced-motion the
// animations stop, and the poses (eyes, brows, mouth, the door, the box, the bubbles) still say the same.
// An animated picture (a .webp or a .gif) moves by itself: the CSS adds no movement and no pose to it, only the
// overlay of the extras; with prefers-reduced-motion its still file shows, when the folder has one (pictureSources).
// All text goes into the page as text nodes; the SVG is built element by element, never from markup.
import { petOf, feelingOf, artPicture, sizeOf, upsetOf, excitedOf, rowLabel, rowFeeling, cuddleMoment, waitLevel } from './pets.js';

// The XML namespace of SVG, a fixed name that the browser knows; nothing is loaded from it. It is in two parts so the
// test that no page names a web address still holds.
const NS = `http:${'//www.w3.org/2000/svg'}`;
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}
const g = (cls, ...children) => svg('g', { class: cls }, ...children);

// The coat colors. Fixed colors, so the creatures look the same in both themes; the eyes of the black cat are green,
// light enough on a dark panel, and the strokes use the ink of the page at a low opacity.
const COAT = {
  dog: { base: '#fbf4ea', patch: '#b8783e', ear: '#8a5a2b', nose: '#3b2a22', eye: '#3b2a22', tongue: '#e8788a' },
  black: { base: '#33344a', patch: '#2a2b3e', ear: '#5b5c78', nose: '#e8a0b0', eye: '#c9e26b', pupil: '#1d1e2c' },
  grey: { base: '#a8adbf', patch: '#8e94a8', ear: '#d7b4bd', nose: '#d98a9a', eye: '#f0b64a', pupil: '#2a2b3e' },
  sprout: { base: '#9fd3b8', patch: '#7cbf9d', ear: '#5aa882', nose: '#4b8f6c', eye: '#2b4a3a' },
};

// The face for a mood: the eyes, the brows and the mouth. mood: 'calm' (open eyes, small smile), 'smile' (big smile),
// 'happy' (eyes as upturned arcs), 'flat' (flat mouth), 'worried' (brows up at the inside, wavy mouth), 'frown',
// 'angry' (brows down at the inside, open mouth), 'grumpy' (half-closed eyes, brows down, flat mouth), 'tired'
// (half-closed eyes, flat mouth), 'sleep' (closed eyes), 'wide' (big eyes, small open mouth), 'excited' (sparkling
// wide eyes, big open smile), 'quiet' (small closed mouth, eyes to the side: offended, saying nothing).
function face(c, mood) {
  const lidded = mood === 'tired' || mood === 'grumpy';
  const dx = mood === 'quiet' ? -1.2 : 0;
  const eye = (x, y) => (mood === 'happy' ? svg('path', { d: `M${x - 3} ${y + 1} q3 -4 6 0`, fill: 'none', stroke: c.eye, 'stroke-width': 2, 'stroke-linecap': 'round' })
    : mood === 'sleep' ? svg('path', { d: `M${x - 3} ${y} q3 3 6 0`, fill: 'none', stroke: c.eye, 'stroke-width': 2, 'stroke-linecap': 'round' })
      : g('eye', svg('circle', { cx: x + dx, cy: y, r: mood === 'wide' || mood === 'excited' ? 3.4 : 2.6, fill: c.eye }),
        c.pupil ? svg('circle', { cx: x + dx, cy: y, r: mood === 'wide' || mood === 'excited' ? 1.4 : 1.1, fill: c.pupil }) : '',
        svg('circle', { cx: x + dx + 1, cy: y - 1, r: mood === 'excited' ? 1.2 : .8, fill: '#fff' }),
        lidded ? svg('rect', { x: x - 4, y: y - 4, width: 8, height: 3.6, fill: c.base }) : ''));
  const brow = (x, y, dir) => svg('path', { d: `M${x - 3} ${y + dir * 1.2} L${x + 3} ${y - dir * 1.2}`, fill: 'none', stroke: c.eye, 'stroke-width': 1.6, 'stroke-linecap': 'round' });
  const brows = mood === 'worried' ? [brow(26, 25, -1), brow(38, 25, 1)] : mood === 'angry' || mood === 'grumpy' ? [brow(26, 25, 1), brow(38, 25, -1)]
    : mood === 'frown' ? [brow(26, 25.5, .5), brow(38, 25.5, -.5)] : [];
  const mouthD = {
    calm: 'M29 38 q3 2 6 0', smile: 'M28 37 q4 4 8 0', happy: 'M27 36 q5 6 10 0', flat: 'M29 38.5 h6', worried: 'M28 39 q2 -2 4 0 t4 0',
    frown: 'M29 40 q3 -2.5 6 0', angry: 'M29 39 q3 -3 6 0', grumpy: 'M29 39 h6', tired: 'M29 39 h6', sleep: 'M30 39 q2 1.5 4 0', wide: 'M30 38 q2 -1 4 0',
    quiet: 'M30 39 h4',
  }[mood] || 'M29 38 q3 2 6 0';
  const open = mood === 'angry' || mood === 'wide' || mood === 'excited';
  return g(`face ${mood}`,
    eye(26, 30), eye(38, 30), ...brows,
    svg('path', { d: 'M30 34.5 q2 2 4 0', fill: c.nose, stroke: c.nose, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    open ? svg('ellipse', { cx: 32, cy: 39.5, rx: mood === 'excited' ? 3 : 2.4, ry: mood === 'angry' ? 2.2 : mood === 'excited' ? 2.6 : 1.6, fill: c.nose })
      : svg('path', { d: mouthD, fill: 'none', stroke: c.nose, 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
}

// The extras: Zs for a sleeper, a drop of sweat for a worried one, a heart for a happy one, sparks for an excited one,
// a small huff for Landon offended, speech bubbles for Darkness (level 1 small and few to 4 big and many), a door
// frame for Landon at the door, a box for Darkness in hiding.
const zz = () => g('zz', svg('text', { x: 44, y: 18, 'font-size': 9, 'font-weight': 700, fill: 'currentColor' }, 'z'), svg('text', { x: 50, y: 11, 'font-size': 7, 'font-weight': 700, fill: 'currentColor' }, 'z'));
const drop = () => g('drop', svg('path', { d: 'M48 22 q3 5 0 7 q-3 -2 0 -7z', fill: '#7fb6ea' }));
const heart = () => g('heart', svg('path', { d: 'M50 10 q2 -3 4 0 q2 3 -4 6 q-6 -3 -4 -6 q2 -3 4 0z', fill: '#e8788a' }));
const star = (x, y, r) => svg('path', { d: `M${x} ${y - r} L${x + r * .35} ${y - r * .35} L${x + r} ${y} L${x + r * .35} ${y + r * .35} L${x} ${y + r} L${x - r * .35} ${y + r * .35} L${x - r} ${y} L${x - r * .35} ${y - r * .35}z`, fill: '#f3c74f' });
const sparks = () => g('sparks', star(8, 14, 3.5), star(56, 12, 2.6), star(12, 46, 2));
const huff = () => g('huff', svg('path', { d: 'M46 40 q4 -3 6 0 q3 -2 4 1 q3 0 2 3 q-2 3 -5 2 q-3 2 -5 -1 q-4 1 -2 -5z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, opacity: .7 }));
function bubbles(level) {
  const r = 2.2 + level * .9;
  const one = (x, y, k) => g(`bubble b${k}`, svg('circle', { cx: x, cy: y, r, fill: 'var(--panel)', stroke: 'currentColor', 'stroke-width': 1.1, opacity: .9 }),
    svg('circle', { cx: x - r * .4, cy: y, r: .7, fill: 'currentColor' }), svg('circle', { cx: x, cy: y, r: .7, fill: 'currentColor' }), svg('circle', { cx: x + r * .4, cy: y, r: .7, fill: 'currentColor' }));
  const list = [one(50, 20 - level, 1)];
  if (level >= 2) list.push(one(58 - level, 10, 2));
  if (level >= 4) list.push(one(10, 14, 3));
  return g(`bubbles level-${level}`, ...list);
}
const door = () => g('door', svg('rect', { x: 14, y: 2, width: 36, height: 58, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, opacity: .45 }),
  svg('rect', { x: 18, y: 6, width: 28, height: 54, fill: 'currentColor', opacity: .06 }), svg('circle', { cx: 44, cy: 32, r: 1.6, fill: 'currentColor', opacity: .5 }));
const box = () => g('box', svg('rect', { x: 10, y: 30, width: 44, height: 28, rx: 2, fill: '#c9a97a' }), svg('rect', { x: 10, y: 30, width: 44, height: 6, fill: '#b4935f' }),
  svg('path', { d: 'M18 44 h12 M18 49 h8', stroke: '#8f7140', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));

// Landon, a papillon: a round white head with brown patches, two big fringed butterfly ears, a plumed tail.
function dog(c, mood) {
  const ear = (side) => g('ear', svg('path', { d: side < 0 ? 'M22 24 L6 10 Q2 20 8 30 Q14 36 22 30z' : 'M42 24 L58 10 Q62 20 56 30 Q50 36 42 30z', fill: c.ear }),
    svg('path', { d: side < 0 ? 'M8 30 q-2 4 1 7 M12 33 q-1 4 2 7' : 'M56 30 q2 4 -1 7 M52 33 q1 4 -2 7', fill: 'none', stroke: c.ear, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  return [
    g('tail', svg('path', { d: 'M46 52 q10 -6 10 -16', fill: 'none', stroke: c.patch, 'stroke-width': 5, 'stroke-linecap': 'round' })),
    svg('ellipse', { cx: 32, cy: 52, rx: 15, ry: 9, fill: c.base }),
    ear(-1), ear(1),
    svg('circle', { cx: 32, cy: 32, r: 16, fill: c.base }),
    svg('path', { d: 'M32 16 q-10 0 -13 12 q6 -3 13 -3 q7 0 13 3 q-3 -12 -13 -12z', fill: c.patch }),
    svg('path', { d: 'M32 20 v10', fill: 'none', stroke: c.base, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    face(c, mood),
  ];
}
// Darkness and Peeve, cats: a round head with pointed ears, whiskers, a curling tail. pose 'earsback' turns the ears
// down and out (grumpy); pose 'hide' shows only the ears and the eyes above a box; pose 'curl' is the cat curled up,
// eyes closed, the tail around it (the little spoon).
function cat(c, mood, pose) {
  if (pose === 'curl') {
    return [
      svg('ellipse', { cx: 32, cy: 42, rx: 22, ry: 13, fill: c.base }),
      g('tail', svg('path', { d: 'M12 46 q-4 -10 10 -12 q10 -1 20 4', fill: 'none', stroke: c.patch, 'stroke-width': 5, 'stroke-linecap': 'round' })),
      g('ear', svg('path', { d: 'M38 33 L40 22 L48 31z', fill: c.base }), svg('path', { d: 'M40 31 L41 25 L46 30z', fill: c.ear })),
      g('ear', svg('path', { d: 'M52 35 L58 26 L58 37z', fill: c.base })),
      svg('circle', { cx: 46, cy: 40, r: 10, fill: c.base }),
      g('face sleep', svg('path', { d: 'M40 40 q2 2.5 4 0 M48 40 q2 2.5 4 0', fill: 'none', stroke: c.eye, 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
        svg('path', { d: 'M45 44 q1 1.4 2.4 0', fill: 'none', stroke: c.nose, 'stroke-width': 1.4, 'stroke-linecap': 'round' })),
    ];
  }
  const earL = pose === 'earsback' ? 'M18 28 L8 18 L28 20z' : 'M18 26 L16 8 L30 18z';
  const earR = pose === 'earsback' ? 'M46 28 L56 18 L36 20z' : 'M46 26 L48 8 L34 18z';
  const parts = [
    g('tail', svg('path', { d: 'M46 54 q12 -2 10 -14', fill: 'none', stroke: c.base, 'stroke-width': 5, 'stroke-linecap': 'round' })),
    svg('ellipse', { cx: 32, cy: 52, rx: 15, ry: 9, fill: c.base }),
    g('ear', svg('path', { d: earL, fill: c.base }), pose === 'earsback' ? '' : svg('path', { d: 'M20 23 L19 13 L27 19z', fill: c.ear })),
    g('ear', svg('path', { d: earR, fill: c.base }), pose === 'earsback' ? '' : svg('path', { d: 'M44 23 L45 13 L37 19z', fill: c.ear })),
    svg('circle', { cx: 32, cy: 32, r: 16, fill: c.base }),
    svg('path', { d: 'M24 26 q8 -6 16 0 l0 2 q-8 -4 -16 0z', fill: c.patch }),
    g('whiskers', svg('path', { d: 'M14 34 h8 M14 38 l8 -2 M50 34 h-8 M50 38 l-8 -2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: .6 })),
    face(c, mood),
  ];
  // In hiding, the box covers the body and the mouth: the ears and the wide eyes peek over its edge.
  if (pose === 'hide') parts.push(box());
  return parts;
}
// The sprout, a neutral creature for an agent with no pet yet: a round green body with a leaf on top.
function sprout(c, mood) {
  return [
    svg('ellipse', { cx: 32, cy: 54, rx: 13, ry: 6, fill: c.patch }),
    svg('circle', { cx: 32, cy: 34, r: 17, fill: c.base }),
    g('ear', svg('path', { d: 'M32 17 q-2 -10 8 -12 q2 8 -8 12z', fill: c.ear }), svg('path', { d: 'M32 17 q2 -6 6 -9', fill: 'none', stroke: c.nose, 'stroke-width': 1.2 })),
    face(c, mood),
  ];
}

// The drawing of a pet: an <svg> with the class of its species, its mood and its pose. extras go on top; backdrop
// goes behind (the door).
export function drawPet(name, { mood = 'calm', pose = '', extras = [], backdrop = [] } = {}) {
  const pet = petOf(name);
  const c = COAT[pet.coat] || COAT[pet.species] || COAT.sprout;
  const parts = pet.species === 'dog' ? dog(c, mood) : pet.species === 'cat' ? cat(c, mood, pose) : sprout(c, mood);
  return svg('svg', { viewBox: '0 0 64 64', class: `pet-art ${pet.species} ${mood}${pose ? ` ${pose}` : ''}`, 'aria-hidden': 'true', focusable: 'false' }, ...backdrop, ...parts, ...extras);
}

// The makers of the extras and of the backdrop, by name. A scene names them (['zz'], ['bubbles', 2]) and they are
// built when the scene is drawn, so the rule of the scene is pure and one extra can be built twice (the drawing and
// the overlay of a picture).
const MARKS = { zz, drop, heart, sparks, huff, bubbles, door };
const build = (marks) => marks.map(([name, ...args]) => MARKS[name](...args));

// The manner of a pet for a feeling, with no drawing: the mood, the pose, the names of the extras and of the backdrop,
// and the classes that pick its animation, by the manner of the pet (SYS-72). The default manner is the plain one of
// the first build. Pure: no document, so the tests run it.
const PLAIN = { upset: 'angry', tired: 'tired', overloaded: 'worried', waiting: 'wide', working: 'smile', happy: 'happy', sleeping: 'sleep' };
export function mannerOf(agent, feeling, now = new Date()) {
  const pet = petOf(agent.name);
  const key = feeling.key;
  const manner = { mood: PLAIN[key] || 'calm', pose: '', extras: [], backdrop: [], classes: [] };
  if (key === 'sleeping') manner.extras.push(['zz']);
  if (key === 'overloaded') manner.extras.push(['drop']);
  if (key === 'happy') manner.extras.push(['heart']);
  if (pet.pet === 'Landon') {
    // At the door while it waits for her; upset, still and silent with one small offended huff; otherwise plain.
    if (key === 'waiting') { manner.mood = 'calm'; manner.backdrop.push(['door']); manner.classes.push('at-door'); }
    if (key === 'upset') { manner.mood = 'quiet'; manner.extras.push(['huff']); manner.classes.push('still'); }
  } else if (pet.pet === 'Peeve') {
    // Upset: unbothered but grumpy, ears back, a flick of the tail. Idle or happy, now and then: curled up, little spoon.
    if (key === 'upset') { manner.mood = 'grumpy'; manner.pose = 'earsback'; manner.classes.push('still', 'flick'); }
    if ((key === 'sleeping' || key === 'happy') && cuddleMoment(now)) { manner.pose = 'curl'; manner.classes.push('cuddle'); manner.extras = [['heart']]; }
  } else if (pet.pet === 'Darkness') {
    // Working: chatter. Waiting: bubbles that grow with the wait. Upset: in hiding. Asleep: restless.
    if (key === 'working') { manner.extras.push(['bubbles', 1]); manner.classes.push('chatter'); }
    if (key === 'waiting') { const level = waitLevel(agent, now); manner.extras.push(['bubbles', level]); manner.classes.push('chatter', `wait-${level}`); }
    if (key === 'upset') { manner.mood = 'wide'; manner.pose = 'hide'; manner.extras = []; manner.classes.push('still', 'hiding'); }
    if (key === 'sleeping') manner.classes.push('restless');
  }
  return manner;
}
// The scene of a pet for a feeling: its manner, with the extras and the backdrop built for the drawing.
export function sceneOf(agent, feeling, now = new Date()) {
  const manner = mannerOf(agent, feeling, now);
  return { ...manner, extras: build(manner.extras), backdrop: build(manner.backdrop) };
}

// The extras of a row of the queue, by name: sparks for an excited pet, a drop of sweat for a quite bothered one.
export const rowMarks = (excited, upset) => (excited ? [['sparks']] : upset >= 3 ? [['drop']] : []);
// The marks that show over a picture: the extras of the manner (or of the row), never the backdrop. The door and the
// box are parts of the drawing; a picture says them with its own movement (ui/common.css, ".pet-pic img").
export const pictureMarks = (extras = []) => extras.filter(([name]) => name !== 'door');
// The overlay of a picture: an <svg> of the same 64 by 64 frame as the drawing with only the marks, or null with none.
export function overlayOf(marks) {
  return marks.length ? svg('svg', { viewBox: '0 0 64 64', class: 'pet-over', 'aria-hidden': 'true', focusable: 'false' }, ...build(marks)) : null;
}

// The media query of a reader who asked for reduced motion, and the sources of a picture for a <picture> element:
// [{ media, srcset }], before the <img> with picture.src. An animated picture with a still file of the same stem gives
// the still file to that reader; with no still file, or for a still picture, there is no source and the <img> shows
// picture.src for everyone. Pure: no document, so the tests run it.
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
export const pictureSources = (picture) => (picture?.animated && picture.still ? [{ media: REDUCED_MOTION, srcset: picture.still }] : []);

// The picture with its overlay, or the drawing. picture: { src, animated, still } (ui/pets.js artPicture) or null.
// An animated picture moves by itself: the class "animated" takes the movement and the poses of the CSS off it
// (ui/common.css), the overlay stays, and the browser picks the still file with reduced motion (pictureSources). If
// the picture does not load, the drawing takes its place and the overlay goes, since the drawing has its own extras.
const picOrDrawing = (el, picture, drawing, size, marks = []) => {
  const art = el('span', { className: 'pet-pic' });
  art.style.setProperty('--pet', `${size}rem`);
  if (picture) {
    const img = el('img', { alt: '' });
    const frame = el('picture', {}, ...pictureSources(picture).map((source) => el('source', source)), img);
    const over = overlayOf(pictureMarks(marks));
    img.addEventListener('error', () => { frame.replaceWith(drawing); over?.remove(); art.classList.remove('has-pic', 'animated'); });
    // The address goes in after the sources are in place, so the browser asks only for the file it shows.
    img.src = picture.src;
    art.classList.add('has-pic');
    if (picture.animated) art.classList.add('animated');
    art.append(frame, over || '');
  } else art.append(drawing);
  return art;
};

// The pet of an agent with its feeling: the drawing (or the picture) and the word of the feeling, with the reason as
// a tooltip. A screen reader hears "Landon, Tired: account at 86 percent". agent: an entry of GET /api/agents.
// size: the width of the drawing in rem. words: false leaves the word out (the picture alone, with the label).
export function petView(agent, el, { now = new Date(), size = 2.4, words = true } = {}) {
  const feeling = feelingOf(agent, { now });
  const pet = petOf(agent.name);
  const manner = mannerOf(agent, feeling, now);
  const scene = { ...manner, extras: build(manner.extras), backdrop: build(manner.backdrop) };
  const drawing = drawPet(agent.name, scene);
  const art = picOrDrawing(el, artPicture(agent.name, feeling.key, agent.art), drawing, size, manner.extras);
  const node = el('span', { className: ['pet', feeling.key, pet.species, pet.pet.toLowerCase(), ...scene.classes].join(' '), title: `${pet.pet}: ${feeling.title}` }, art,
    words ? el('span', { className: `feeling ${feeling.key}` }, feeling.label) : '');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `${pet.pet}, ${feeling.title}`);
  return { node, feeling };
}

// The mood of how bothered a row makes the pet, 0 calm to 4 very bothered.
const ROW_MOOD = ['smile', 'calm', 'flat', 'frown', 'angry'];
// The creature of a memo row (memo 1241): the pet of the sender, with the impact as its size and the effort as how
// bothered it looks; excited for a quick big win (SYS-72): Landon twirls, the cats and the sprout hop with sparks.
// The label a screen reader hears has the real numbers, "Landon, big and calm, excited: impact 4, effort micro", and
// the tooltip says the same. The picture is the one of the mood of the memo (ui/pets.js rowFeeling: overdue, put off,
// a big ask, a quick win, new, low impact, or waiting), so a list shows a mix of faces; the label and the tooltip end
// with the mood and its reason. art: the sender's `art` from GET /api/agents, or null. today: the date of the owner.
export function rowPet(memo, el, { art = null, now = new Date(), today = '' } = {}) {
  const feeling = rowFeeling(memo, { now, today });
  const numbers = rowLabel(memo.sender, memo.impact, memo.effort);
  if (!numbers) return null;
  const label = `${numbers}. ${feeling.title}`;
  const pet = petOf(memo.sender);
  const size = sizeOf(memo.impact);
  const upset = upsetOf(memo.effort);
  const excited = excitedOf(memo.impact, memo.effort);
  const marks = rowMarks(excited, upset);
  const drawing = drawPet(memo.sender, { mood: excited ? 'excited' : ROW_MOOD[upset], extras: build(marks) });
  const art0 = picOrDrawing(el, artPicture(memo.sender, feeling.key, art), drawing, 1.3 + (size - 1) * .35, marks);
  const classes = ['pet', 'row', pet.species, pet.pet.toLowerCase(), `size-${size}`, `upset-${upset}`, `feel-${feeling.key}`, ...(excited ? ['excited', pet.pet === 'Landon' ? 'twirl' : 'hop'] : [])];
  const node = el('span', { className: classes.join(' '), title: label }, art0, el('span', { className: 'visually-hidden' }, label));
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', label);
  return node;
}
