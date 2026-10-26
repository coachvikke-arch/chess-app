import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Tests for attaching the certificate PDF to a WhatsApp message.
 *
 * The interesting behaviour is all in the branching and the promises, so
 * `navigator.share` / `navigator.canShare` are stubbed here rather than skipped:
 * the whole point of the module is deciding correctly between "share the file",
 * "save it instead" and "the admin cancelled", and a stub is the only way to
 * exercise all three.
 *
 * Run: node --test scripts/certificate-share.test.mjs
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src', 'utils', 'certificateShare.js');

/* Minimal DOM the module touches, so the import works under plain node. */
globalThis.document = {
  createElement: () => ({ click() {}, set href(v) { this._href = v; }, set download(v) { this._download = v; }, set rel(v) { this._rel = v; } }),
  body: { appendChild() {}, removeChild() {} },
};
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.window = { open: () => ({}) };
globalThis.setTimeout = globalThis.setTimeout || ((fn) => fn());

/* A bare Windows path is not a valid ESM specifier — import it as a file URL. */
const {
  canShareFiles, canShareFileWithText, shareCertificate, openWhatsApp, savePdf, pdfFilename,
} = await import(pathToFileURL(SRC).href);

/** A tiny valid File — the module only checks the type and passes it through. */
function pdfFile(name = 'CERT-2026-0001.pdf') {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

/**
 * Swap `navigator` for the duration of an async call.
 *
 * MUST be awaited. shareCertificate() suspends at its first `await`, so a
 * synchronous finally-block would put the real navigator back before the retry
 * path ever ran — which silently turns the stubbed cases into the "no share
 * support" case and makes them pass or fail for the wrong reason.
 */
async function withNavigator(stub, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  const prev = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: stub, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true, writable: true });
    else delete globalThis.navigator;
  }
}

test('pdfFilename derives the name from the certificate number', () => {
  assert.strictEqual(pdfFilename('CERT-2026-0001'), 'CERT-2026-0001.pdf');
  assert.strictEqual(pdfFilename(''), 'certificate.pdf');
  /* A number is used as a filename, so path separators must not survive. */
  assert.strictEqual(pdfFilename('../../etc/passwd'), 'etcpasswd.pdf');
});

test('canShareFiles is false without a share API', () => {
  withNavigator({}, () => {
    assert.strictEqual(canShareFiles(), false);
  });
});

test('canShareFiles is false when share exists but cannot take files', () => {
  /* `share` existing does not mean sharing FILES works — canShare is the only
     reliable test, and a browser that reports false here must fall back. */
  withNavigator({ share: async () => {}, canShare: () => false }, () => {
    assert.strictEqual(canShareFiles(), false);
  });
});

test('canShareFiles is true when the browser accepts a file share', () => {
  withNavigator({ share: async () => {}, canShare: ({ files }) => Array.isArray(files) && files.length > 0 }, () => {
    assert.strictEqual(canShareFiles(), true);
  });
});

test('a supported browser hands the PDF to the share sheet', async () => {
  let received = null;
  const stub = {
    canShare: () => true,
    share: async (data) => { received = data; },
  };
  const out = await withNavigator(stub, () => shareCertificate({ file: pdfFile(), waUrl: 'https://wa.me/1?text=x' }));
  assert.strictEqual(out.result, 'shared');
  assert.strictEqual(received.files.length, 1, 'exactly one file must be attached');
  assert.strictEqual(received.files[0].type, 'application/pdf');
  assert.strictEqual(received.files[0].name, 'CERT-2026-0001.pdf');
});

test('the greeting travels WITH the file, not instead of it', async () => {
  /* This is the whole point of the share sheet. Sharing the PDF alone delivers a
     bare document with no explanation of what it is. */
  let received = null;
  const stub = { canShare: () => true, share: async (data) => { received = data; } };
  const greeting = 'Vanakkam Ramesh!\nLevel 3 completed\nhttps://app.test/c.pdf';
  const out = await withNavigator(stub, () => shareCertificate({
    file: pdfFile(), waUrl: 'https://wa.me/1', filename: 'CERT-2026-0001.pdf',
    text: greeting, title: 'Level 3 completed',
  }));
  assert.strictEqual(out.result, 'shared');
  assert.strictEqual(received.text, greeting, 'the share payload must carry the message');
  assert.strictEqual(received.title, 'Level 3 completed');
  assert.strictEqual(received.files.length, 1, 'and the file');
});

test('no text key is sent when there is no message', async () => {
  let received = null;
  const stub = { canShare: () => true, share: async (data) => { received = data; } };
  await withNavigator(stub, () => shareCertificate({ file: pdfFile(), filename: 'c.pdf' }));
  assert.ok(!('text' in received), 'an empty text key must not be sent');
});

test('canShareFileWithText is separate from canShareFiles', async () => {
  /* Some browsers share a file happily but reject a payload that mixes files with
     text. A file-only share would drop the greeting, so this must be detectable. */
  withNavigator({ share: async () => {}, canShare: () => true }, () => {
    assert.strictEqual(canShareFiles(), true);
    assert.strictEqual(canShareFileWithText(), true);
  });
  withNavigator({ share: async () => {}, canShare: ({ text }) => !text }, () => {
    assert.strictEqual(canShareFiles(), true, 'files alone are still shareable');
    assert.strictEqual(canShareFileWithText(), false, 'but not together with text');
  });
});

