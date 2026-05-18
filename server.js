// Compatibility launcher: keep `node server.js` working from the repo root,
// but run the real Denizen server so /api/health, /api/stt, and
// LM Studio diagnostics are available.
console.log('[root-server] delegating to denizen/server.js');
require('./denizen/server.js');
