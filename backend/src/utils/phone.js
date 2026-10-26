/*
 * Phone normalisation shared by every write path.
 *
 * Stored shape: `country_code` ("+91") beside `phone` as a combined E.164
 * string ("+919876543210"). Legacy rows may still hold a bare national number
 * or a spaced value, so writers accept all three shapes and normalise rather
 * than trusting the caller.
 */

const DEFAULT_COUNTRY_CODE = '+91';
const MAX_E164_DIGITS = 15;
const MIN_NATIONAL_DIGITS = 4;

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** "+91", "91" → "+91"; empty → null; anything else → undefined (invalid). */
function normaliseCountryCode(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\+?\d{1,4}$/.test(text)) return undefined;
  return `+${digitsOnly(text)}`;
}

/**
 * @param {{ phone?: any, countryCode?: any, phoneNumber?: any }} input
 * @returns {{ changed: boolean, countryCode?: string|null, phone?: string|null, error?: string }}
 */
function normalisePhone({ phone, countryCode, phoneNumber } = {}) {
  const code = normaliseCountryCode(countryCode);
  if (code === undefined) return { changed: false, error: 'Country code must be a dial code like +91' };

  /* The form sends the dial code and the national number separately — that is
     the authoritative shape, so use it when present. */
  if (phoneNumber !== undefined) {
    const raw = String(phoneNumber ?? '').trim();
    if (raw && !/^\d+$/.test(raw)) return { changed: false, error: 'Phone number must contain digits only' };
    const national = digitsOnly(raw);
    const dial = code || DEFAULT_COUNTRY_CODE;
    const max = Math.max(MIN_NATIONAL_DIGITS, MAX_E164_DIGITS - (dial.length - 1));
    if (national.length > max) return { changed: false, error: `Phone number is too long for ${dial}` };
    if (national && national.length < MIN_NATIONAL_DIGITS) {
      return { changed: false, error: 'Enter a valid phone number' };
    }
    return { changed: true, countryCode: dial, phone: national ? `${dial}${national}` : null };
  }

  if (phone === undefined) return { changed: false };

  const raw = String(phone ?? '').trim();
  if (!raw) return { changed: true, countryCode: code || DEFAULT_COUNTRY_CODE, phone: null };

  if (!/^[+\d][\d\s\-().]*$/.test(raw)) {
    return { changed: false, error: 'Phone number may contain digits, spaces, +, dashes and brackets only' };
  }

  const digits = digitsOnly(raw);
  if (!digits) return { changed: false, error: 'Enter a valid phone number' };

  const hadPlus = raw.startsWith('+');
  let dial = code;
  let national = digits;

  if (hadPlus) {
    if (dial) {
      const codeDigits = dial.slice(1);
      if (digits.startsWith(codeDigits)) national = digits.slice(codeDigits.length);
    }
  } else if (!dial) {
    /* Legacy value with no stored code: a bare national number defaults to
       India, a longer one already carries its country code. */
    dial = digits.length > 10 ? null : DEFAULT_COUNTRY_CODE;
  }

  if (dial) {
    const max = Math.max(MIN_NATIONAL_DIGITS, MAX_E164_DIGITS - (dial.length - 1));
    if (national.length > max) return { changed: false, error: `Phone number is too long for ${dial}` };
    if (national.length < MIN_NATIONAL_DIGITS) return { changed: false, error: 'Enter a valid phone number' };
    return { changed: true, countryCode: dial, phone: `${dial}${national}` };
  }

  if (digits.length < MIN_NATIONAL_DIGITS) return { changed: false, error: 'Enter a valid phone number' };
  if (digits.length > MAX_E164_DIGITS) return { changed: false, error: 'Phone number is too long' };
  return { changed: true, countryCode: null, phone: `+${digits}` };
}

module.exports = {
  DEFAULT_COUNTRY_CODE,
  MAX_E164_DIGITS,
  digitsOnly,
  normaliseCountryCode,
  normalisePhone,
};
