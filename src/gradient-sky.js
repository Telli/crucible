import { createEnvironmentMap } from './environment.js';

// environment.sky { type: 'gradient' }: a sky whose colours are picked, not computed. Stops run from the horizon (at 0) to the
// zenith (at 1) by elevation angle, and an optional glow band hugs the horizon. The same colours feed the background, the
// environment map that lights the scene and the water reflection, so the three always agree. The sun, the key light and the
// haze stay as the lighting setup or the recipe set them.

export const GRADIENT_SKY_FIELDS = Object.freeze(['type', 'stops', 'horizonGlow']);
export const HORIZON_GLOW_FIELDS = Object.freeze(['color', 'width', 'intensity']);
export const MAXIMUM_GRADIENT_STOPS = 8;

const GLOW_DEFAULTS = Object.freeze({ width: 6, intensity: 1 });
// intensity multiplies the glow colour at the horizon: 1 shows the colour itself, above 1 pushes it brighter.
const GLOW_LIMITS = Object.freeze({
  width: [0.5, 45, 'the glow half width in degrees of elevation, such as 6'],
  intensity: [0, 20, 'a multiplier of the glow colour from 0 to 20, 1 shows the colour as given, such as 1.5'],
});
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_EXAMPLE = 'a hex colour such as "#0e5d73"';
const MAP_WIDTH = 1024;
const MAP_HEIGHT = 512;

function checkedColor(value, field, fail) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw fail(field, value, COLOR_EXAMPLE);
  }
  return value.toLowerCase();
}

function resolveStops(stops, fail) {
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > MAXIMUM_GRADIENT_STOPS) {
    throw fail('environment.sky.stops', stops, `a list of 1 to ${MAXIMUM_GRADIENT_STOPS} stops, such as [{ "at": 0, "color": "#1a8a9c" }, { "at": 1, "color": "#0e5d73" }]`);
  }
  let previousAt = -Infinity;
  return stops.map((stop, index) => {
    const field = `environment.sky.stops[${index}]`;
    const unknown = stop && typeof stop === 'object' ? Object.keys(stop).find(key => key !== 'at' && key !== 'color') : 'stop';
    if (unknown !== undefined) {
      throw fail(field, unknown === 'stop' ? stop : unknown, 'an object with at (0 at the horizon to 1 at the zenith) and color');
    }
    if (!Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1 || stop.at <= previousAt) {
      throw fail(`${field}.at`, stop.at, 'a number from 0 (horizon) to 1 (zenith), larger than the stop before it');
    }
    previousAt = stop.at;
    return { at: stop.at, color: checkedColor(stop.color, `${field}.color`, fail) };
  });
}

function resolveHorizonGlow(glow, fail) {
  if (!glow || typeof glow !== 'object' || Array.isArray(glow)) {
    throw fail('environment.sky.horizonGlow', glow, `an object with color (${COLOR_EXAMPLE}), width and intensity`);
  }
  const unknown = Object.keys(glow).find(key => !HORIZON_GLOW_FIELDS.includes(key));
  if (unknown !== undefined) {
    throw fail('environment.sky.horizonGlow', unknown, `the fields ${HORIZON_GLOW_FIELDS.join(', ')}`);
  }
  const resolved = { color: checkedColor(glow.color, 'environment.sky.horizonGlow.color', fail) };
  for (const [field, [minimum, maximum, example]] of Object.entries(GLOW_LIMITS)) {
    const value = glow[field] ?? GLOW_DEFAULTS[field];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw fail(`environment.sky.horizonGlow.${field}`, value, `a number from ${minimum} to ${maximum}, ${example}`);
    }
    resolved[field] = value;
  }
  return resolved;
}

