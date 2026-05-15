// Compatibility launcher: keep `node server.js` working from the repo root,
// but run the real Pixel Office server so /api/health, /api/stt, and
// LM Studio diagnostics are available.
console.log('[root-server] delegating to pixel-office-game/server.js');
require('./pixel-office-game/server.js');
