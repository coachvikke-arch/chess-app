-- Per-user custom board square colors. NULL means the selected board theme
-- supplies its own palette.
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_light_color VARCHAR(7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS board_dark_color VARCHAR(7);
