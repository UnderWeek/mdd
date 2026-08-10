#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { loadConfig, saveConfig, minecraftDir, modsDir, configFile } from './config.js';
import {
  searchProjects,
  getVersion,
  resolveProject,
  resolveProjectVersion,
  downloadFile
} from './modrinth.js';
import { listJarMetadata, readJarMetadata } from './jars.js';
import { checkMods } from './check.js';

function parseArgs(argv) {
  const positional = [];
  const options = { dependencies: true, json: false, plain: false, strict: false, yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--no-dependencies') options.dependencies = false;
    else if (token === '--json') options.json = true;
    else if (token === '--plain') options.plain = true;
    else if (token === '--strict') options.strict = true;
    else if (token === '--yes') options.yes = true;
    else if (token === '--limit' || token === '--minecraft-dir') options[token.slice(2)] = argv[++index];
    else if (token.startsWith('--') && token.includes('=')) {
      const [key, value] = token.slice(2).split(/=(.*)/s);
      options[key] = value;
    } else positional.push(token);
  }
  return { positional, options };
}

function printJson(value, enabled) {
  if (enabled) console.log(JSON.stringify(value, null, 2));
}

function text(value) {
  return String(value || '').trim();
}

function shorten(value, maxLength) {
  const normalized = text(value).replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function printSearchTable(items) {
  const rows = items.map((item, index) => [
    String(index + 1),
    shorten(item.title, 28),
    shorten(item.slug, 24),
    item.project_id || '',
    shorten(item.description, 54)
  ]);
  const headers = ['#', 'NAME', 'SLUG', 'ID', 'DESCRIPTION'];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const gap = '  ';
  const formatRow = (row) => row.map((value, index) => value.padEnd(widths[index])).join(gap).trimEnd();
  console.log(formatRow(headers));
  for (const row of rows) console.log(formatRow(row));
}

async function interactiveSelect(items, {
  heading,
  getName,
  getSecondary,
  getDetails,
  getAfterSelect,
  searchable = false,
  getSearchText = (item) => `${getName(item)} ${getSecondary(item)}`
}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  return new Promise((resolve) => {
    let selected = 0;
    let windowStart = 0;
    let searchMode = false;
    let searchQuery = '';
    let finished = false;
    const previousRawMode = process.stdin.isRaw;
    const pageSize = 8;

    const visibleItems = () => {
      const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
      if (!searchMode || !normalizedQuery) return items;
      return items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(normalizedQuery));
    };

    const keepSelectedVisible = (activeItems) => {
      if (!activeItems.length) {
        selected = 0;
        windowStart = 0;
        return;
      }
      if (selected >= activeItems.length) selected = activeItems.length - 1;
      windowStart = Math.floor(selected / pageSize) * pageSize;
    };

    const cleanup = () => {
      if (finished) return;
      finished = true;
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode?.(Boolean(previousRawMode));
      process.stdin.pause();
      process.stdout.write('\x1b[0m\n');
    };

    const render = () => {
      const activeItems = visibleItems();
      keepSelectedVisible(activeItems);
      const item = activeItems[selected];
      process.stdout.write('\x1b[2J\x1b[H');
      console.log(heading);
      console.log(searchMode
        ? `Search: /${searchQuery}`
        : `Use Up/Down to select, Enter to choose${searchable ? ', / to search' : ''}, Q to exit.`);
      if (searchMode) console.log('Esc: clear search and return to the full list.');
      console.log('');
      const windowEnd = Math.min(windowStart + pageSize, activeItems.length);
      for (let index = windowStart; index < windowEnd; index += 1) {
        const result = activeItems[index];
        const marker = index === selected ? '>' : ' ';
        console.log(`${marker} ${getName(result)}  [${getSecondary(result)}]`);
      }
      if (!activeItems.length) console.log(searchMode ? 'No matching mods.' : 'No items.');
      const totalPages = Math.max(1, Math.ceil(activeItems.length / pageSize));
      const currentPage = Math.floor(windowStart / pageSize) + 1;
      console.log(`\nPage ${currentPage} / ${totalPages}`);
      console.log('\n' + '-'.repeat(78));
      if (item) {
        for (const detail of getDetails(item)) {
          console.log(`${detail.label}:`);
          console.log(detail.value || '(none)');
        }
      }
    };

    const chooseSelected = (activeItems) => {
      if (!activeItems.length) return;
      const item = activeItems[selected];
      cleanup();
      console.log(`Selected: ${getName(item)}`);
      if (getAfterSelect) console.log(getAfterSelect(item));
      resolve(item);
    };

    const onKeypress = (input, key) => {
      const activeItems = visibleItems();
      const character = typeof input === 'string' ? input : '';

      if (searchMode) {
        if (key.name === 'escape') {
          searchMode = false;
          searchQuery = '';
          selected = 0;
          windowStart = 0;
          render();
          return;
        }
        if (key.name === 'backspace') {
          searchQuery = searchQuery.slice(0, -1);
          selected = 0;
          windowStart = 0;
        } else if (key.name === 'up' && activeItems.length) {
          selected = (selected - 1 + activeItems.length) % activeItems.length;
        } else if (key.name === 'down' && activeItems.length) {
          selected = (selected + 1) % activeItems.length;
        } else if (key.name === 'return') {
          chooseSelected(activeItems);
          return;
        } else if (!key.ctrl && !key.meta && character.length === 1 && character >= ' ') {
          searchQuery += character;
          selected = 0;
          windowStart = 0;
        }
        keepSelectedVisible(visibleItems());
        render();
        return;
      }

      if (searchable && (character === '/' || key.sequence === '/')) {
        searchMode = true;
        searchQuery = '';
        selected = 0;
        windowStart = 0;
        render();
        return;
      }

      if (key.name === 'up' && activeItems.length) selected = (selected - 1 + activeItems.length) % activeItems.length;
      else if (key.name === 'down' && activeItems.length) selected = (selected + 1) % activeItems.length;
      else if (key.name === 'return') {
        chooseSelected(activeItems);
        return;
      } else if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(null);
        return;
      }
      keepSelectedVisible(activeItems);
      render();
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKeypress);
    render();
  });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha512(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

async function backupIfPresent(destination, modsPath) {
  try {
    await fs.access(destination);
  } catch {
    return null;
  }
  const backupDir = path.join(modsPath, '.mdd-backup');
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backup = path.join(backupDir, `${path.basename(destination)}.${stamp}.bak`);
  await fs.copyFile(destination, backup);
  return backup;
}

function fileBusyError(filePath) {
  return new Error(`File is in use by another program: ${filePath}. Close Minecraft and run the command again.`);
}

async function replaceExistingModJars(modId, destination, modsPath) {
  if (!modId) return;
  const installed = await listJarMetadata(modsPath);
  for (const jar of installed) {
    if (jar.id !== modId || path.resolve(jar.filePath) === path.resolve(destination)) continue;
    const backup = await backupIfPresent(jar.filePath, modsPath);
    try {
      await fs.unlink(jar.filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw fileBusyError(jar.filePath);
      throw error;
    }
    console.log(`  replaced old file: ${jar.fileName}${backup ? ' (backup in .mdd-backup)' : ''}`);
  }
}

async function installVersion(version, { modsPath, config, installDependencies, seen }) {
  if (seen.has(version.id)) return;
  seen.add(version.id);

  if (installDependencies) {
    for (const dependency of version.dependencies || []) {
      if (dependency.dependency_type === 'optional' || dependency.dependency_type === 'incompatible') continue;
      let dependencyVersion;
      if (dependency.version_id) dependencyVersion = await getVersion(dependency.version_id);
      else if (dependency.project_id) dependencyVersion = await resolveProjectVersion(dependency.project_id, config);
      if (!dependencyVersion) continue;
      await installVersion(dependencyVersion, { modsPath, config, installDependencies, seen });
    }
  }

  const file = version.files?.find((entry) => entry.primary) || version.files?.[0];
  if (!file) throw new Error(`Version ${version.id} has no downloadable file.`);
  const bytes = await downloadFile(file);
  if (file.hashes?.sha1) {
    const actual = crypto.createHash('sha1').update(bytes).digest('hex');
    if (actual !== file.hashes.sha1) throw new Error(`SHA-1 verification failed for ${file.filename}.`);
  }
  const destination = path.join(modsPath, file.filename);
  if (file.hashes?.sha1) {
    try {
      const existing = await fs.readFile(destination);
      const existingHash = crypto.createHash('sha1').update(existing).digest('hex');
      if (existingHash === file.hashes.sha1) {
        console.log(`  already installed: ${file.filename}`);
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const backup = await backupIfPresent(destination, modsPath);
  const temporary = `${destination}.mdd-download-${process.pid}.tmp`;
  await fs.writeFile(temporary, bytes);
  try {
    const downloadedMetadata = await readJarMetadata(temporary);
    await replaceExistingModJars(downloadedMetadata.id, destination, modsPath);
    if (backup) await fs.unlink(destination);
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    if (error.code === 'EBUSY' || error.code === 'EPERM') throw fileBusyError(destination);
    throw error;
  }
  console.log(`  installed: ${file.filename}${backup ? ' (old version in .mdd-backup)' : ''}`);
}

async function commandInstall(query, options, config, seen = new Set(), progress = null) {
  if (!config.minecraftVersion || !config.loader) throw new Error('Set `mdd version ...` and `mdd loader ...` first.');
  const project = await resolveProject(query, { version: config.minecraftVersion, loader: config.loader });
  const projectId = project.id || project.project_id;
  const version = await resolveProjectVersion(projectId, config);
  const targetMods = modsDir(options['minecraft-dir']);
  await fs.mkdir(targetMods, { recursive: true });
  if (progress) console.log(`\n[${progress.index}/${progress.total}] ${project.title}`);
  console.log(`Project: ${project.title} (${project.slug})`);
  console.log(`Version: ${version.version_number} | Minecraft ${config.minecraftVersion} | ${config.loader}`);
  await installVersion(version, { modsPath: targetMods, config, installDependencies: options.dependencies, seen });
  if (!options.dependencies) console.log('Warning: dependencies disabled by --no-dependencies.');
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional.shift() || 'help';
  const config = await loadConfig();

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`mdd — Minecraft mod manager\n\nCommands:\n  mdd version [value]                 show/set Minecraft version\n  mdd loader [value]                  show/set loader\n  mdd search <query>                  search Modrinth\n  mdd install <query> [query...]      install one or more mods and dependencies\n  mdd remove <name-or-id>             remove a mod\n  mdd list                            list installed mods\n  mdd check                           check current .minecraft/mods\n\nOptions:\n  --no-dependencies                  do not install required dependencies\n  --minecraft-dir <path>             override .minecraft directory\n  --json                              print machine-readable JSON\n  --plain                             print a non-interactive table\n\nConfig: ${configFile()}`);
    return;
  }

  if (command === 'version' || command === 'loader') {
    const key = command === 'version' ? 'minecraftVersion' : 'loader';
    const value = text(positional.join(' '));
    if (!value) console.log(config[key] || '(not set)');
    else {
      config[key] = value;
      await saveConfig(config);
      console.log(`${command}: ${value}`);
    }
    return;
  }

  if (command === 'search') {
    const query = text(positional.join(' '));
    if (!query) throw new Error('Enter a search query.');
    const result = await searchProjects(query, { version: config.minecraftVersion, loader: config.loader, limit: Number(options.limit) || 10 });
    if (options.json) printJson(result.hits, true);
    else if (!result.hits?.length) console.log('No results found.');
    else if (options.plain || !process.stdin.isTTY || !process.stdout.isTTY) printSearchTable(result.hits);
    else await interactiveSelect(result.hits, {
      heading: `Search results for: ${query}`,
      getName: (item) => item.title,
      getSecondary: (item) => item.slug,
      getDetails: (item) => [
        { label: 'ID', value: item.project_id },
        { label: 'SLUG', value: item.slug },
        { label: 'DESCRIPTION', value: item.description || '(no description)' }
      ],
      getAfterSelect: (item) => `Install with: mdd install ${item.slug}`
    });
    return;
  }

  if (command === 'install') {
    const queries = positional.map(text).filter(Boolean);
    if (!queries.length) throw new Error('Enter at least one mod name or slug.');
    const seen = new Set();
    let failed = 0;
    for (const [index, query] of queries.entries()) {
      try {
        await commandInstall(query, options, config, seen, { index: index + 1, total: queries.length });
      } catch (error) {
        failed += 1;
        console.error(`mdd: ${query}: ${error.message}`);
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }

  const targetMods = modsDir(options['minecraft-dir']);
  if (command === 'list') {
    const jars = await listJarMetadata(targetMods);
    if (options.json) printJson(jars, true);
    else if (!jars.length) console.log('No .jar files found in .minecraft/mods.');
    else if (options.plain || !process.stdin.isTTY || !process.stdout.isTTY) {
      for (const jar of jars) console.log(`${jar.id || '(unknown)'} — ${jar.name} ${jar.version} [${jar.fileName}]`);
    } else {
      await interactiveSelect(jars, {
        heading: 'Installed mods',
        getName: (jar) => jar.name,
        getSecondary: (jar) => jar.id || 'unknown',
        searchable: true,
        getSearchText: (jar) => [jar.name, jar.id, jar.fileName, jar.version].filter(Boolean).join(' '),
        getDetails: (jar) => [
          { label: 'ID', value: jar.id || '(unknown)' },
          { label: 'VERSION', value: jar.version },
          { label: 'FILE', value: jar.fileName },
          { label: 'TYPE', value: jar.type }
        ]
      });
    }
    return;
  }

  if (command === 'check') {
    const report = await checkMods({ modsPath: targetMods, minecraftPath: minecraftDir(options['minecraft-dir']), config });
    if (options.json) printJson(report, true);
    else {
      console.log(`Mods checked: ${report.jars.length}`);
      if (report.launch.state === 'world') console.log('Last launch: OK — latest.log reached the world.');
      else if (report.launch.state === 'started') console.log('Last launch: Minecraft started, but entering a world was not confirmed.');
      for (const warning of report.warnings) console.log(`WARN  ${warning}`);
      for (const error of report.errors) console.log(`ERROR ${error}`);
      console.log(report.ok ? 'OK: no definite conflicts found.' : `FAIL: ${report.errors.length} problem(s) found.`);
    }
    process.exitCode = report.ok && (!options.strict || report.warnings.length === 0) ? 0 : 1;
    return;
  }

  if (command === 'remove') {
    const query = text(positional.join(' ')).toLowerCase();
    if (!query) throw new Error('Enter a mod name, ID, or filename.');
    const jars = await listJarMetadata(targetMods);
    const matches = jars.filter((jar) => [jar.id, jar.name, jar.fileName].filter(Boolean).some((value) => value.toLowerCase() === query));
    if (matches.length !== 1) throw new Error(matches.length ? 'Multiple mods found — specify the exact filename.' : `Mod not found: ${query}`);
    const jar = matches[0];
    try {
      await fs.unlink(jar.filePath);
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') throw fileBusyError(jar.filePath);
      throw error;
    }
    console.log(`Removed: ${jar.fileName}`);
    return;
  }

  throw new Error(`Unknown command: ${command}. Run "mdd help".`);
}

main().catch((error) => {
  console.error(`mdd: ${error.message}`);
  process.exitCode = 1;
});
