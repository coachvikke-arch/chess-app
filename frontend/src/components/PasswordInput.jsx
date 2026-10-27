import { useState } from 'react';

/**
 * The one password field used everywhere in the app.
 *
 * The eye is a real button inside the field (not a decoration) so it works with
 * the keyboard and is announced correctly. It is `type="button"` on purpose: a
 * plain button inside a form would submit it the moment someone peeked at their
 * password.
 */
export default function PasswordInput({
  value,
  onChange,
  className = 'chess-input mt-1.5',
  placeholder = '••••••••',
  autoComplete,
  required = true,
  minLength,
  style,
  ...rest
}) {
  const [visible, setVisible] = useState(false);

  /* Margins belong on the wrapper: the eye is absolutely positioned against it,
   * so an `mt-*` left on the input would push the input out from under the eye. */
  const wrapperClass = className.split(/\s+/).filter((c) => /^-?m[trblxy]?-/.test(c)).join(' ');
  const inputClass = className.split(/\s+/).filter((c) => c && !/^-?m[trblxy]?-/.test(c)).join(' ');

  return (
    <div className={`relative ${wrapperClass}`}>
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        required={required}
        minLength={minLength}
        value={value}
        onChange={onChange}
        className={inputClass}
        /* `.chess-input` sets a shorthand padding in unlayered CSS, which beats
         * any Tailwind `pr-*` utility, so the room for the eye is reserved here. */
        style={{ paddingRight: '2.75rem', ...style }}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ivory-500 hover:text-gold-400 focus:outline-none focus-visible:text-gold-400 transition-colors"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.1 12S5.6 5.5 12 5.5 21.9 12 21.9 12 18.4 18.5 12 18.5 2.1 12 2.1 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6.4 0 9.9 6 9.9 6a17.6 17.6 0 0 1-2.8 3.5" />
      <path d="M6.3 7.6A17 17 0 0 0 2.1 12S5.6 18 12 18a10 10 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2.5 2.5 19 19" />
    </svg>
  );
}
