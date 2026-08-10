import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { checkMods } from '../src/check.js';

const config = { minecraftVersion: '1.21.11', loader: 'fabric' };

function jar(metadata, nested = {}) {
  const files = { 'fabric.mod.json': strToU8(JSON.stringify(metadata)) };
  for (const [name, nestedMetadata] of Object.entries(nested)) {
    files[name] = zipSync({ 'fabric.mod.json': strToU8(JSON.stringify(nestedMetadata)) });
  }
  return zipSync(files);
}

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdd-check-'));
  const mods = path.join(root, 'mods');
  await fs.mkdir(mods);
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(mods, name), bytes);
  return { root, mods };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

test('resolves a provided dependency alias', async () => {
  const fixtureData = await fixture({
    'balm.jar': jar({ id: 'balm', version: '21.11.9.1', provides: ['balm-fabric'] }),
    'crafting.jar': jar({ id: 'craftingtweaks', version: '21.11.5', depends: { 'balm-fabric': '>=21.11.2' } })
  });
  try {
    const report = await checkMods({ modsPath: fixtureData.mods, config });
    assert.equal(report.errors.length, 0);
  } finally {
    await cleanup(fixtureData.root);
  }
});

test('reads dependencies from nested Fabric jars', async () => {
  const fixtureData = await fixture({
    'presence.jar': jar({
      id: 'presencefootsteps',
      version: '1.12.4+1.21.11',
      depends: { kirin: '>=1.21.4+1.21.11' },
      jars: [{ file: 'META-INF/jars/kirin.jar' }]
    }, {
      'META-INF/jars/kirin.jar': { id: 'kirin', version: '1.21.4+1.21.11' }
    })
  });
  try {
    const report = await checkMods({ modsPath: fixtureData.mods, config });
    assert.equal(report.errors.length, 0);
  } finally {
    await cleanup(fixtureData.root);
  }
});

test('selects the dependency-compatible duplicate', async () => {
  const fixtureData = await fixture({
    'iris.jar': jar({ id: 'iris', version: '1.10.7', depends: { sodium: ['0.8.x'] } }),
    'sodium-new.jar': jar({ id: 'sodium', version: '0.8.13', breaks: { iris: '<=1.10.7' } }),
    'sodium-compatible.jar': jar({ id: 'sodium', version: '0.8.7', breaks: { iris: '<=1.10.5' } })
  });
  try {
    const report = await checkMods({ modsPath: fixtureData.mods, config });
    assert.equal(report.errors.length, 0);
    assert.equal(report.shadowed.length, 1);
    assert.equal(report.active.find((item) => item.id === 'sodium').version, '0.8.7');
  } finally {
    await cleanup(fixtureData.root);
  }
});

test('accepts Minecraft ranges with a trailing dash', async () => {
  const fixtureData = await fixture({
    'architectury.jar': jar({ id: 'architectury', version: '19.0.1' }),
    'rei.jar': jar({ id: 'roughlyenoughitems', version: '21.11.816', depends: { minecraft: '~1.21-', architectury: '>=15.0.2' } })
  });
  try {
    const report = await checkMods({ modsPath: fixtureData.mods, config });
    assert.equal(report.errors.length, 0);
  } finally {
    await cleanup(fixtureData.root);
  }
});
