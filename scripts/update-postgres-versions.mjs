#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

// Docker Hub's /v2/repositories tag API refuses anonymous requests past the
// first ~1000 results with a 403, and the postgres repository publishes more
// tags than that. The registry API returns the whole tag list instead.
const registryTokenUrl =
  'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/postgres:pull';
const registryTagsUrl = 'https://registry-1.docker.io/v2/library/postgres/tags/list';
const pgvectorTagsUrl = 'https://api.github.com/repos/pgvector/pgvector/tags?per_page=100';
const userAgent = 'pgvector-image-updater';

// The postgres repository has published far more tags than this for years, so a
// listing smaller than this means the response was truncated. Fail instead of
// silently dropping variants from the generated matrix.
const minExpectedTagCount = 1000;
const minSupportedMajor = 12;
const versionsPath = 'postgres-versions.json';
const readmePath = 'README.md';
const dockerfilePaths = ['Dockerfile', 'Dockerfile.alpine'];

// pgvector 0.8+ requires Postgres 13+. 0.7.4 is the last release that supports
// Postgres 12, so cap that major here instead of tracking the latest upstream tag.
const pgvectorOverrideByMajor = new Map([[12, '0.7.4']]);

const checkOnly = process.argv.includes('--check');

function compareVersionsDesc(a, b) {
  if (b.major !== a.major) {
    return b.major - a.major;
  }

  return b.patch - a.patch;
}

function preferredVariantsForMajor(major) {
  const variants = ['base', 'alpine', 'bookworm'];

  if (major >= 14) {
    variants.push('trixie');
  }

  if (major === 12) {
    variants.push('bullseye');
  }

  return variants;
}

function pgvectorForMajor(major, latest) {
  return pgvectorOverrideByMajor.get(major) ?? latest;
}

function tagForVariant(version, variant) {
  return variant === 'base' ? version : `${version}-${variant}`;
}

function variantExists(tags, version, variant) {
  return tags.has(tagForVariant(version, variant));
}

function matrixEntriesForReleases(releases) {
  const entries = [];

  for (const release of releases) {
    for (const variant of release.variants) {
      entries.push({
        pg_version: release.version,
        variant,
        pgvector_version: release.pgvector_version,
      });
    }
  }

  return entries;
}

function renderVersionsData(releases, pgvectorLatest) {
  return `${JSON.stringify(
    {
      latest: releases[0].version,
      pgvector: pgvectorLatest,
      matrix: {
        include: matrixEntriesForReleases(releases),
      },
    },
    null,
    2,
  )}\n`;
}

function latestVariantVersion(releases, variant) {
  const release = releases.find((candidate) => candidate.variants.includes(variant));

  return release ? release.version : releases[0].version;
}

