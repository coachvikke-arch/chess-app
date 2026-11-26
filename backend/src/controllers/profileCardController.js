const crypto = require('crypto');
const db = require('../config/database');
const { fetchProfile } = require('../services/profileService');

function newToken() {
  /* 128 bits from the CSPRNG → 32 hex chars, well above the 16-char floor. */
  return crypto.randomBytes(16).toString('hex');
}

/* Issues a fresh share token. The old QR stops resolving the moment this lands,
   because the public endpoint looks users up by token. */
exports.regenerate = async (req, res) => {
  try {
    await db.query('UPDATE users SET public_token = $1, updated_at = NOW() WHERE id = $2', [newToken(), req.user.id]);
    const user = await fetchProfile(req.user.id);
    res.json({ user });
  } catch (err) {
    console.error('Regenerate card token failed:', err.message);
    res.status(500).json({ message: 'Could not regenerate the QR code' });
  }
};

/* Public on/off switch for the gold card. Off answers 404 to every scan. */
exports.updateVisibility = async (req, res) => {
  try {
    const { cardPublic } = req.body;
    if (typeof cardPublic !== 'boolean') {
      return res.status(400).json({ message: 'cardPublic must be true or false' });
    }
    await db.query('UPDATE users SET card_public = $1, updated_at = NOW() WHERE id = $2', [cardPublic, req.user.id]);
    const user = await fetchProfile(req.user.id);
    res.json({ user });
  } catch (err) {
    console.error('Update card visibility failed:', err.message);
    res.status(500).json({ message: 'Could not update the card visibility' });
  }
};
