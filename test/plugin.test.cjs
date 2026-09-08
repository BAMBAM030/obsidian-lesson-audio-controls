const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = 'Sprachen/Portugiesisch Brasilien';
const NOTE = `${ROOT}/Lektionen/2026-09-08.md`;
const CLIP = `${ROOT}/Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3`;
const OTHER = 'Musik/anderes.mp3';

// Only the unavoidable Obsidian host boundary is a test double.
// All DOM nodes, mutations, controls, events and media properties are jsdom.
function setup(t, { file = NOTE, markup = '', extraFiles = [] } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'app://obsidian.md/index.html' });
  const { window } = dom;
  const document = window.document;
  const containerEl = document.querySelector('main');
  containerEl.innerHTML = markup;
  class TFile {
    constructor(path) { this.path = path; this.extension = path.split('.').pop(); }
  }
  const files = new Map([NOTE, CLIP, OTHER, file, ...extraFiles].map(p => [p, new TFile(p)]));
  const events = new Map();
  const processors = [];
  const disposers = [];
  const leaves = [{ view: { containerEl, file: files.get(file), getViewType: () => file.endsWith('.md') ? 'markdown' : 'audio' } }];
  const resource = f => `app://local/vault/${encodeURI(typeof f === 'string' ? f : f.path)}?v=1`;
  const app = {
    vault: {
      getAbstractFileByPath: p => files.get(p) || null,
      getFiles: () => [...files.values()],
      getResourcePath: resource,
    },
    metadataCache: { getFirstLinkpathDest: (link, source) => files.get(link) || null },
    workspace: {
      iterateAllLeaves: callback => leaves.forEach(callback),
      onLayoutReady: callback => callback(),
      on: (name, callback) => { events.set(name, callback); return { name, callback }; },
      offref: ref => events.delete(ref.name),
    },
  };
  class Plugin {
    constructor(app) { this.app = app; }
    registerEvent(ref) { disposers.push(() => app.workspace.offref(ref)); }
    register(callback) { disposers.push(callback); }
    registerMarkdownPostProcessor(callback) { processors.push(callback); disposers.push(() => processors.splice(processors.indexOf(callback), 1)); }
  }
  class PluginSettingTab {
    constructor(app, plugin) { this.app = app; this.plugin = plugin; }
  }
  class Setting {}
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    module, exports: module.exports,
    require: name => { assert.equal(name, 'obsidian'); return { Plugin, PluginSettingTab, Setting, normalizePath: p => p.replace(/\\/g, '/') }; },
    document, window, MutationObserver: window.MutationObserver,
    console, URL, WeakMap, Map, Set, queueMicrotask,
  }, { filename: 'main.js' });
  const plugin = new module.exports(app);
  let unloaded = false;
  const unload = () => { if (!unloaded) { plugin.onunload?.(); disposers.reverse().forEach(fn => fn()); unloaded = true; } };
  t.after(() => { unload(); window.close(); });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { plugin, window, document, containerEl, files, resource, leaves, processors,
    layout: () => events.get('layout-change')?.(), unload, flush };
}

test('controls affect only their associated scoped clip, never unrelated or remote audio', async t => {
  const h = setup(t);
  h.containerEl.innerHTML = `<audio id="one" src="${h.resource(CLIP)}"></audio><audio id="two" src="${h.resource(CLIP)}"></audio><audio id="other" src="${h.resource(OTHER)}"></audio><audio id="remote" src="https://example.com/${CLIP}"></audio>`;
  await h.plugin.onload();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 2);
  h.document.querySelector('#one').nextElementSibling.querySelector('[data-rate="0.8"]').click();
  assert.equal(h.document.querySelector('#one').playbackRate, 0.8);
  for (const id of ['two', 'other', 'remote']) assert.equal(h.document.getElementById(id).playbackRate, 1);
  assert.equal(h.document.querySelector('#other').loop, false);
});

test('an unrelated note stays untouched even when it embeds a Portuguese clip', async t => {
  const h = setup(t, { file: 'Andere/Notiz.md' });
  h.containerEl.innerHTML = `<audio src="${h.resource(CLIP)}"></audio>`;
  await h.plugin.onload();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 0);
});

