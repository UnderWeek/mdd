const API = process.env.MDD_MODRINTH_API || 'https://api.modrinth.com/v2';
const USER_AGENT = 'mdd/@underweek/mdd 0.1.1';

function facet(value) {
  return JSON.stringify([value]);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    ...options
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Modrinth API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

export async function searchProjects(query, { version, loader, limit = 10 } = {}) {
  const url = new URL(`${API}/search`);
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 100)));
  const facets = [['project_type:mod']];
  if (version) facets.push([`versions:${version}`]);
  if (loader) facets.push([`categories:${loader}`]);
  url.searchParams.set('facets', JSON.stringify(facets));
  return requestJson(url);
}

export async function getProject(projectId) {
  return requestJson(`${API}/project/${encodeURIComponent(projectId)}`);
}

export async function getVersion(versionId) {
  return requestJson(`${API}/version/${encodeURIComponent(versionId)}`);
}

export async function getProjectVersions(projectId, { version, loader } = {}) {
  const url = new URL(`${API}/project/${encodeURIComponent(projectId)}/version`);
  if (version) url.searchParams.set('game_versions', JSON.stringify([version]));
  if (loader) url.searchParams.set('loaders', JSON.stringify([loader]));
  return requestJson(url);
}

export function selectProject(results, query) {
  const needle = query.trim().toLowerCase();
  return results.find((item) => item.title?.toLowerCase() === needle || item.slug?.toLowerCase() === needle) || results[0];
}

export function splitProjectQuery(query) {
  const value = query.trim();
  const match = value.match(/^(.+?)@([0-9][0-9A-Za-z.+-]*)$/);
  if (!match) return { projectQuery: value, requestedVersion: null };
  return { projectQuery: match[1].trim(), requestedVersion: match[2] };
}

export function versionMatches(versionNumber, requestedVersion) {
  const actual = String(versionNumber || '').toLowerCase();
  const requested = String(requestedVersion || '').trim().toLowerCase();
  if (!actual || !requested) return false;
  if (actual === requested) return true;
  const escaped = requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[-+])${escaped}(?:$|[-+])`, 'i').test(actual);
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function resolveProject(query, filters = {}) {
  const candidates = [query.trim(), slugify(query)].filter((value, index, list) => value && list.indexOf(value) === index);
  for (const candidate of candidates) {
    try {
      const project = await getProject(candidate);
      if (project.project_type === 'mod') return project;
    } catch {
      // The query may be a title rather than a slug; use search below.
    }
  }

  const result = await searchProjects(query, { ...filters, limit: 10 });
  const exact = (result.hits || []).find((item) => {
    const needle = query.trim().toLowerCase();
    return item.title?.toLowerCase() === needle || item.slug?.toLowerCase() === needle;
  });
  if (exact) return exact;
  if ((result.hits || []).length === 1) return result.hits[0];
  const choices = (result.hits || []).slice(0, 5).map((item) => `${item.title} (${item.slug})`).join(', ');
  throw new Error(`Exact project "${query}" was not found. Use a slug. Options: ${choices || 'no results'}.`);
}

export function selectRelease(versions) {
  return versions.find((version) => version.version_type === 'release') || versions[0];
}

export async function resolveProjectVersion(projectId, config, requestedVersion = null) {
  const versions = await getProjectVersions(projectId, {
    version: config.minecraftVersion ?? config.version,
    loader: config.loader
  });
  const compatibleVersions = requestedVersion
    ? versions.filter((version) => versionMatches(version.version_number, requestedVersion))
    : versions;
  const selected = selectRelease(compatibleVersions);
  if (!selected) {
    if (requestedVersion) {
      throw new Error(`No version ${requestedVersion} of project ${projectId} was found for Minecraft ${config.minecraftVersion} + ${config.loader}.`);
    }
    throw new Error(`No version of project ${projectId} was found for Minecraft ${config.minecraftVersion} + ${config.loader}.`);
  }
  return selected;
}

export async function downloadFile(file) {
  const response = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Could not download ${file.filename}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes;
}

export { facet };
