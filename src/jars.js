import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

function repairControlCharactersInStrings(value) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (!inString) {
      output += character;
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      output += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      output += character;
      inString = false;
      continue;
    }
    if (character === '\n') output += '\\n';
    else if (character === '\r') output += '\\r';
    else if (character === '\t') output += '\\t';
    else output += character;
  }
  return output;
}

function jsonEntry(files, name) {
  if (!files[name]) return null;
  const source = strFromU8(files[name]);
  try {
    return JSON.parse(source);
  } catch {
    try {
      return JSON.parse(repairControlCharactersInStrings(source));
    } catch {
      return null;
    }
  }
}

function providedMetadata(files, metadata) {
  const provided = {};
  for (const id of Array.isArray(metadata.provides) ? metadata.provides : []) provided[id] = String(metadata.version || 'unknown');
  for (const nested of Array.isArray(metadata.jars) ? metadata.jars : []) {
    if (!nested?.file || !files[nested.file]) continue;
    try {
      const nestedFiles = unzipSync(files[nested.file]);
      const nestedMetadata = jsonEntry(nestedFiles, 'fabric.mod.json');
      if (nestedMetadata?.id) provided[nestedMetadata.id] = String(nestedMetadata.version || 'unknown');
      for (const id of nestedMetadata?.provides || []) provided[id] = String(nestedMetadata.version || 'unknown');
    } catch {
      // A nested library is optional for static metadata parsing.
    }
  }
  return provided;
}

export async function readJarMetadata(filePath) {
  const fileName = path.basename(filePath);
  const bytes = await fs.readFile(filePath);
  let files;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    return { filePath, fileName, type: 'invalid', error: `archive is corrupted: ${error.message}` };
  }

  const fabric = jsonEntry(files, 'fabric.mod.json');
  if (fabric) {
    return {
      filePath,
      fileName,
      type: 'fabric',
      id: fabric.id || null,
      name: fabric.name || fabric.id || fileName,
      version: String(fabric.version || 'unknown'),
      depends: fabric.depends || {},
      breaks: fabric.breaks || {},
      providedVersions: providedMetadata(files, fabric)
    };
  }

  if (files['META-INF/mods.toml'] || files['mcmod.info']) {
    return { filePath, fileName, type: 'forge-like', id: null, name: fileName, version: 'unknown', depends: {}, breaks: {} };
  }

  return { filePath, fileName, type: 'unknown', id: null, name: fileName, version: 'unknown', depends: {}, breaks: {} };
}

export async function listJarMetadata(modsPath) {
  let entries;
  try {
    entries = await fs.readdir(modsPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const jars = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'));
  return Promise.all(jars.map((entry) => readJarMetadata(path.join(modsPath, entry.name))));
}
