// What a render job reports when the preview browser dies under it (#2018). Playwright words a lost page or browser
// in several ways; the job failure names the frame, the size and the passes so the caller knows which limit to lower.
const BROWSER_LOSS_PATTERN = /target (page, context or browser )?(has been )?closed|(page|target|browser) (has )?crashed|browser has been closed|browser (has )?disconnected|connection closed|protocol error|session closed/i;

export function isBrowserLoss(error) {
  return BROWSER_LOSS_PATTERN.test(String(error?.message ?? error));
}

export function describeBrowserLoss({ error, frameIndex, frameCount, width, height, passes = [], memoryMiB }) {
  const where = frameIndex < 0
    ? 'before the first frame'
    : `while rendering ${frameCount > 1 ? 'still' : 'frame'} ${frameIndex + 1} of ${frameCount}`;
  const passNote = passes.length ? ` with ${passes.join(', ')} ${passes.length === 1 ? 'pass' : 'passes'}` : '';
  const cause = String(error?.message ?? error).split('\n')[0];
  return new Error(`The preview browser crashed ${where} at ${width}x${height}${passNote} (${cause}). Lower the size or the frame count, or raise --memory (now ${memoryMiB} MiB). The server is still running.`, { cause: error });
}
