// ==UserScript==
// @name         ChatGPT review-gate autosend
// @namespace    ptstory
// @version      1.4
// @description  Auto-submits a prefilled @review-gate prompt opened via chatgpt.com/?autosend=1&q=...
// @match        https://chatgpt.com/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const TAG = '[review-gate-autosend]';
  // Owners whose PRs may be auto-submitted. Add the corby repo's owner here if it isn't ptstory.
  const ALLOWED_OWNERS = ['ptstory'];
  const POLL_MS = 250;      // how often to check for the send button
  const SETTLE_MS = 1500;   // how long the composer must stay unchanged before sending
  const TIMEOUT_MS = 30000; // give up and leave the prompt for a manual send
  // ChatGPT's composer send button is labelled "Send" (verified Nov 13 2026); older labels kept as fallbacks.
  const SEND_SELECTORS = ['form button[aria-label="Send"]', 'button[data-testid="send-button"]', 'button[aria-label="Send prompt"]'];
  const COMPOSER_SELECTORS = ['form [contenteditable="true"]', 'form textarea', '#prompt-textarea'];

  // Captured at document-start: ChatGPT strips q from the URL once it has read it.
  const params = new URLSearchParams(location.search);
  console.info(TAG, 'loaded at', location.href);

  if (params.get('autosend') !== '1') {
    console.info(TAG, 'no autosend=1 in URL; doing nothing');
    return;
  }

  const prompt = params.get('q') || '';
  const match = prompt.match(/^@review-gate https:\/\/github\.com\/([\w.-]+)\/[\w.-]+\/pull\/\d+$/);
  if (!match || !ALLOWED_OWNERS.includes(match[1])) {
    console.warn(TAG, 'refused: prompt does not match the allowed pattern or owner', JSON.stringify(prompt));
    return;
  }

  const sentKey = 'review-gate-autosend:sent';
  if (sessionStorage.getItem(sentKey)) {
    console.info(TAG, 'already sent in this tab; doing nothing');
    return;
  }

  const find = (selectors) => selectors.map((s) => document.querySelector(s)).find(Boolean);
  const composerText = () => {
    const el = find(COMPOSER_SELECTORS);
    if (!el) return '';
    return el.value ?? el.innerText ?? '';
  };

  const started = Date.now();
  let readySince = null;
  let lastText = null;
  let lastLog = 0;

  const timer = setInterval(() => {
    const button = find(SEND_SELECTORS);
    const text = composerText();

    if (Date.now() - lastLog > 2000) {
      lastLog = Date.now();
      console.info(TAG, 'waiting', { buttonFound: !!button, buttonDisabled: button?.disabled, composerText: text });
    }

    if (!button || button.disabled || text !== prompt) {
      readySince = null;
    } else if (text !== lastText) {
      // Composer changed (e.g. the mention resolving); restart the settle window.
      readySince = Date.now();
    } else if (readySince && Date.now() - readySince >= SETTLE_MS) {
      clearInterval(timer);
      if (sessionStorage.getItem(sentKey)) {
        console.info(TAG, 'already sent in this tab; doing nothing');
        return;
      }
      sessionStorage.setItem(sentKey, String(Date.now()));
      button.click();
      console.info(TAG, 'sent', prompt);
      return;
    }
    lastText = text;

    if (Date.now() - started > TIMEOUT_MS) {
      clearInterval(timer);
      console.warn(TAG, 'not ready in time; leaving prompt for manual send');
    }
  }, POLL_MS);
})();
