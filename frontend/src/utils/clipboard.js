/* Clipboard copy with a graceful fallback.
 *
 * `navigator.clipboard` is unavailable outside a secure context (plain http,
 * embedded webviews, some desktop shells), where `writeText` is simply absent
 * or rejects. The hidden-textarea + execCommand path still works there, so the
 * copy succeeds either way and callers only have to branch on the boolean.
 *
 * A failed fallback must still clean up after itself: the textarea is removed
 * on a throw too, or it stays invisible over the page and swallows clicks. */

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    try {
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
    return true;
  } catch {
    return false;
  }
}