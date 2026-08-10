import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { listJarMetadata } from './jars.js';

const ENVIRONMENT_IDS = new Set(['minecraft', 'fabric', 'fabricloader', 'forge', 'neoforge', 'java', 'mixinextras']);

function normalizedVersion(value) {
  if (!value) return null;
  return semver.valid(value) || semver.valid(semver.coerce(String(value)));
}

function cleanRange(range) {
  return String(range)
    .replace(/(\d+\.\d+\.\d+)(?:\.\d+)+(?:\+[0-9A-Za-z.-]+)?/g, '$1')
    .replace(/(\d+\.\d+\.\d+)(?:\+[0-9A-Za-z.-]+)(?=\s|$)/g, '$1')
    .replace(/(\d+\.\d+\.\d+)-(?=\s|$)/g, '$1')
    .replace(/(\d+\.\d+)-(?=\s|$)/g, '$1');
}

function satisfiesOne(actual, range) {
  if (!range || range === '*' || range === 'any') return true;
  const version = normalizedVersion(actual);
  if (!version) return null;
  try {
    return semver.satisfies(version, cleanRange(range), { includePrerelease: true });
  } catch {
    return null;
  }
}

function satisfies(actual, range) {
  if (Array.isArray(range)) {
    const results = range.map((item) => satisfiesOne(actual, item));
    if (results.includes(true)) return true;
    if (results.every((result) => result === false)) return false;
    return null;
  }
  return satisfiesOne(actual, range);
}

function compareVersions(left, right) {
  const a = normalizedVersion(left);
  const b = normalizedVersion(right);
  if (a && b) return semver.rcompare(a, b);
  return String(right || '').localeCompare(String(left || ''), undefined, { numeric: true });
}

function collectRequirements(jars) {
  const requirements = new Map();
  for (const jar of jars) {
    for (const [dependency, range] of Object.entries(jar.depends || {})) {
      if (!requirements.has(dependency)) requirements.set(dependency, []);
      requirements.get(dependency).push(range);
    }
  }
  return requirements;
}

function declaredBreaks(candidate, jars) {
  const conflicts = [];
  for (const [dependency, range] of Object.entries(candidate.breaks || {})) {
    for (const jar of jars) {
      if (jar.id !== dependency || jar.id === candidate.id) continue;
      if (satisfies(jar.version, range) === true) conflicts.push(dependency);
    }
  }
  return conflicts;
}

function chooseActiveJars(jars) {
  const requirements = collectRequirements(jars);
  const groups = new Map();
  for (const jar of jars.filter((item) => item.id)) {
    if (!groups.has(jar.id)) groups.set(jar.id, []);
    groups.get(jar.id).push(jar);
  }

  const active = [];
  const shadowed = [];
  for (const [id, candidates] of groups) {
    if (candidates.length === 1) {
      active.push(candidates[0]);
      continue;
    }

    const ranges = requirements.get(id) || [];
    const compatible = candidates.filter((candidate) => ranges.every((range) => satisfies(candidate.version, range) !== false));
    const pool = compatible.length ? compatible : candidates;
    const ranked = [...pool].sort((left, right) => {
      const conflictDifference = declaredBreaks(left, jars).length - declaredBreaks(right, jars).length;
      return conflictDifference || compareVersions(left.version, right.version);
    });
    const selected = ranked[0];
    active.push(selected);
    for (const candidate of candidates) {
      if (candidate !== selected) shadowed.push({ selected, jar: candidate });
    }
  }

  return { active, shadowed };
}

function buildAvailableIndex(active) {
  const available = new Map();
  for (const jar of active) {
    available.set(jar.id, jar);
    for (const [provided, version] of Object.entries(jar.providedVersions || {})) {
      available.set(provided, { ...jar, id: provided, version });
    }
  }
  return available;
}

export async function readLaunchStatus(minecraftPath) {
  const logPath = path.join(minecraftPath, 'logs', 'latest.log');
  try {
    const log = await fs.readFile(logPath, 'utf8');
    if (/joined the game|logged in with entity id/i.test(log)) return { state: 'world', logPath };
    if (/Loading Minecraft|Setting user:/i.test(log)) return { state: 'started', logPath };
    return { state: 'unknown', logPath };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing', logPath };
    throw error;
  }
}

export async function checkMods({ modsPath, minecraftPath = path.dirname(modsPath), config }) {
  const jars = await listJarMetadata(modsPath);
  const errors = [];
  const warnings = [];
  const { active, shadowed } = chooseActiveJars(jars);
  const available = buildAvailableIndex(active);

  if (!config.minecraftVersion) warnings.push('Minecraft version is not set: run `mdd version 1.21.11`.');
  if (!config.loader) warnings.push('Loader is not set: run `mdd loader fabric`.');

  for (const item of shadowed) {
    warnings.push(`Duplicate ${item.jar.id}: using ${path.basename(item.selected.filePath)}, ignoring ${item.jar.fileName}.`);
  }

  for (const jar of active) {
    if (jar.type === 'invalid') errors.push(`${jar.fileName}: ${jar.error}`);
    if (jar.type === 'unknown') warnings.push(`${jar.fileName}: no fabric.mod.json or Forge/NeoForge metadata found, or the file is not a regular mod.`);
    if (jar.type === 'forge-like' && config.loader === 'fabric') errors.push(`${jar.fileName}: this is a Forge/NeoForge mod, but Fabric is selected.`);
  }

  for (const jar of active.filter((item) => item.id)) {
    for (const [dependency, range] of Object.entries(jar.depends || {})) {
      if (ENVIRONMENT_IDS.has(dependency)) {
        if (dependency === 'minecraft' && config.minecraftVersion) {
          const result = satisfies(config.minecraftVersion, range);
          if (result === false) errors.push(`${jar.id}: requires Minecraft ${range}, but ${config.minecraftVersion} is selected.`);
          if (result === null) warnings.push(`${jar.id}: could not parse Minecraft version range ${range}.`);
        }
        if (dependency === 'fabricloader' && config.loader && config.loader !== 'fabric') {
          errors.push(`${jar.id}: requires Fabric Loader, but ${config.loader} is selected.`);
        }
        continue;
      }

      const bundledFabricApi = dependency.startsWith('fabric-') && available.has('fabric-api');
      if (bundledFabricApi) continue;

      const installed = available.get(dependency);
      if (!installed) {
        errors.push(`${jar.id}: required dependency ${dependency} ${range} is missing.`);
        continue;
      }
      const result = satisfies(installed.version, range);
      if (result === false) errors.push(`${jar.id}: dependency ${dependency} ${range} does not match the installed version ${installed.version}.`);
      if (result === null) warnings.push(`${jar.id}: could not check dependency version ${dependency} ${range}.`);
    }

    for (const [dependency, range] of Object.entries(jar.breaks || {})) {
      const installed = available.get(dependency);
      if (!installed) continue;
      const result = satisfies(installed.version, range);
      if (result === true) errors.push(`${jar.id}: conflicts with ${dependency} ${range}.`);
    }
  }

  return {
    jars,
    active,
    shadowed,
    errors,
    warnings,
    launch: await readLaunchStatus(minecraftPath),
    ok: errors.length === 0
  };
}
