import { describeReceived } from '../src/field-error.js';

const MAXIMUM_NAMED_KEYS = 6;
const CAPABILITIES_TOPIC_PATTERN = /scene_capabilities [A-Za-z]+/;

function withArticle(noun) {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function describeLiteralValues(values) {
  return values.map((value) => (typeof value === 'string' ? `"${value}"` : String(value)));
}

// One accepted shape of a union as a short phrase. Returns undefined for a schema this does not know, and the caller
// then leaves the message as the schema library words it. Literal options come back as { literals } so that several
// of them read as one list ("256, 512 or 1024").
function describeOption(option) {
  const definition = option?.def;
  switch (definition?.type) {
    case 'literal':
      return { literals: describeLiteralValues(definition.values) };
    case 'enum':
      return { literals: describeLiteralValues(Object.values(definition.entries)) };
    case 'number':
    case 'int':
      return { phrase: 'a number' };
    case 'string':
      return { phrase: 'a string' };
    case 'boolean':
      return { phrase: 'a boolean' };
    case 'null':
      return { phrase: 'null' };
    case 'record':
      return { phrase: 'an object' };
    case 'array':
      return { phrase: 'an array' };
    case 'tuple':
      return { phrase: describeTuple(definition.items) };
    case 'object':
      return { phrase: describeObject(definition.shape) };
    case 'optional':
    case 'nullable':
    case 'default':
      return describeOption(definition.innerType);
    default:
      return undefined;
  }
}

function describeTuple(items) {
  const itemTypes = new Set(items.map((item) => item?.def?.type));
  if (itemTypes.size === 1 && itemTypes.has('number')) {
    return `an array of ${items.length} numbers`;
  }
  return `an array of ${items.length} items`;
}

function describeObject(shape) {
  const keys = Object.keys(shape ?? {});
  if (keys.length === 0 || keys.length > MAXIMUM_NAMED_KEYS) {
    return 'an object';
  }
  return `an object with ${keys.join(', ')}`;
}

function joinWithOr(parts) {
  if (parts.length <= 1) {
    return parts.join('');
  }
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

function describeAcceptedShapes(options) {
  const literals = [];
  const phrases = [];
  for (const option of options) {
    const described = describeOption(option);
    if (!described) {
      return undefined;
    }
    if (described.literals) {
      literals.push(...described.literals);
    } else if (!phrases.includes(described.phrase)) {
      phrases.push(described.phrase);
    }
  }
  const parts = [...phrases];
  if (literals.length > 0) {
    parts.push(joinWithOr(literals));
  }
  return joinWithOr(parts);
}

// A branch "got further" when it matched the kind of value and failed deeper (a wrong length, a field inside the
// object), not when it only said the value is the wrong kind.
function branchGotFurther(branchIssues) {
  return branchIssues.length > 0 && branchIssues.some((inner) => !((inner.code === 'invalid_type' || inner.code === 'invalid_value') && inner.path.length === 0));
}

function describeClosestBranch(branches) {
  const furtherBranches = branches.filter(branchGotFurther);
  if (furtherBranches.length !== 1) {
    return '';
  }
  const inner = furtherBranches[0].find((candidate) => candidate.message);
  if (!inner) {
    return '';
  }
  const location = inner.path.length > 0 ? `${inner.path.join('.')}: ` : '';
  return `; closest shape: ${location}${inner.message}`;
}

// Words an invalid_union issue (a field built with z.union of plain options) as "Invalid input: expected <shapes>
// (got <value>)", with the one branch that matched the value's kind named when there is exactly one, and a pointer to
// the capabilities topic when the field's description names one. Returns undefined when the issue is not a union this
// can describe, so the library's own wording stays for everything else.
export function describeUnionIssue(issue) {
  if (issue.code !== 'invalid_union' || issue.discriminator !== undefined || !Array.isArray(issue.errors)) {
    return undefined;
  }
  const options = issue.inst?.def?.options ?? issue.inst?.options;
  if (!Array.isArray(options) || options.length === 0) {
    return undefined;
  }
  const accepted = describeAcceptedShapes(options);
  if (!accepted) {
    return undefined;
  }
  const topic = CAPABILITIES_TOPIC_PATTERN.exec(issue.inst?.description ?? '')?.[0];
  const pointer = topic ? `; see ${topic}` : '';
  const received = Object.hasOwn(issue, 'input') ? ` (got ${describeReceived(issue.input)})` : '';
  return `Invalid input: expected ${accepted}${received}${describeClosestBranch(issue.errors)}${pointer}`;
}