test('unrelated leaves allocate no MutationObserver', async t => {
  const h = setup(t, { file: 'Andere/Notiz.md' });
  h.containerEl.innerHTML = `<audio src="${h.resource(CLIP)}"></audio>`;
  await h.plugin.onload();
  await h.flush();
  assert.equal(h.plugin.observers.size, 0);
  h.leaves[0].view.file = h.files.get(NOTE);
  h.layout();
  await h.flush();
  assert.equal(h.plugin.observers.size, 1);
  h.leaves[0].view.file = h.files.get('Andere/Notiz.md');
  h.layout();
  await h.flush();
  assert.equal(h.plugin.observers.size, 0);
});

test('Wiederholen uses native loop, toggles explicitly, and never restarts a paused clip', async t => {
  const h = setup(t, { file: CLIP });
  h.containerEl.innerHTML = `<audio controls src="${h.resource(CLIP)}"></audio>`;
  const audio = h.document.querySelector('audio');
  let playCalls = 0;
  audio.play = () => { playCalls++; return Promise.resolve(); };
  await h.plugin.onload();
  await h.flush();
  const checkbox = h.document.querySelector('input[type="checkbox"]');
  assert.ok(checkbox, 'an explicit loop control is present');
  assert.equal(checkbox.closest('label').textContent.trim(), 'Wiederholen');
  assert.equal(audio.loop, true);
  assert.equal(checkbox.checked, true);
  checkbox.click();
  assert.equal(audio.loop, false);
  checkbox.click();
  assert.equal(audio.loop, true);
  audio.dispatchEvent(new h.window.Event('pause'));
  audio.dispatchEvent(new h.window.Event('ended'));
  await h.flush();
  assert.equal(audio.paused, true);
  assert.equal(playCalls, 0, 'native looping never calls play() after pause/ended');
  assert.equal(audio.playbackRate, 1);
});

test('unresolved ../Audio HTML sources become local vault resource URLs only', async t => {
  const h = setup(t, { markup: '<audio src="../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3"></audio><audio src="../Audio/missing.mp3"></audio><audio src="../../../Musik/anderes.mp3"></audio>' });
  await h.plugin.onload();
  await h.flush();
  const audios = h.document.querySelectorAll('audio');
  assert.equal(audios[0].getAttribute('src'), h.resource(CLIP));
  assert.equal(audios[1].getAttribute('src'), '../Audio/missing.mp3');
  assert.equal(audios[2].getAttribute('src'), '../../../Musik/anderes.mp3');
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 1);
});

test('already resolved or loaded media are not rewritten or reset', async t => {
  const h = setup(t);
  const resolved = h.resource(CLIP).replace('?v=1', '?different-mtime#t=3');
  h.containerEl.innerHTML = `<audio src="${resolved}"></audio><audio src="../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3"></audio>`;
  const audios = h.document.querySelectorAll('audio');
  Object.defineProperty(audios[1], 'readyState', { value: 1 });
  audios[1].currentTime = 12;
  await h.plugin.onload();
  await h.flush();
  assert.equal(audios[0].getAttribute('src'), resolved);
  assert.equal(audios[1].getAttribute('src'), '../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3');
  assert.equal(audios[1].currentTime, 12);
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 2);
});

test('new audio and raw tabs attach via mutations and layout events without duplicates', async t => {
  const h = setup(t);
  await h.plugin.onload();
  h.containerEl.innerHTML = `<audio src="${h.resource(CLIP)}"></audio>`;
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 1);
  const raw = h.document.createElement('section');
  raw.innerHTML = `<audio controls src="${h.resource(CLIP)}"></audio>`;
  h.document.body.append(raw);
  h.leaves.push({ view: { containerEl: raw, file: h.files.get(CLIP) } });
  h.layout();
  h.layout();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 2);
  h.layout();
  h.containerEl.append(h.document.createElement('p'));
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 2);
  assert.equal(raw.querySelector('audio').loop, true);
});

test('Markdown postprocessor source context resolves nested lesson embeds', async t => {
  const EMBED = `${ROOT}/Andere Ebene/Lektion.md`;
  const h = setup(t, { file: `${ROOT}/Index.md`, extraFiles: [EMBED] });
  await h.plugin.onload();
  const section = h.document.createElement('section');
  section.innerHTML = '<audio src="../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3"></audio>';
  h.processors.forEach(process => process(section, { sourcePath: EMBED }));
  h.containerEl.append(section);
  await h.flush();
  assert.equal(section.querySelectorAll('.lesson-audio-controls').length, 1);
  assert.equal(section.querySelector('audio').getAttribute('src'), h.resource(CLIP));
});

