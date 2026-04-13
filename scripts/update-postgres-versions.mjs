#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const dockerHubTagsUrl = 'https://hub.docker.com/v2/repositories/library/postgres/tags?page_size=100';
const minSupportedMajor = 12;
const workflowPath = '.github/workflows/docker-hub.yml';
const readmePath = 'README.md';
const dockerfilePaths = ['Dockerfile', 'Dockerfile.alpine'];

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

function tagForVariant(version, variant) {
  return variant === 'base' ? version : `${version}-${variant}`;
}

function variantExists(tags, version, variant) {
  return tags.has(tagForVariant(version, variant));
}

function renderMatrixInclude(releases) {
  const lines = [];

  for (const release of releases) {
    for (const variant of release.variants) {
      lines.push(`- pg_version: "${release.version}"`);
      lines.push(`  variant: ${variant}`);
    }
  }

  return lines.join('\n');
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

function getGeneratedBlock(content, name) {
  const start = `# BEGIN GENERATED ${name}`;
  const end = `# END GENERATED ${name}`;
  const expression = new RegExp(`([ \\t]*)${escapeRegExp(start)}\\n([\\s\\S]*?)\\n\\1${escapeRegExp(end)}`);
  const match = content.match(expression);

  if (!match) {
    throw new Error(`Could not find generated block: ${name}`);
  }

  return match[2];
}

function parseExistingMatrixReleases(content) {
  const matrixBlock = getGeneratedBlock(content, 'POSTGRES MATRIX');
  const entries = [...matrixBlock.matchAll(/^\s*-\s+pg_version:\s+"?([0-9]+)\.([0-9]+)"?\s*\n\s*variant:\s+([a-z0-9_-]+)\s*$/gm)];
  const releasesByVersion = new Map();

  for (const entry of entries) {
    const major = Number(entry[1]);
    const patch = Number(entry[2]);
    const version = `${major}.${patch}`;
    const variant = entry[3];

    if (major < minSupportedMajor) {
      continue;
    }

    if (!releasesByVersion.has(version)) {
      releasesByVersion.set(version, { major, patch, version, variants: [] });
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

function replaceGeneratedBlock(content, name, replacement) {
  const start = `# BEGIN GENERATED ${name}`;
  const end = `# END GENERATED ${name}`;
  const expression = new RegExp(`([ \\t]*)${escapeRegExp(start)}\\n[\\s\\S]*?\\n\\1${escapeRegExp(end)}`);
  const match = content.match(expression);

  if (!match) {
    throw new Error(`Could not find generated block: ${name}`);
  }

  const indent = match[1];
  const replacementWithIndent = replacement
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${indent}${line}`))
    .join('\n');

  return content.replace(expression, `${indent}${start}\n${replacementWithIndent}\n${indent}${end}`);
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

async function fetchPostgresTags() {
  const tags = new Set();
  let nextUrl = dockerHubTagsUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl);

    if (!response.ok) {
      throw new Error(`Docker Hub returned ${response.status} for ${nextUrl}`);
    }

    const page = await response.json();

    for (const result of page.results ?? []) {
      if (typeof result.name === 'string') {
        tags.add(result.name);
      }
    }

    nextUrl = page.next;
  }

  return tags;
}

function selectReleases(tags) {
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

    const release = candidates.find((candidate) =>
      preferredVariantsForMajor(major).every((variant) => variantExists(tags, candidate.version, variant)),
    );

    if (!release) {
      continue;
    }

    releases.push({
      ...release,
      variants: preferredVariantsForMajor(major),
    });
  }

  return releases.sort(compareVersionsDesc);
}

function mergeWithFrozenReleases(selectedReleases, existingReleases) {
  const selectedMajors = new Set(selectedReleases.map((release) => release.major));
  const frozenReleases = existingReleases.filter((release) => !selectedMajors.has(release.major));

  for (const release of frozenReleases) {
    console.log(`Freezing Postgres ${release.version}; no complete upstream tag set found for major ${release.major}.`);
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
  const currentWorkflow = await readFile(workflowPath, 'utf8');
  const existingReleases = parseExistingMatrixReleases(currentWorkflow);
  const tags = await fetchPostgresTags();
  const selectedReleases = selectReleases(tags);

  if (selectedReleases.length === 0) {
    throw new Error('No supported Postgres releases found');
  }

  const releases = mergeWithFrozenReleases(selectedReleases, existingReleases);

  const latestVersion = releases[0].version;
  const changed = [];

  if (
    await updateFile(workflowPath, (content) => {
      let updated = replaceGeneratedBlock(
        content,
        'POSTGRES LATEST VERSION',
        `LATEST_PG_VERSION: "${latestVersion}"`,
      );
      updated = replaceGeneratedBlock(updated, 'POSTGRES MATRIX', renderMatrixInclude(releases));
      return updated;
    })
  ) {
    changed.push(workflowPath);
  }

  if (
    await updateFile(readmePath, (content) => {
      let updated = replaceGeneratedHtmlBlock(content, 'POSTGRES TAGS', renderReadmeTags(releases));
      updated = updated.replace(
        /image: kgrozdanovski\/pgvector:[0-9]+\.[0-9]+-alpine/g,
        `image: kgrozdanovski/pgvector:${latestVersion}-alpine`,
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

  if (changed.length === 0) {
    console.log(`Postgres versions are already up to date at ${latestVersion}.`);
    return;
  }

  console.log(`Updated Postgres versions to ${latestVersion}:`);
  for (const path of changed) {
    console.log(`- ${path}`);
  }

  if (checkOnly) {
    process.exitCode = 1;
  }
}

await main();
