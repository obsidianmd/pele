import { PeleError, enableZoom, render } from 'pele';
import { editorHighlighting } from '../lib/editor-highlighting';
import { formatSvg } from '../lib/format-svg';
import { siteIcon } from '../lib/icons';
import { readPlaygroundSource } from '../lib/playground-link';
import { mermaidAutocomplete } from './playground-autocomplete';
import { createPlaygroundEditor } from './playground-editor';
import { setupPlaygroundColumns } from './playground-columns';
import { setupPlaygroundCopy } from './playground-copy';
import { playgroundMath } from './playground-math';
import { renderMermaid } from './playground-mermaid';
import { setupPlaygroundSettings } from './playground-settings';
import { setupPlaygroundShare } from './playground-share';
import { formatTime, timed } from '../lib/timing';
import { diagnosis, setStatus } from './playground-status';
import { setupPlaygroundTabs } from './playground-tabs';

type View = 'pele' | 'mermaid' | 'svg' | 'compare';

const wrapStorageKey = 'pele:playground:wrap';
const renderDelay = 150;

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The preference still applies for this visit.
  }
};

const root = document.querySelector<HTMLElement>('.playground')!;
const outputPanel = document.getElementById('output-panel')!;
const preview = document.getElementById('playground-preview')!;
const peleOutput = document.getElementById('pele-output')!;
const zoom = enableZoom(peleOutput);
const mermaidOutput = document.getElementById('mermaid-output')!;
const peleTime = document.getElementById('pele-time')!;
const mermaidTime = document.getElementById('mermaid-time')!;
const samples = JSON.parse(document.getElementById('playground-samples')!.textContent ?? '[]') as string[];

const savedWrap = readStorage(wrapStorageKey);
const initialWrap = savedWrap === 'true' || savedWrap === 'false' ? savedWrap === 'true' : window.matchMedia('(max-width: 760px)').matches;

const linkedSource = readPlaygroundSource(window.location.hash);
if (linkedSource !== null) document.querySelector<HTMLTextAreaElement>('#playground-input')!.value = linkedSource;

const input = createPlaygroundEditor('input', 'Mermaid source', [...editorHighlighting('mermaid'), mermaidAutocomplete()], initialWrap);
const output = createPlaygroundEditor('output', 'SVG source', editorHighlighting('xml'), initialWrap);
const inputCopy = setupPlaygroundCopy('input', 'Copy source', () => input.value);
const outputCopy = setupPlaygroundCopy('output', 'Copy SVG', () => output.value);

let initialSource = input.value;
let view: View = 'pele';
let timer: number | undefined;
let peleStatus: { text: string; error: boolean } = { text: '', error: false };
let mermaidStatus = '';
let mermaidRevision = 0;
let mermaidRendered: { source: string } | undefined;

const showsMermaid = () => view === 'mermaid' || view === 'compare';

function showOutputStatus() {
  const text = [peleStatus.text, showsMermaid() ? mermaidStatus : ''].filter(Boolean).join(' · ');
  setStatus(output.status, text, peleStatus.error ? 'error' : '');
}

function showEmpty(element: HTMLElement, message: string) {
  const note = document.createElement('p');
  note.className = 'playground-diagram-empty';
  note.textContent = message;
  element.replaceChildren(note);
  delete element.dataset.stale;
}

function showError(error: unknown) {
  const found = diagnosis(error);
  const located = found.line > 0 ? found : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const rest = message.split('\n').slice(1);

  input.element.setAttribute('aria-invalid', 'true');
  input.status.replaceChildren();
  input.status.dataset.state = 'error';
  const diagnostic = document.createElement(located ? 'button' : 'div');
  diagnostic.className = 'playground-diagnostic';
  setStatus(diagnostic, found.text, 'error');
  if (located && diagnostic instanceof HTMLButtonElement) {
    diagnostic.type = 'button';
    diagnostic.addEventListener('click', () => input.selectDiagnostic(located.line, located.column));
  }
  input.status.append(diagnostic);

  const snippet = error instanceof PeleError ? error.snippet : '';
  const detail = (snippet && !message.includes(snippet) ? [snippet, ...rest] : rest).join('\n').trimEnd();
  if (detail) {
    const block = document.createElement('pre');
    block.className = 'playground-diagnostic-detail';
    block.textContent = detail;
    input.status.append(block);
  }
}

let drawnWidth = 0;

function renderPele() {
  const source = input.value;
  inputCopy.refresh();
  if (!source.trim()) {
    input.element.removeAttribute('aria-invalid');
    setStatus(input.status, '');
    showEmpty(peleOutput, 'Enter Mermaid source to render a diagram.');
    output.setValue('', { notify: false });
    peleStatus = { text: '', error: false };
    peleTime.textContent = '';
    outputCopy.refresh();
    showOutputStatus();
    return;
  }
  try {
    // Labels are measured with the font the preview uses, so text fits its nodes.
    const style = getComputedStyle(peleOutput);
    drawnWidth = peleOutput.clientWidth;
    const maxWidth = drawnWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const font = (name: string): string | undefined => style.getPropertyValue(name).trim() || undefined;
    const options = {
      fontFamily: font('--pele-font') ?? style.fontFamily,
      fontFamilyMono: font('--pele-font-mono'),
      idPrefix: 'pele-',
      maxWidth,
      icons: siteIcon,
      math: playgroundMath(source, renderPele),
    };
    const { result, time } = timed(() => render(source, options));

    peleOutput.innerHTML = result.svg;
    zoom.refresh();
    delete peleOutput.dataset.stale;
    output.setValue(formatSvg(result.svg), { reset: false, notify: false });
    input.element.setAttribute('aria-invalid', 'false');
    setStatus(input.status, `Valid ${result.type}`, 'success');
    peleStatus = { text: `Pele ${time}`, error: false };
    peleTime.textContent = time;
  } catch (error) {
    showError(error);
    // Keep the last good diagram visible, dimmed, while the source is being edited.
    if (peleOutput.querySelector('svg')) peleOutput.dataset.stale = '';
    else showEmpty(peleOutput, 'Pele could not render this diagram.');
    output.setValue('', { notify: false });
    peleStatus = { text: 'Pele could not render this diagram.', error: true };
    peleTime.textContent = '';
  }
  outputCopy.refresh();
  showOutputStatus();
}