test('a browser that rejects text+files retries with the file alone', async () => {
  /* Better to deliver the PDF and say the greeting could not travel with it, than to
     deliver nothing. */
  const seen = [];
  const stub = {
    canShare: () => true,
    share: async (data) => {
      seen.push(data);
      if ('text' in data) throw new TypeError('files and text cannot be combined');
    },
  };
  const out = await withNavigator(stub, () => shareCertificate({
    file: pdfFile(), filename: 'c.pdf', text: 'hello',
  }));
  assert.strictEqual(out.result, 'shared_without_text');
  assert.match(out.reason, /PDF on its own/);
  assert.strictEqual(seen.length, 2, 'must retry with a file-only payload');
  assert.strictEqual(seen[1].files.length, 1);
  assert.ok(!('text' in seen[1]));
});

test('dismissing the share sheet is NOT a send', async () => {
  /* Marking a certificate sent when the admin changed their mind would put a lie
     in the record — and WhatsApp gives no way to correct it later. */
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const stub = { canShare: () => true, share: async () => { throw abort; } };
  const out = await withNavigator(stub, () => shareCertificate({ file: pdfFile(), waUrl: 'https://wa.me/1' }));
  assert.strictEqual(out.result, 'cancelled');
});

test('an unsupported browser saves the PDF instead of sharing it', async () => {
  let saved = null;
  const prevCreate = document.createElement;
  document.createElement = () => ({ click() { saved = true; }, set href(v) { this._href = v; }, set download(v) { this._download = v; }, set rel(v) {} });
  try {
    const out = await withNavigator({}, () => shareCertificate({ file: pdfFile(), waUrl: 'https://wa.me/1' }));
    assert.strictEqual(out.result, 'downloaded');
    assert.match(out.reason, /cannot attach files/i);
    assert.strictEqual(saved, true, 'the PDF must be saved so the admin can attach it');
  } finally {
    document.createElement = prevCreate;
  }
});

test('a browser that only rejects files at share time still falls back', async () => {
  /* Some browsers pass canShare and then throw a TypeError on a real file share. */
  let saved = false;
  const prevCreate = document.createElement;
  document.createElement = () => ({ click() { saved = true; }, set href(v) { this._href = v; }, set download(v) { this._download = v; }, set rel(v) {} });
  try {
    const stub = { canShare: () => true, share: async () => { throw new TypeError('cannot share files'); } };
    const out = await withNavigator(stub, () => shareCertificate({ file: pdfFile(), waUrl: 'https://wa.me/1' }));
    assert.strictEqual(out.result, 'downloaded');
    assert.strictEqual(saved, true);
  } finally {
    document.createElement = prevCreate;
  }
});

test('a genuine share failure is reported, not silently downgraded', async () => {
  const stub = { canShare: () => true, share: async () => { throw new Error('network went away'); } };
  const out = await withNavigator(stub, () => shareCertificate({ file: pdfFile(), waUrl: 'https://wa.me/1' }));
  assert.strictEqual(out.result, 'failed');
  assert.match(out.reason, /network/);
});

test('a missing PDF fails rather than pretending to send', async () => {
  const out = await withNavigator({ canShare: () => true, share: async () => {} },
    () => shareCertificate({ file: null, waUrl: 'https://wa.me/1' }));
  assert.strictEqual(out.result, 'failed');
  assert.match(out.reason, /could not be loaded/i);
});

test('savePdf names the file from the certificate number', () => {
  let seen = null;
  const prevCreate = document.createElement;
  document.createElement = () => ({
    click() { seen = { href: this._href, download: this._download }; },
    set href(v) { this._href = v; },
    set download(v) { this._download = v; },
    set rel(v) {},
  });
  try {
    savePdf(pdfFile(), 'CERT-2026-0007.pdf');
    assert.strictEqual(seen.download, 'CERT-2026-0007.pdf');
    assert.strictEqual(seen.href, 'blob:stub');
  } finally {
    document.createElement = prevCreate;
  }
});

test('the wa.me link alone cannot carry a file — the module must not pretend it can', () => {
  /* Guards the core assumption: the deep link format is text-only, which is why
     the share sheet exists at all. If this ever stops being true the fallback can
     be simplified, but until then the PDF has to go through share/download. */
  const src = fs.readFileSync(SRC, 'utf8');
  assert.match(src, /navigator\.share/, 'the file must be handed to the share sheet');
  assert.ok(
    !/wa\.me\/\$\{[^}]+\}\?text=[^`]*\bfile\b/.test(src),
    'a wa.me URL cannot carry an attachment; do not build one that implies it can'
  );
});

test('openWhatsApp returns whether a tab was actually opened', () => {
  const prev = globalThis.window;
  globalThis.window = { open: () => ({}) };
  try {
    assert.strictEqual(openWhatsApp('https://wa.me/91984100001?text=hi'), true);
  } finally {
    globalThis.window = prev;
  }
  globalThis.window = { open: () => null };
  try {
    /* A blocked pop-up must be detectable, so the caller can avoid recording a
       send that never happened. */
    assert.strictEqual(openWhatsApp('https://wa.me/91984100001?text=hi'), false);
  } finally {
    globalThis.window = prev;
  }
  assert.strictEqual(openWhatsApp(null), false);
});