function renderReadmeTags(releases) {
  return releases
    .map((release, index) => {
      const tags = [];

      if (index === 0) {
        tags.push('latest');
      }

      for (const variant of release.variants) {
        if (variant === 'base') {
          tags.push(String(release.major), release.version);
        } else {
          tags.push(`${release.major}-${variant}`, `${release.version}-${variant}`);
        }
      }

      return `* ${tags.map((tag) => `\`${tag}\``).join(', ')}`;
    })
    .join('\n');
}

function parseExistingMatrixReleases(matrixEntries) {
  const releasesByVersion = new Map();

  for (const entry of matrixEntries) {
    if (typeof entry.pg_version !== 'string' || typeof entry.variant !== 'string') {
      throw new Error('Invalid postgres versions matrix entry');
    }

    const match = entry.pg_version.match(/^([0-9]+)\.([0-9]+)$/);

    if (!match) {
      throw new Error(`Invalid Postgres version: ${entry.pg_version}`);
    }

    const major = Number(match[1]);
    const patch = Number(match[2]);
    const version = entry.pg_version;
    const variant = entry.variant;

    if (major < minSupportedMajor) {
      continue;
    }

    if (!releasesByVersion.has(version)) {
      releasesByVersion.set(version, {
        major,
        patch,
        version,
        variants: [],
        pgvector_version: entry.pgvector_version,
      });
    }

    releasesByVersion.get(version).variants.push(variant);
  }

  const latestByMajor = new Map();

  for (const release of releasesByVersion.values()) {
    const current = latestByMajor.get(release.major);

    if (!current || release.patch > current.patch) {
      latestByMajor.set(release.major, release);
    }
  }

  return [...latestByMajor.values()].sort(compareVersionsDesc);
}

function replaceGeneratedHtmlBlock(content, name, replacement) {
  const start = `<!-- BEGIN GENERATED ${name} -->`;
  const end = `<!-- END GENERATED ${name} -->`;
  const expression = new RegExp(`${escapeRegExp(start)}\\n[\\s\\S]*?\\n${escapeRegExp(end)}`);

  if (!expression.test(content)) {
    throw new Error(`Could not find generated HTML block: ${name}`);
  }

  return content.replace(expression, `${start}\n${replacement}\n${end}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchJson(url) {
  const headers = { 'User-Agent': userAgent };

  // GitHub's unauthenticated API is limited to 60 requests/hour per IP; use the
  // Actions token when available so scheduled runs don't get rate limited.
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    headers.Accept = 'application/vnd.github+json';
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Request to ${url} returned ${response.status}`);
  }

  return response.json();
}

function nextPageUrl(linkHeader, currentUrl) {
  const match = linkHeader?.match(/<([^>]+)>\s*;[^,]*\brel="?next"?/i);

  return match ? new URL(match[1], currentUrl).toString() : null;
}

async function fetchRegistryToken() {
  const { token } = await fetchJson(registryTokenUrl);

  if (!token) {
    throw new Error('Docker registry did not return an anonymous pull token');
  }

  return token;
}

async function fetchPostgresTags() {
  const headers = { 'User-Agent': userAgent, Authorization: `Bearer ${await fetchRegistryToken()}` };
  const tags = new Set();
  let nextUrl = registryTagsUrl;

  // The registry currently answers with the full list in one response, but the
  // API may paginate via Link headers, so follow them when they show up.
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers });

    if (!response.ok) {
      throw new Error(`Request to ${nextUrl} returned ${response.status}`);
    }

    const page = await response.json();

    for (const tag of page.tags ?? []) {
      if (typeof tag === 'string') {
        tags.add(tag);
      }
    }

    nextUrl = nextPageUrl(response.headers.get('link'), nextUrl);
  }

  if (tags.size < minExpectedTagCount) {
    throw new Error(`Expected at least ${minExpectedTagCount} postgres tags, received ${tags.size}`);
  }

  return tags;
}

async function fetchPgvectorLatest() {
  const tags = await fetchJson(pgvectorTagsUrl);
  const versions = [];

  for (const tag of tags) {
    const match = typeof tag.name === 'string' && tag.name.match(/^v([0-9]+)\.([0-9]+)\.([0-9]+)$/);

    if (match) {
      versions.push({
        raw: tag.name.slice(1),
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
      });
    }
  }

  if (versions.length === 0) {
    throw new Error('No stable pgvector releases found');
  }

  versions.sort(
    (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2],
  );

  return versions[0].raw;
}

function selectReleases(tags, pgvectorLatest) {
  const candidatesByMajor = new Map();
  const exactVersionPattern = /^([0-9]+)\.([0-9]+)$/;

  for (const tag of tags) {
    const match = tag.match(exactVersionPattern);

    if (!match) {
      continue;
    }

    const major = Number(match[1]);
    const patch = Number(match[2]);

    if (major < minSupportedMajor) {
      continue;
    }

    if (!candidatesByMajor.has(major)) {
      candidatesByMajor.set(major, []);
    }

    candidatesByMajor.get(major).push({ major, patch, version: tag });
  }

  const releases = [];

  for (const [major, candidates] of candidatesByMajor) {
    candidates.sort(compareVersionsDesc);

    // Pick the newest patch that publishes the base image, then keep whichever
    // preferred variants actually exist for it. A variant that is temporarily
    // missing upstream is simply dropped for this patch instead of pinning the
    // whole major to an older patch; it returns on the next run once published.
    const chosen = candidates.find((candidate) => variantExists(tags, candidate.version, 'base'));

    if (!chosen) {
      continue;
    }

    const variants = preferredVariantsForMajor(major).filter((variant) =>
      variantExists(tags, chosen.version, variant),
    );

    if (variants.length === 0) {
      continue;
    }

    releases.push({
      ...chosen,
      variants,
      pgvector_version: pgvectorForMajor(major, pgvectorLatest),
    });
  }

  return releases.sort(compareVersionsDesc);
}

function mergeWithFrozenReleases(selectedReleases, existingReleases) {
  const selectedMajors = new Set(selectedReleases.map((release) => release.major));
  const frozenReleases = existingReleases.filter((release) => !selectedMajors.has(release.major));

  for (const release of frozenReleases) {
    console.log(`Freezing Postgres ${release.version}; no upstream base tag found for major ${release.major}.`);
  }

  return [...selectedReleases, ...frozenReleases].sort(compareVersionsDesc);
}

async function updateFile(path, updater) {
  const before = await readFile(path, 'utf8');
  const after = updater(before);

  if (after === before) {
    return false;
  }

  if (!checkOnly) {
    await writeFile(path, after);
  }

  return true;
}

async function main() {
  const currentVersions = JSON.parse(await readFile(versionsPath, 'utf8'));
  const existingReleases = parseExistingMatrixReleases(currentVersions.matrix?.include ?? []);
  const [tags, pgvectorLatest] = await Promise.all([fetchPostgresTags(), fetchPgvectorLatest()]);
  const selectedReleases = selectReleases(tags, pgvectorLatest);

  if (selectedReleases.length === 0) {
    throw new Error('No supported Postgres releases found');
  }

  const releases = mergeWithFrozenReleases(selectedReleases, existingReleases);

  const latestVersion = releases[0].version;
  const latestAlpineVersion = latestVariantVersion(releases, 'alpine');
  const changed = [];

  if (
    await updateFile(versionsPath, () => renderVersionsData(releases, pgvectorLatest))
  ) {
    changed.push(versionsPath);
  }

  if (
    await updateFile(readmePath, (content) => {
      let updated = replaceGeneratedHtmlBlock(content, 'POSTGRES TAGS', renderReadmeTags(releases));
      updated = updated.replace(
        /image: kgrozdanovski\/pgvector:[0-9]+\.[0-9]+-alpine/g,
        `image: kgrozdanovski/pgvector:${latestAlpineVersion}-alpine`,
      );
      return updated;
    })
  ) {
    changed.push(readmePath);
  }

  for (const dockerfilePath of dockerfilePaths) {
    if (
      await updateFile(dockerfilePath, (content) =>
        content.replace(/^ARG PG_VERSION=[0-9]+\.[0-9]+$/m, `ARG PG_VERSION=${latestVersion}`),
      )
    ) {
      changed.push(dockerfilePath);
    }
  }

  // Keep the alpine fallback pgvector version (used for local builds that don't
  // pass PGVECTOR_VERSION) in sync with the latest tracked release.
  if (
    await updateFile('Dockerfile.alpine', (content) =>
      content.replace(
        /(\*\) PGVECTOR_VERSION=)[0-9]+\.[0-9]+\.[0-9]+/,
        `$1${pgvectorLatest}`,
      ),
    )
  ) {
    changed.push('Dockerfile.alpine (pgvector default)');
  }

  if (changed.length === 0) {
    console.log(`Postgres ${latestVersion} / pgvector ${pgvectorLatest} are already up to date.`);
    return;
  }

  console.log(`Updated to Postgres ${latestVersion} / pgvector ${pgvectorLatest}:`);
  for (const path of changed) {
    console.log(`- ${path}`);
  }

  if (checkOnly) {
    process.exitCode = 1;
  }
}

await main();
