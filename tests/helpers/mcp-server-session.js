import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// The MCP server does not leave when its stdin closes while a render is winding down, so the SDK's client.close() waits two
// seconds, asks, waits two more and then kills it without waiting for the exit. On Windows a process that is still dying keeps
// its working directory open, and removing a temp folder right after close failed with EBUSY under load (#3116).
export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

const EXIT_TIMEOUT_MS = 20000;
const EXIT_POLL_MS = 50;

function processIsRunning(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Closes the client and returns only once the server process is gone. Call it with the transport the client connected over.
// A server that is still running after the timeout is killed by its own PID and reported, never ignored.
export async function closeClientAndWaitForServerExit(client, transport) {
  const serverProcessId = transport.pid;
  await client.close();
  if (serverProcessId === null) return;
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (processIsRunning(serverProcessId)) {
    if (Date.now() > deadline) {
      process.kill(serverProcessId, 'SIGKILL');
      throw new Error(`The MCP server (pid ${serverProcessId}) was still running ${EXIT_TIMEOUT_MS} ms after the client closed, so it was killed. Fix the server's shutdown instead of removing its folders while it runs.`);
    }
    await delay(EXIT_POLL_MS);
  }
}
