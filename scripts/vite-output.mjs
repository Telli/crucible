// Helpers for smoke scripts that start Vite as a child process and wait for its "Local: http://127.0.0.1:<port>" line.
// Vite bolds the port number when colour is forced, which breaks a plain substring match.

const ansiColourCodes = /\u001b\[[0-9;]*m/g;

// Environment for the Vite child: no colour codes, whatever the parent terminal or CI sets.
export function viteChildEnvironment(baseEnvironment = process.env) {
  return { ...baseEnvironment, FORCE_COLOR: '0', NO_COLOR: '1' };
}

// True when a chunk of Vite output names the local server address, with or without colour codes.
export function viteOutputMentionsAddress(chunk, address) {
  return chunk.toString().replace(ansiColourCodes, '').includes(address);
}
