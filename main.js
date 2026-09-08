'use strict';
const { Plugin, PluginSettingTab, Setting, normalizePath } = require('obsidian');

const RATES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];
const DEFAULT_LESSON_FOLDER = 'Sprachen/Portugiesisch Brasilien';
const AUDIO_EXTENSION = /\.(mp3|m4a|ogg|wav|flac|aac|webm)$/i;
const normalizeFolder = value => {
  const cleaned = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return cleaned || DEFAULT_LESSON_FOLDER;
};
const isScoped = (path, folder) => typeof path === 'string' && (path === folder || path.startsWith(`${folder}/`));
const isClip = (file, folder) => file && isScoped(file.path, folder) && AUDIO_EXTENSION.test(file.path);
const resourceKey = value => value.split(/[?#]/, 1)[0];

function relativePath(sourcePath, value, folder) {
  let decoded;
  try { decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//')) return null;
  const parts = decoded.startsWith('/') || decoded.startsWith(folder)
    ? [] : sourcePath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

module.exports = class LessonAudioControls extends Plugin {
  async onload() {
    await this.loadSettings();
    this.records = new Map();
    this.observers = new Map();
    this.sourceContexts = new WeakMap();
    this.stopped = false;
    this.scanQueued = false;
    this.registerMarkdownPostProcessor((element, context) => {
      this.sourceContexts.set(element, context.sourcePath);
      this.queueScan();
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.queueScan()));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.scan(); });
    if (typeof this.addSettingTab === 'function' && PluginSettingTab && Setting) {
      this.addSettingTab(new LessonAudioControlsSettingTab(this.app, this));
    }
  }

  async loadSettings() {
    const stored = typeof this.loadData === 'function' ? await this.loadData() : {};
    this.settings = { lessonFolder: DEFAULT_LESSON_FOLDER, ...(this.settings || {}), ...(stored || {}) };
    this.settings.lessonFolder = normalizeFolder(this.settings.lessonFolder);
  }

  async setLessonFolder(folder) {
    this.settings.lessonFolder = normalizeFolder(folder);
    if (typeof this.saveData === 'function') await this.saveData(this.settings);
    this.scan();
  }

  lessonFolder() {
    return normalizeFolder(this.settings?.lessonFolder);
  }

  queueScan() {
    if (this.stopped || this.scanQueued) return;
    this.scanQueued = true;
    queueMicrotask(() => {
      this.scanQueued = false;
      if (!this.stopped) this.scan();
    });
  }

  scan() {
    const folder = this.lessonFolder();
    const roots = new Set();
    const seen = new Set();
    this.app.workspace.iterateAllLeaves(leaf => {
      const root = leaf.view.containerEl;
      if (!root) return;
      const hostPath = leaf.view.file?.path;
      if (!isScoped(hostPath, folder)) {
        const observer = this.observers.get(root);
        if (observer) {
          observer.disconnect();
          this.observers.delete(root);
        }
        return;
      }
      roots.add(root);
      if (!this.observers.has(root)) {
        const observer = new root.ownerDocument.defaultView.MutationObserver(mutations => {
          for (const mutation of mutations) {
            if (mutation.attributeName === 'loop') this.records.get(mutation.target)?.sync();
            else this.queueScan();
          }
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'loop'] });
        this.observers.set(root, observer);
      }
      root.querySelectorAll('audio').forEach(audio => {
        let sourcePath = hostPath;
        for (let element = audio; element && root.contains(element); element = element.parentElement) {
          if (this.sourceContexts.has(element)) { sourcePath = this.sourceContexts.get(element); break; }
        }
        if (!isScoped(sourcePath, folder)) return;
        const file = this.resolveClip(audio, sourcePath, folder);
        if (!file) return;
        seen.add(audio);
        const record = this.records.get(audio);
        if (record && record.file.path !== file.path) this.detach(audio);
        if (!this.records.has(audio)) this.attach(audio, file);
      });
    });
    for (const audio of this.records.keys()) {
      if (!seen.has(audio)) this.detach(audio);
    }
    for (const [root, observer] of this.observers) {
      if (!roots.has(root)) { observer.disconnect(); this.observers.delete(root); }
    }
  }

  resolveClip(audio, sourcePath, folder) {
    const src = audio.getAttribute('src');
    if (!src) return null;
    // Match Obsidian's own resource URLs, not suffixes of arbitrary URLs.
    if (/^[a-z][a-z\d+.-]*:/i.test(src)) {
      if (/^(https?|data|blob):/i.test(src)) return null;
      return this.app.vault.getFiles().find(file => isClip(file, folder)
        && resourceKey(this.app.vault.getResourcePath(file)) === resourceKey(src)) || null;
    }
    const path = relativePath(sourcePath, src, folder);
    const file = path && this.app.vault.getAbstractFileByPath(path);
    return isClip(file, folder) ? file : null;
  }

  attach(audio, file) {
    const originalSrc = audio.getAttribute('src');
    const originalRate = audio.playbackRate;
    const originalLoop = audio.getAttribute('loop');
    const listeners = [];
    const listen = (target, event, callback) => {
      target.addEventListener(event, callback);
      listeners.push(() => target.removeEventListener(event, callback));
    };
    let appliedSrc = null;
    const resource = this.app.vault.getResourcePath(file);
    const isRelative = originalSrc && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(originalSrc);
    if (isRelative && audio.readyState === 0
      && (!audio.currentSrc || resourceKey(audio.currentSrc) !== resourceKey(resource))) {
      const fragment = originalSrc.includes('#') ? originalSrc.slice(originalSrc.indexOf('#')) : '';
      appliedSrc = resource + fragment;
      audio.setAttribute('src', appliedSrc);
    }
    const document = audio.ownerDocument;
    const controls = document.createElement('div');
    controls.className = 'lesson-audio-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Tempo – relativ zur gespeicherten Audiodatei');
    const label = document.createElement('span');
    label.className = 'lesson-audio-controls__label';
    label.textContent = 'Tempo';
    controls.append(label);
    const buttons = RATES.map(rate => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rate = String(rate);
      button.textContent = `${String(rate).replace('.', ',')}×`;
      button.setAttribute('aria-label', `${rate === 1 ? 'Wie gespeichert' : rate < 1 ? 'Langsamer' : 'Schneller'}: ${button.textContent}`);
      button.setAttribute('aria-pressed', String(audio.playbackRate === rate));
      listen(button, 'click', () => {
        audio.playbackRate = rate;
        sync();
      });
      controls.append(button);
      return button;
    });
    const loopLabel = document.createElement('label');
    loopLabel.className = 'lesson-audio-controls__loop';
    const loopInput = document.createElement('input');
    loopInput.type = 'checkbox';
    audio.loop = true;
    loopInput.checked = audio.loop;
    listen(loopInput, 'change', () => { audio.loop = loopInput.checked; });
    loopLabel.append(loopInput, document.createTextNode('Wiederholen'));
    controls.append(loopLabel);
    // Browser-native looping respects pause. Never install an ended/play handler.
    audio.insertAdjacentElement('afterend', controls);
    const sync = () => {
      buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === audio.playbackRate)));
      loopInput.checked = audio.loop;
    };
    listen(audio, 'ratechange', sync);
    this.records.set(audio, { controls, file, originalSrc, originalRate, originalLoop, appliedSrc, listeners, sync });
  }

  detach(audio) {
    const record = this.records.get(audio);
    if (!record) return;
    this.records.delete(audio);
    record.listeners.forEach(remove => remove());
    record.controls.remove();
    audio.playbackRate = record.originalRate;
    if (record.originalLoop === null) audio.removeAttribute('loop');
    else audio.setAttribute('loop', record.originalLoop);
    // Restore only our own rewrite; never overwrite a new host-assigned source.
    if (record.appliedSrc !== null && audio.getAttribute('src') === record.appliedSrc) {
      if (record.originalSrc === null) audio.removeAttribute('src');
      else audio.setAttribute('src', record.originalSrc);
    }
  }

  onunload() {
    this.stopped = true;
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const audio of this.records.keys()) this.detach(audio);
    this.sourceContexts = new WeakMap();
  }
};

class LessonAudioControlsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Lern-Audio-Steuerung' });
    new Setting(containerEl)
      .setName('Lektionsordner')
      .setDesc('Nur Audio-Dateien und Notizen innerhalb dieses Vault-Ordners erhalten Tempo- und Wiederholungssteuerungen.')
      .addText(text => text
        .setPlaceholder('Sprachen/Portugiesisch Brasilien')
        .setValue(this.plugin.lessonFolder())
        .onChange(async value => this.plugin.setLessonFolder(value)));
  }
}