async function updateMermaid() {
  if (!showsMermaid()) return;
  const source = input.value;
  if (mermaidRendered?.source === source) return;
  const revision = ++mermaidRevision;
  if (!source.trim()) {
    mermaidRendered = { source };
    showEmpty(mermaidOutput, 'Enter Mermaid source to render a diagram.');
    mermaidStatus = '';
    mermaidTime.textContent = '';
    showOutputStatus();
    return;
  }
  mermaidOutput.setAttribute('aria-busy', 'true');
  if (!mermaidOutput.querySelector('svg')) showEmpty(mermaidOutput, 'Loading Mermaid…');
  mermaidStatus = 'Mermaid rendering…';
  showOutputStatus();
  try {
    const result = await renderMermaid(source, 'dark');
    if (revision !== mermaidRevision) return;
    mermaidRendered = { source };
    mermaidOutput.innerHTML = result.svg;
    delete mermaidOutput.dataset.stale;
    const time = formatTime(result.time);
    mermaidStatus = `Mermaid ${time}`;
    mermaidTime.textContent = time;
  } catch (error) {
    if (revision !== mermaidRevision) return;
    mermaidRendered = { source };
    showEmpty(mermaidOutput, error instanceof Error ? error.message : 'Mermaid could not render this diagram.');
    mermaidStatus = 'Mermaid could not render this diagram.';
    mermaidTime.textContent = '';
  }
  mermaidOutput.removeAttribute('aria-busy');
  showOutputStatus();
}

// Dragging the divider or turning a phone changes the room a chart is drawn for.
let resizeFrame = 0;
new ResizeObserver(() => {
  if (peleOutput.clientWidth === drawnWidth || peleOutput.clientWidth === 0 || !input.value.trim()) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderPele);
}).observe(peleOutput);

function renderNow() {
  window.clearTimeout(timer);
  renderPele();
  void updateMermaid();
}

function scheduleRender() {
  window.clearTimeout(timer);
  inputCopy.refresh();
  timer = window.setTimeout(renderNow, renderDelay);
}

function setSource(source: string) {
  initialSource = source;
  input.setValue(source, { notify: false });
  renderNow();
}

input.onChange(scheduleRender);

const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]:is(button)')];
function setView(next: View) {
  view = next;
  outputPanel.dataset.view = next;
  viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
  if (next === 'svg') void output.measure();
  showOutputStatus();
  void updateMermaid();
}
viewButtons.forEach((button, index) => {
  button.addEventListener('click', () => setView(button.dataset.view as View));
  button.addEventListener('keydown', (event) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % viewButtons.length;
    else if (event.key === 'ArrowLeft') next = (index + viewButtons.length - 1) % viewButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = viewButtons.length - 1;
    else return;
    event.preventDefault();
    viewButtons[next].click();
    viewButtons[next].focus();
  });
});

const wrapButton = document.querySelector<HTMLButtonElement>('#wrap-lines')!;
wrapButton.setAttribute('aria-checked', String(initialWrap));
wrapButton.addEventListener('click', () => {
  const enabled = wrapButton.getAttribute('aria-checked') !== 'true';
  wrapButton.setAttribute('aria-checked', String(enabled));
  input.setWrap(enabled);
  output.setWrap(enabled);
  writeStorage(wrapStorageKey, String(enabled));
});

window.addEventListener('hashchange', () => {
  const source = readPlaygroundSource(window.location.hash);
  if (source !== null) setSource(source);
});
document.getElementById('reset-example')!.addEventListener('click', () => setSource(initialSource));
document.getElementById('clear-playground')!.addEventListener('click', () => {
  input.setValue('', { notify: false });
  renderNow();
});
document.querySelectorAll<HTMLButtonElement>('[data-playground-sample]').forEach((button) => {
  button.addEventListener('click', () => {
    const sample = samples[Number(button.dataset.playgroundSample)];
    if (sample === undefined) return;
    setSource(sample);
    document.querySelector<HTMLButtonElement>('[data-playground-tab="input"]')!.click();
  });
});

const fileInput = document.querySelector<HTMLInputElement>('#source-file')!;
let fileRevision = 0;
document.getElementById('open-file')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  // Allow selecting the same file again after changing it on disk.
  fileInput.value = '';
  if (!file) return;
  const revision = ++fileRevision;
  try {
    const text = await file.text();
    if (revision !== fileRevision) return;
    setSource(text.replace(/^﻿/, ''));
    document.querySelector<HTMLButtonElement>('[data-playground-tab="input"]')!.click();
  } catch {
    if (revision === fileRevision) setStatus(input.status, `Could not read ${file.name}. Try opening it again.`, 'error');
  }
});
input.onChange(() => { fileRevision++; });

setupPlaygroundColumns();
setupPlaygroundTabs();
setupPlaygroundSettings();
setupPlaygroundShare(() => input.value);
root.querySelectorAll('[data-playground-tab]').forEach((tab) => tab.addEventListener('click', () => {
  void input.measure();
  void output.measure();
}));

void document.fonts.ready.then(async () => {
  renderNow();
  await Promise.all([input.measure(), output.measure()]);
  requestAnimationFrame(() => root.dispatchEvent(new Event('playground-ready')));
});
