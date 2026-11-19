function decodeHashPart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
}

/** The topic and section named by a docs hash; one bad escape only clears that part. */
export function parseDocumentationHash(hash) {
  const [topic = '', section = ''] = hash.replace(/^#/, '').split('/');
  return { topic: decodeHashPart(topic), section: decodeHashPart(section) };
}