/** Checks and normalizes a gradient sky; `fail` builds the error for a field, a value and what is accepted. */
export function resolveGradientSky(input, fail) {
  const unknown = Object.keys(input).find(key => !GRADIENT_SKY_FIELDS.includes(key));
  if (unknown !== undefined) {
    throw fail('environment.sky', unknown, `type 'gradient' with fields ${GRADIENT_SKY_FIELDS.slice(1).join(', ')}`);
  }
  const resolved = { type: 'gradient', stops: resolveStops(input.stops, fail) };
  if (input.horizonGlow !== undefined && input.horizonGlow !== null) {
    resolved.horizonGlow = resolveHorizonGlow(input.horizonGlow, fail);
  }
  return resolved;
}

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function linearColorFromHex(hex) {
  return [1, 3, 5].map(offset => srgbChannelToLinear(parseInt(hex.slice(offset, offset + 2), 16) / 255));
}

/** The recipe fields a gradient implies: the legacy sky colours that fog and the probe trace read. */
export function gradientSkyFields(sky) {
  const horizon = linearColorFromHex(sky.stops[0].color);
  const zenith = linearColorFromHex(sky.stops[sky.stops.length - 1].color);
  return { skyTop: zenith, skyBottom: horizon, fogColor: horizon };
}

/** A gradient sky leaves the sun alone and only supplies the sky colours. */
export function applyGradientSky(input, environment, fail) {
  const sky = resolveGradientSky(input, fail);
  Object.assign(environment, gradientSkyFields(sky), { sky });
}

function stopColorsInLinear(sky) {
  return sky.stops.map(stop => ({ at: stop.at, color: linearColorFromHex(stop.color) }));
}

function colorAtHeight(stops, height) {
  if (height <= stops[0].at) {
    return stops[0].color;
  }
  for (let index = 1; index < stops.length; index++) {
    if (height <= stops[index].at) {
      const share = (height - stops[index - 1].at) / (stops[index].at - stops[index - 1].at);
      return stops[index - 1].color.map((component, channel) => component + (stops[index].color[channel] - component) * share);
    }
  }
  return stops[stops.length - 1].color;
}

function buildMapData(sky) {
  const stops = stopColorsInLinear(sky);
  const glow = sky.horizonGlow;
  const glowColor = glow ? linearColorFromHex(glow.color) : null;
  const data = new Float32Array(MAP_WIDTH * MAP_HEIGHT * 3);
  for (let row = 0; row < MAP_HEIGHT; row++) {
    // Each row is one elevation: the gradient and the glow depend on the angle above the horizon only.
    const elevation = 90 - ((row + 0.5) / MAP_HEIGHT) * 180;
    const base = colorAtHeight(stops, Math.max(0, elevation) / 90);
    const glowShare = glow ? Math.exp(-((elevation / glow.width) ** 2)) : 0;
    for (let column = 0; column < MAP_WIDTH; column++) {
      const offset = (row * MAP_WIDTH + column) * 3;
      for (let channel = 0; channel < 3; channel++) {
        // The band blends toward the glow colour instead of adding it, so it keeps its hue as it brightens and never washes to white.
        data[offset + channel] = glowColor ? base[channel] + (glowColor[channel] * glow.intensity - base[channel]) * glowShare : base[channel];
      }
    }
  }
  return data;
}

const mapsByKey = new Map();
const MAXIMUM_CACHED_MAPS = 8;

/** The environment map of a gradient sky; the same object returns while sky, strength, rotation and background hold. */
export function createGradientSkyMap({ sky, environmentIntensity: intensity, environmentRotation: rotation, world: showBackground }) {
  const key = JSON.stringify([sky, intensity, rotation, showBackground]);
  if (!mapsByKey.has(key)) {
    if (mapsByKey.size >= MAXIMUM_CACHED_MAPS) {
      mapsByKey.clear();
    }
    mapsByKey.set(key, createEnvironmentMap({ width: MAP_WIDTH, height: MAP_HEIGHT, data: buildMapData(sky), intensity, rotation, showBackground }));
  }
  return mapsByKey.get(key);
}
