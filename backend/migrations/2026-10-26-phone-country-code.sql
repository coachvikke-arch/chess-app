-- Store the chosen dial code beside the phone and settle legacy values into the
-- combined E.164 shape the app now writes ("+919876543210").

ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code VARCHAR(8);

-- A bare 10-digit national number was always an Indian number in this academy.
UPDATE users
SET country_code = '+91',
    phone = '+91' || regexp_replace(phone, '\D', '', 'g')
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND phone !~ '^\+'
  AND length(regexp_replace(phone, '\D', '', 'g')) = 10;

-- Legacy values that already carried India's 91 prefix (with or without "+",
-- spaces or dashes): split it into country_code + national number.
UPDATE users
SET country_code = '+91',
    phone = '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND length(regexp_replace(phone, '\D', '', 'g')) = 12
  AND regexp_replace(phone, '\D', '', 'g') LIKE '91%';

-- Any other international value: keep the number, drop the separators. Its
-- country code is inferred on load when country_code is still NULL.
UPDATE users
SET phone = '+' || regexp_replace(phone, '\D', '', 'g')
WHERE phone ~ '^\+'
  AND length(regexp_replace(phone, '\D', '', 'g')) BETWEEN 4 AND 15
  AND phone <> '+' || regexp_replace(phone, '\D', '', 'g');

CREATE INDEX IF NOT EXISTS idx_users_country_code ON users (country_code);
