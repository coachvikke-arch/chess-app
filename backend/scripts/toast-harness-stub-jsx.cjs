/* Automatic-runtime shim for the toast harness (see toast-harness-stub-react.cjs). */
function jsx(type, props) {
  if (typeof type === 'function') return type({ ...(props || {}) });
  return { type, props: props || {} };
}
const jsxs = jsx;
const Fragment = 'fragment';
module.exports = { jsx, jsxs, Fragment };
