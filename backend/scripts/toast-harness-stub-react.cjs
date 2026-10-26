/* Minimal React stub — just enough to execute the real ToastProvider logic
 * (hooks + showToast) in node for the duplicate-toast diagnosis. Not a renderer.
 */
function createContext() {
  const ctx = { _current: undefined };
  ctx.Provider = function Provider(props) {
    ctx._current = props.value;
    return { __provider: true, children: props.children };
  };
  return ctx;
}

const hookState = [];
let hookIndex = 0;

function useState(initial) {
  const i = hookIndex++;
  if (hookState[i] === undefined) hookState[i] = { value: initial };
  const box = hookState[i];
  const set = (updater) => {
    box.value = typeof updater === 'function' ? updater(box.value) : updater;
  };
  return [box.value, set];
}

function useRef(initial) {
  const i = hookIndex++;
  if (hookState[i] === undefined) hookState[i] = { current: initial };
  return hookState[i];
}

function useCallback(fn) { return fn; }
function useContext(ctx) { return ctx._current; }
function createElement(type, props, ...children) {
  if (typeof type === 'function') return type({ ...(props || {}), children });
  return { type, props: props || {}, children };
}

function resetHooks() { hookIndex = 0; }

module.exports = {
  createContext, useState, useRef, useCallback, useContext, createElement,
  resetHooks, __hookState: hookState,
};
