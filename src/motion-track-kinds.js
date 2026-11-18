// The kinds a motion track may have, in a leaf module so the MCP server can import the list without bundling the motion code.
// tests/mcp-recipe-round-trip.test.js checks it equals MOTION_TRACK_KINDS of src/agent-motion.js.
export const MOTION_TRACK_KIND_NAMES = Object.freeze(['node', 'material', 'camera', 'morph', 'geometry', 'light', 'sun', 'environment', 'effects']);
