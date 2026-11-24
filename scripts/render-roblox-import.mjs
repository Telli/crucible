// Imports a Roblox-style XML place, renders it in Crucible, and draws the same source parts in a separate diagram, side by side.
// Usage: node scripts/render-roblox-import.mjs <place.rbxlx> <output directory> [--size <width>x<height>]
// Writes <name>.png (the Crucible render), <name>-diagram.png (flat-shaded source parts seen from the Roblox camera, drawn from the
// raw XML numbers with its own small reader and projection, not from the importer), <name>-side-by-side.png and <name>.json (the
// recipe, camera, size and backend of the render). Run it through gpu-lock: it starts the MCP server and a headless Chrome render.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { importRoblox, STUD_METERS } from '../packages/roblox-import/index.mjs';

const serverEntry = new URL('../bin/crucible-mcp.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const SKY = '#cfd8e3';
const SPHERE_SEGMENTS = 28;
const SPHERE_RINGS = 14;
const CYLINDER_SEGMENTS = 28;

function parseArguments(argumentList) {
  const options = { file: null, directory: null, width: 1080, height: 1920 };
  for (let index = 0; index < argumentList.length; index++) {
    const argument = argumentList[index];
    if (argument === '--size') {
      const match = /^(\d+)x(\d+)$/.exec(argumentList[++index] ?? '');
      if (!match) throw new Error('Pass --size as <width>x<height>, for example --size 1080x1920.');
      options.width = Number(match[1]);
      options.height = Number(match[2]);
    } else if (!options.file) options.file = resolve(argument);
    else options.directory = resolve(argument);
  }
  if (!options.file || !options.directory) throw new Error('Usage: node scripts/render-roblox-import.mjs <place.rbxlx> <output directory> [--size WxH]');
  return options;
}

// ---------------------------------------------------------------- the diagram: its own reader for the fixture's few fields

function numbers(block, names) {
  return names.map(name => Number(new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)[1]));
}

function readSourceParts(xml) {
  const parts = [];
  const itemPattern = /<Item class="(Part|WedgePart)"[^>]*>([\s\S]*?)<\/Properties>/g;
  let match = itemPattern.exec(xml);
  while (match) {
    const body = match[2];
    const frameBlock = /<CoordinateFrame name="CFrame">([\s\S]*?)<\/CoordinateFrame>/.exec(body)[1];
    const packed = Number(/name="Color3uint8">(\d+)</.exec(body)[1]);
    const name = /<string name="Name">([^<]*)</.exec(body)[1];
    const shape = match[1] === 'WedgePart' ? 'wedge' : ['ball', 'block', 'cylinder'][Number(/name="shape">(\d)</.exec(body)?.[1] ?? 1)];
    const size = numbers(/<Vector3 name="size">([\s\S]*?)<\/Vector3>/.exec(body)[1], ['X', 'Y', 'Z']);
    const transparency = Number(/name="Transparency">([^<]*)</.exec(body)?.[1] ?? 0);
    parts.push({
      name, shape, size, transparency,
      position: numbers(frameBlock, ['X', 'Y', 'Z']),
      rotation: numbers(frameBlock, ['R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22']),
      color: [(packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255],
    });
    match = itemPattern.exec(xml);
  }
  const cameraBlock = /<Item class="Camera"[\s\S]*?<\/Properties>/.exec(xml)[0];
  const cameraFrame = /<CoordinateFrame name="CFrame">([\s\S]*?)<\/CoordinateFrame>/.exec(cameraBlock)[1];
  const camera = {
    position: numbers(cameraFrame, ['X', 'Y', 'Z']),
    rotation: numbers(cameraFrame, ['R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22']),
    fov: Number(/name="FieldOfView">([^<]*)</.exec(cameraBlock)[1]),
  };
  return { parts, camera };
}

function toWorld(part, local) {
  const { rotation, position } = part;
  return [0, 1, 2].map(row => rotation[row * 3] * local[0] + rotation[row * 3 + 1] * local[1] + rotation[row * 3 + 2] * local[2] + position[row]);
}

// Local-space triangles of a part, in studs, centred on the part. Each face is a list of corners.
function faces(part) {
  const [sx, sy, sz] = part.size.map(value => value / 2);
  if (part.shape === 'block') {
    const corner = (x, y, z) => [x * sx, y * sy, z * sz];
    return [
      [corner(-1, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(-1, 1, -1)],
      [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)],
      [corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1)],
      [corner(1, -1, -1), corner(1, -1, 1), corner(1, 1, 1), corner(1, 1, -1)],
      [corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1)],
      [corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)],
    ];
  }
  if (part.shape === 'wedge') {
    // Triangle in the Y-Z plane: floor along the whole depth, tall side at +Z (the back), slope rising toward the back.
    const front = [-sy, -sz];
    const point = (x, [y, z]) => [x, y, z];
    const bottomBack = [-sy, sz];
    const topBack = [sy, sz];
    return [
      [point(-sx, front), point(-sx, bottomBack), point(-sx, topBack)],
      [point(sx, front), point(sx, bottomBack), point(sx, topBack)],
      [point(-sx, front), point(sx, front), point(sx, bottomBack), point(-sx, bottomBack)],
      [point(-sx, bottomBack), point(sx, bottomBack), point(sx, topBack), point(-sx, topBack)],
      [point(-sx, front), point(sx, front), point(sx, topBack), point(-sx, topBack)],
    ];
  }
  const result = [];
  if (part.shape === 'ball') {
    const vertex = (ring, segment) => {
      const polar = (ring / SPHERE_RINGS) * Math.PI;
      const azimuth = (segment / SPHERE_SEGMENTS) * Math.PI * 2;
      return [sx * Math.sin(polar) * Math.cos(azimuth), sy * Math.cos(polar), sz * Math.sin(polar) * Math.sin(azimuth)];
    };
    for (let ring = 0; ring < SPHERE_RINGS; ring++) {
      for (let segment = 0; segment < SPHERE_SEGMENTS; segment++) {
        result.push([vertex(ring, segment), vertex(ring + 1, segment), vertex(ring + 1, segment + 1), vertex(ring, segment + 1)]);
      }
    }
    return result;
  }
  // Roblox cylinder: length along local X, diameter in Y and Z.
  const ringPoint = (end, segment) => {
    const angle = (segment / CYLINDER_SEGMENTS) * Math.PI * 2;
    return [end * sx, sy * Math.cos(angle), sz * Math.sin(angle)];
  };
  for (let segment = 0; segment < CYLINDER_SEGMENTS; segment++) {
    result.push([ringPoint(-1, segment), ringPoint(1, segment), ringPoint(1, segment + 1), ringPoint(-1, segment + 1)]);
  }
  result.push(Array.from({ length: CYLINDER_SEGMENTS }, (_, segment) => ringPoint(-1, segment)));
  result.push(Array.from({ length: CYLINDER_SEGMENTS }, (_, segment) => ringPoint(1, segment)));
  return result;
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function cross(left, right) {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}

