import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, countryByDial, countryByIso } from '../data/countries';
import { digitsOnly, validateNationalNumber } from '../utils/phone';

let uid = 0;

/**
 * Country-code + number field.
 *
 * Controlled through two strings so the dial code survives independently of
 * the number: `{ countryCode: '+91', phoneNumber: '9876543210' }`.
 */
export default function PhoneInput({
  label = 'Phone number',
  countryCode,
  phoneNumber = '',
  onChange,
  required = false,
  error = '',
  disabled = false,
  placeholder = '98765 43210',
  hint = '',
  className = '',
  id,
  name,
  autoComplete = 'tel-national',
}) {
  const selected = countryByDial(countryCode) || countryByIso('IN');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [touched, setTouched] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const wrapRef = useRef(null);
  const rowRef = useRef(null);
  const triggerRef = useRef(null);
  const numberRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const fieldId = useRef(id || `phone-${++uid}`).current;
  const listId = `${fieldId}-countries`;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const dial = q.replace(/^\+/, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase() === q ||
        c.dial.replace('+', '').startsWith(dial),
    );
  }, [search]);

  const validation = validateNationalNumber(selected, phoneNumber);
  const shownError = error || (touched ? validation : '');

  const placePanel = () => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const width = window.innerWidth < 640 ? rect.width : Math.min(340, window.innerWidth - 16);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 260 && rect.top > spaceBelow;
    const available = Math.max(0, (openUp ? rect.top : spaceBelow) - 14);
    setPanelStyle({
      position: 'fixed',
      left,
      width,
      maxHeight: Math.max(180, Math.min(360, available)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
  };

  const openPanel = () => {
    if (disabled) return;
    setSearch('');
    const idx = COUNTRIES.findIndex((c) => c.iso === selected.iso);
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const closePanel = (focus) => {
    setOpen(false);
    if (focus === 'trigger') triggerRef.current?.focus();
    if (focus === 'number') numberRef.current?.focus();
  };

  const pick = (country) => {
    const next = digitsOnly(phoneNumber).slice(0, country.max);
    onChange?.({ countryCode: country.dial, phoneNumber: next });
    setOpen(false);
    numberRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    placePanel();
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closePanel('trigger');
    };
    const onReflow = () => placePanel();
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[data-hl="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, filtered.length]);

  const move = (delta) => {
    if (!filtered.length) return;
    setHighlight((h) => {
      const next = (h + delta + filtered.length) % filtered.length;
      return next;
    });
  };

  const onTriggerKeyDown = (e) => {
    if (open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel();
    }
  };

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const country = filtered[highlight];
      if (country) pick(country);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePanel('trigger');
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const onNumberChange = (e) => {
    let digits = digitsOnly(e.target.value);
    // A pasted full international number carries the dial code — drop it so
    // the visible number stays national-length.
    const code = selected.dial.slice(1);
    if (digits.length > selected.max && digits.startsWith(code)) digits = digits.slice(code.length);
    onChange?.({ countryCode: selected.dial, phoneNumber: digits.slice(0, selected.max) });
  };

  return (
    <div className={`phone-field ${className}`} ref={wrapRef}>
      <label className="phone-field-label" htmlFor={fieldId}>
        {label}
        {required ? ' *' : ''}
      </label>
      <div className="phone-input-row" ref={rowRef}>
        <button
          type="button"
          ref={triggerRef}
          className="phone-code-btn"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`Country code, currently ${selected.name} ${selected.dial}`}
          title={`${selected.name} ${selected.dial}`}
          onClick={() => (open ? setOpen(false) : openPanel())}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="phone-code-flag" aria-hidden="true">{selected.flag}</span>
          <span className="phone-code-dial">{selected.dial}</span>
          <span className="phone-caret" aria-hidden="true">▾</span>
        </button>
        <input
          ref={numberRef}
          id={fieldId}
          name={name}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete}
          className={`chess-input phone-number-input${shownError ? ' phone-number-input--error' : ''}`}
          value={phoneNumber}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={selected.max}
          aria-invalid={shownError ? 'true' : undefined}
          aria-describedby={shownError ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          onChange={onNumberChange}
          onBlur={() => setTouched(true)}
        />
      </div>

      {shownError ? (
        <p className="phone-error" id={`${fieldId}-error`} role="alert">{shownError}</p>
      ) : hint ? (
        <p className="phone-hint" id={`${fieldId}-hint`}>{hint}</p>
      ) : null}

      {open && panelStyle && (
        <div className="phone-country-panel" style={panelStyle}>
          <input
            ref={searchRef}
            type="search"
            className="phone-country-search"
            placeholder="Search country or code…"
            value={search}
            aria-label="Search country or dial code"
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
          <ul className="phone-country-list" id={listId} role="listbox" ref={listRef} aria-label="Countries">
            {filtered.length === 0 && (
              <li className="phone-country-empty">No country matches “{search.trim()}”.</li>
            )}
            {filtered.map((c, i) => (
              <li
                key={c.iso}
                role="option"
                aria-selected={c.iso === selected.iso}
                data-hl={i === highlight ? 'true' : undefined}
                className={`phone-country-option${c.iso === selected.iso ? ' is-selected' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                <span className="phone-country-flag" aria-hidden="true">{c.flag}</span>
                <span className="phone-country-name">{c.name}</span>
                <span className="phone-country-dial">{c.dial}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
