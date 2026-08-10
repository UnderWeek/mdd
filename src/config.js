import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  minecraftVersion: null,
  loader: null,
  loaderVersion: null
};

export function appDataDir() {
  return process.env.APPDATA || path.join(process.env.HOME || process.cwd(), 'AppData', 'Roaming');
}

export function minecraftDir(override) {
  return path.resolve(override || process.env.MDD_MINECRAFT_DIR || path.join(appDataDir(), '.minecraft'));
}

export function modsDir(override) {
  return path.join(minecraftDir(override), 'mods');
}

function configPath() {
  return path.join(appDataDir(), '.mdd', 'config.json');
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { ...DEFAULTS };
  }
}

export async function saveConfig(next) {
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify({ ...DEFAULTS, ...next }, null, 2)}\n`, 'utf8');
}

export function configFile() {
  return configPath();
}