function drawDiagram(source, width, height) {
  const { camera } = source;
  const axes = [0, 1, 2].map(column => [camera.rotation[column], camera.rotation[3 + column], camera.rotation[6 + column]]);
  const [right, up, back] = axes;
  const focal = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const project = world => {
    const relative = subtract(world, camera.position);
    const depth = -dot(relative, back);
    return { x: width / 2 + (dot(relative, right) / depth) * focal, y: height / 2 - (dot(relative, up) / depth) * focal, depth };
  };
  const toward = normalize([-0.4, 1, 0.5]);
  const polygons = [];
  source.parts.forEach((part, index) => {
    for (const face of faces(part)) {
      const world = face.map(corner => toWorld(part, corner));
      const center = world.reduce((sum, corner) => sum.map((value, axis) => value + corner[axis] / world.length), [0, 0, 0]);
      let normal = normalize(cross(subtract(world[1], world[0]), subtract(world[2], world[0])));
      // A point inside the solid; the centre of a wedge lies on its slope, so use the centre of its triangle instead.
      const partCenter = part.shape === 'wedge' ? toWorld(part, [0, -part.size[1] / 6, part.size[2] / 6]) : part.position;
      if (dot(normal, subtract(center, partCenter)) < 0) normal = normal.map(value => -value);
      if (part.transparency === 0 && dot(normal, subtract(camera.position, center)) <= 0) continue;
      const shade = 0.5 + 0.5 * Math.max(0, dot(normal, toward));
      const points = world.map(project);
      if (points.some(point => point.depth <= 0.1)) continue;
      polygons.push({
        depth: Math.hypot(...subtract(center, camera.position)), points, index, transparency: part.transparency,
        fill: part.color.map(channel => Math.round(Math.min(255, channel * shade))),
      });
    }
  });
  // The ground is one huge quad whose centre is nearer than far parts, so it is always drawn first.
  polygons.sort((first, second) => (first.index === 0 ? -1 : second.index === 0 ? 1 : second.depth - first.depth));
  const shapes = polygons.map(polygon => {
    const points = polygon.points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const stroke = polygon.fill.map(channel => Math.round(channel * 0.8)).join(',');
    return `<polygon points="${points}" fill="rgb(${polygon.fill.join(',')})" fill-opacity="${1 - polygon.transparency}" stroke="rgb(${stroke})" stroke-width="1" stroke-linejoin="round"/>`;
  });
  const labels = source.parts.map((part, index) => {
    const point = project(part.position);
    return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="17" fill="#ffffff" fill-opacity="0.9"/>`
      + `<text x="${point.x.toFixed(1)}" y="${(point.y + 7).toFixed(1)}" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#1b1f24">${index + 1}</text>`;
  });
  const legendLines = source.parts.map((part, index) => `<text x="40" y="${height - 40 - (source.parts.length - 1 - index) * 30}" font-family="Arial, sans-serif" font-size="22" fill="#1b1f24">${index + 1}  ${part.name} (${part.shape}, ${part.size.join(' x ')} studs)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${SKY}"/>${shapes.join('')}${labels.join('')}${legendLines.join('')}</svg>`;
}

// ---------------------------------------------------------------- the render, through the MCP render job tools

async function renderJob(call, sessionId, settings) {
  const submitted = await call('scene_render_submit', { sessionId, expectedRevision: 0, settings });
  if (submitted.isError) throw new Error(submitted.content?.[0]?.text);
  const { jobId } = submitted.structuredContent;
  for (;;) {
    const record = (await call('scene_render_status', { jobId })).structuredContent;
    if (record.state === 'completed') break;
    if (['cancelled', 'failed'].includes(record.state)) throw new Error(`Render job ${record.state}: ${record.reason}`);
    await delay(250);
  }
  const result = (await call('scene_render_result', { jobId })).structuredContent;
  return result.artifacts[0].path;
}

async function renderRecipe(recipe, width, height, outputPath) {
  if (!existsSync(new URL('../build/mcp/server.mjs', import.meta.url))) throw new Error('Run npm run build and node scripts/build-mcp.mjs first: the MCP server is not built.');
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, '--jobs', join(tmpdir(), `crucible-roblox-${process.pid}`)], stderr: 'ignore' });
  const client = new Client({ name: 'render-roblox-import', version: '1.0.0' });
  await client.connect(transport);
  try {
    const call = (name, toolArguments) => client.callTool({ name, arguments: toolArguments }, { timeout: 600000 });
    const created = await call('scene_create', { recipe });
    if (created.isError) throw new Error(created.content?.[0]?.text);
    const { sessionId } = created.structuredContent;
    const artifact = await renderJob(call, sessionId, { kind: 'image', width, height });
    await copyFile(artifact, outputPath);
    await call('scene_dispose', { sessionId });
  } finally {
    await client.close();
  }
}

