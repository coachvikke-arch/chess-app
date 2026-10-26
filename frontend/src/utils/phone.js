/*
 * Phone helpers shared by every form that edits a number.
 *
 * The stored value is a combined E.164 string ("+919876543210") and the user's
 * chosen dial code lives beside it in `country_code`. Legacy rows have no
 * country_code and may hold a bare 10-digit number or a leading "+", so every
 * load goes through splitPhone() instead of trusting the stored shape.
 */

import { COUNTRIES, DEFAULT_COUNTRY, countryByDial, countryByIso, matchDialPrefix } from '../data/countries';

export const DEFAULT_DIAL = countryByIso(DEFAULT_COUNTRY).dial;

/** Strip everything that is not a digit. */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Split any stored/typed phone value into { countryCode, phoneNumber }.
 *
 * Order of preference:
 *   1. an explicit saved country code, if the value carries it;
 *   2. a leading "+", matched against the dial-code list (longest wins);
 *   3. the saved/default country, treating the value as a national number.
 */
export function splitPhone(raw, savedCode) {
  const saved = countryByDial(savedCode);
  const fallback = saved || countryByIso(DEFAULT_COUNTRY);
  const text = String(raw ?? '').trim();
  const digits = digitsOnly(text);
  if (!digits) return { countryCode: fallback.dial, phoneNumber: '' };

  if (saved && digits.length > saved.max) {
    const code = saved.dial.slice(1);
    if (digits.startsWith(code)) {
      return {
        countryCode: saved.dial,
        phoneNumber: digits.slice(code.length, code.length + saved.max),
      };
    }
  }

  if (text.startsWith('+') || digits.length > fallback.max) {
    const match = matchDialPrefix(digits);
    if (match) {
      return {
        countryCode: match.dial,
        phoneNumber: digits.slice(match.dial.length - 1, match.dial.length - 1 + match.max),
      };
    }
  }

  return { countryCode: fallback.dial, phoneNumber: digits.slice(0, fallback.max) };
}

/** Combined E.164 string, or '' when there is no national number. */
export function toE164(countryCode, phoneNumber) {
  const dial = String(countryCode || DEFAULT_DIAL);
  const number = digitsOnly(phoneNumber);
  if (!number) return '';
  return `${dial}${number}`;
}

/** Human-readable form: "+91 98765 43210". Falls back to '' for no number. */
export function formatPhoneDisplay(raw, savedCode) {
  const { countryCode, phoneNumber } = splitPhone(raw, savedCode);
  if (!phoneNumber) return '';
  // India's 10-digit grouping is the one used throughout the app's copy.
  if (countryCode === '+91' && phoneNumber.length === 10) {
    return `${countryCode} ${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`;
  }
  return `${countryCode} ${phoneNumber}`;
}

/** Inline validation for the national part. Optional empty values are valid. */
export function validateNationalNumber(country, phoneNumber) {
  const digits = digitsOnly(phoneNumber);
  if (!digits) return '';
  if (digits.length < 4) return 'Enter a valid phone number.';
  const limit = country ? country.max : 15;
  if (digits.length > limit) return `Too many digits for ${country ? country.name : 'this country'} (max ${limit}).`;
  return '';
}

export { COUNTRIES };