test('unload restores original media state and removes controls, listeners and observers', async t => {
  const relative = '../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3';
  const h = setup(t, { markup: `<audio src="${relative}"></audio>` });
  const audio = h.document.querySelector('audio');
  audio.playbackRate = 0.9;
  await h.plugin.onload();
  await h.flush();
  const button = h.document.querySelector('[data-rate="1.3"]');
  const checkbox = h.document.querySelector('input');
  button.click();
  assert.equal(audio.playbackRate, 1.3);
  h.layout(); // An already queued scan must not reattach after unload.
  h.unload();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 0);
  assert.equal(audio.playbackRate, 0.9);
  assert.equal(audio.loop, false);
  assert.equal(audio.hasAttribute('loop'), false);
  assert.equal(audio.getAttribute('src'), relative);
  button.click();
  checkbox.checked = true;
  checkbox.dispatchEvent(new h.window.Event('change'));
  assert.equal(audio.playbackRate, 0.9);
  assert.equal(audio.loop, false);
  h.containerEl.insertAdjacentHTML('beforeend', `<audio src="${h.resource(CLIP)}"></audio>`);
  h.layout();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 0);
});

test('removed or repurposed audio relinquishes controls without overwriting a new source', async t => {
  const h = setup(t);
  h.containerEl.innerHTML = `<audio src="${h.resource(CLIP)}"></audio><audio src="${h.resource(CLIP)}" loop="loop"></audio>`;
  const [first, second] = h.document.querySelectorAll('audio');
  await h.plugin.onload();
  await h.flush();
  first.nextElementSibling.querySelector('[data-rate="0.7"]').click();
  first.setAttribute('src', h.resource(OTHER));
  second.remove();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 0);
  assert.equal(first.getAttribute('src'), h.resource(OTHER));
  assert.equal(first.playbackRate, 1);
  assert.equal(first.loop, false);
  assert.equal(second.getAttribute('loop'), 'loop');
});

test('controls follow external rate and loop changes without resetting playback', async t => {
  const h = setup(t, { file: CLIP });
  h.containerEl.innerHTML = `<audio src="${h.resource(CLIP)}"></audio>`;
  const audio = h.document.querySelector('audio');
  await h.plugin.onload();
  await h.flush();
  audio.currentTime = 24;
  audio.playbackRate = 1.2;
  audio.dispatchEvent(new h.window.Event('ratechange'));
  audio.loop = false;
  await h.flush();
  assert.equal(h.document.querySelector('[data-rate="1.2"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.document.querySelector('input').checked, false);
  assert.equal(audio.currentTime, 24);
});

// Seam: plugin lifecycle + the actual controls a listener touches.
test('each lesson audio gets seven speed choices, initially 1×', async t => {
  const h = setup(t, { markup: '<audio controls src="../Audio/2026-09-08_02_oi-brasil-erster-kontakt_ptbr.mp3"></audio>' });
  await h.plugin.onload();
  await h.flush();
  const audio = h.document.querySelector('audio');
  const buttons = [...h.document.querySelectorAll('button[data-rate]')];
  assert.equal(buttons.length, 7);
  assert.deepEqual(buttons.map(b => b.dataset.rate), ['0.7', '0.8', '0.9', '1', '1.1', '1.2', '1.3']);
  assert.equal(audio.playbackRate, 1);
  assert.equal(buttons.find(b => b.getAttribute('aria-pressed') === 'true').dataset.rate, '1');
  buttons[0].click();
  assert.equal(audio.playbackRate, 0.7);
  buttons[6].click();
  assert.equal(audio.playbackRate, 1.3);
  assert.equal(buttons[6].getAttribute('aria-pressed'), 'true');
});

test('a configured lesson folder enables controls for another language without touching other folders', async t => {
  const customRoot = 'Languages/Italiano';
  const customNote = `${customRoot}/Lessons/2026-09-09-ciao.md`;
  const customClip = `${customRoot}/Audio/2026-09-09-ciao.mp3`;
  const h = setup(t, {
    file: customNote,
    extraFiles: [customClip],
    markup: '<audio controls src="../Audio/2026-09-09-ciao.mp3"></audio>',
  });
  h.plugin.settings = { lessonFolder: customRoot };
  await h.plugin.onload();
  await h.flush();
  assert.equal(h.document.querySelectorAll('.lesson-audio-controls').length, 1);
  assert.equal(h.document.querySelector('audio').getAttribute('src'), h.resource(customClip));
});