async function caption(text, width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="56"><rect width="${width}" height="56" fill="#1b1f24"/><text x="24" y="37" font-family="Arial, sans-serif" font-size="26" fill="#ffffff">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(options.directory, { recursive: true });
  const name = basename(options.file).replace(/\.[^.]+$/, '');
  const xml = await readFile(options.file, 'utf8');
  const result = importRoblox(xml);
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  const renderPath = join(options.directory, `${name}.png`);
  await renderRecipe(result.recipe, options.width, options.height, renderPath);
  const diagramPath = join(options.directory, `${name}-diagram.png`);
  await sharp(Buffer.from(drawDiagram(readSourceParts(xml), options.width, options.height))).png().toFile(diagramPath);
  const bar = 56;
  const sideBySide = join(options.directory, `${name}-side-by-side.png`);
  await sharp({ create: { width: options.width * 2, height: options.height + bar, channels: 3, background: '#1b1f24' } })
    .composite([
      { input: await caption('Source parts drawn from the Roblox XML', options.width), left: 0, top: 0 },
      { input: await caption('Imported into Crucible and rendered', options.width), left: options.width, top: 0 },
      { input: diagramPath, left: 0, top: bar },
      { input: renderPath, left: options.width, top: bar },
    ]).png().toFile(sideBySide);
  await writeFile(join(options.directory, `${name}.json`), `${JSON.stringify({
    source: basename(options.file), studMeters: STUD_METERS, size: [options.width, options.height], backend: 'crucible MCP render job, kind image, default quality',
    camera: result.recipe.camera, environment: result.recipe.environment, recipe: result.recipe,
  }, null, 2)}\n`);
  console.log(`wrote ${renderPath}, ${diagramPath}, ${sideBySide}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
