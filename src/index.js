'use strict';

const { execSync } = require('child_process');

/**
 * Get git commits for a repo within a date range.
 * @param {object} options
 * @param {string} options.repoPath - Path to git repo
 * @param {string} options.since - Date string (e.g. "2024-01-01")
 * @param {string} [options.until] - Date string (defaults to now)
 * @param {string} [options.author] - Filter by author (name or email)
 * @param {string} [options.branch] - Filter by branch (default: all branches)
 * @returns {Array<{hash:string, date:string, subject:string, author:string, body:string, files: number, insertions: number, deletions: number}>}
 */
function getCommits(options) {
  const { repoPath, since, until, author, branch } = options;

  const rev = branch || '--all';
  // Two-pass approach: first get commit metadata, then numstat separately
  let metaCmd = `git -C "${repoPath}" log ${rev} --format="%H%x00%ai%x00%s%x00%an" --no-merges`;
  if (since) metaCmd += ` --since="${since}"`;
  if (until) metaCmd += ` --until="${until}"`;
  if (author) metaCmd += ` --author="${author}"`;

  let rawMeta;
  try {
    rawMeta = execSync(metaCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return [];
  }

  if (!rawMeta) return [];

  // Get numstat with short hash to match
  let statCmd = `git -C "${repoPath}" log ${rev} --format="%H" --numstat --no-merges`;
  if (since) statCmd += ` --since="${since}"`;
  if (until) statCmd += ` --until="${until}"`;
  if (author) statCmd += ` --author="${author}"`;

  let rawStat;
  try {
    rawStat = execSync(statCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    rawStat = '';
  }

  // Parse numstat per commit hash
  const statsByHash = new Map();
  let currentHash = null;
  for (const line of rawStat.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Check if line is a commit hash (40 hex chars)
    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      currentHash = trimmed;
      statsByHash.set(currentHash, { files: 0, insertions: 0, deletions: 0 });
    } else if (currentHash) {
      const match = trimmed.match(/^(\d+|-)\s+(\d+|-)\s+/);
      if (match) {
        const s = statsByHash.get(currentHash);
        s.files++;
        if (match[1] !== '-') s.insertions += parseInt(match[1], 10);
        if (match[2] !== '-') s.deletions += parseInt(match[2], 10);
      }
    }
  }

  const commits = [];
  for (const line of rawMeta.split('\n')) {
    const parts = line.split('\x00');
    if (parts.length < 4) continue;

    const [hash, date, subject, authorName] = parts;
    const stats = statsByHash.get(hash.trim()) || { files: 0, insertions: 0, deletions: 0 };

    commits.push({
      hash: hash.trim(),
      date: date.trim().split(' ')[0],
      subject: subject.trim(),
      author: authorName.trim(),
      files: stats.files,
      insertions: stats.insertions,
      deletions: stats.deletions,
    });
  }

  return commits;
}

/**
 * Group commits by date.
 * @param {Array} commits
 * @returns {Map<string, Array>} date -> commits
 */
function groupByDate(commits) {
  const groups = new Map();
  for (const c of commits) {
    if (!groups.has(c.date)) groups.set(c.date, []);
    groups.get(c.date).push(c);
  }
  return groups;
}

/**
 * Detect conventional commit types from subjects.
 * @param {Array} commits
 * @returns {Map<string, number>} type -> count
 */
function detectTypes(commits) {
  const types = new Map();
  const pattern = /^(\w+)(\([^)]+\))?:/;
  const known = new Set(['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']);

  for (const c of commits) {
    const m = c.subject.match(pattern);
    if (m && known.has(m[1])) {
      types.set(m[1], (types.get(m[1]) || 0) + 1);
    } else {
      types.set('other', (types.get('other') || 0) + 1);
    }
  }
  return types;
}

/**
 * Get top files changed across commits.
 * @param {Array} commits - Note: requires re-fetching with numstat detail per file
 * @param {string} repoPath
 * @param {object} options
 * @returns {Array<{file: string, count: number}>}
 */
function getHotFiles(repoPath, options) {
  const { since, until, author, branch } = options;
  const rev = branch || '--all';
  let cmd = `git -C "${repoPath}" log ${rev} --format="" --numstat --no-merges`;
  if (since) cmd += ` --since="${since}"`;
  if (until) cmd += ` --until="${until}"`;
  if (author) cmd += ` --author="${author}"`;

  let raw;
  try {
    raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return [];
  }

  const counts = new Map();
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^\d+\s+\d+\s+(.+)$/);
    if (match) {
      const file = match[1];
      counts.set(file, (counts.get(file) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count }));
}

/**
 * Format a human-readable recap.
 * @param {object} data
 * @param {Map} data.byDate
 * @param {Map} data.types
 * @param {Array} data.hotFiles
 * @param {object} data.stats
 * @param {string} data.repoName
 * @returns {string}
 */
function formatRecap(data) {
  const { byDate, types, hotFiles, stats, repoName } = data;
  const lines = [];

  const sortedDates = [...byDate.keys()].sort().reverse();

  lines.push(`📋 ${repoName} — Activity Recap`);
  lines.push(`${stats.totalCommits} commits by ${stats.authors.join(', ')}`);
  lines.push(`${stats.totalInsertions} insertions, ${stats.totalDeletions} deletions across ${stats.totalFiles} files`);
  lines.push('');

  // Commit type breakdown
  if (types.size > 0) {
    const typeStr = [...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}:${c}`)
      .join(' ');
    lines.push(`📊 Types: ${typeStr}`);
    lines.push('');
  }

  for (const date of sortedDates) {
    const dayCommits = byDate.get(date);
    const dayName = getDayName(date);
    lines.push(`📅 ${date} (${dayName}) — ${dayCommits.length} commits`);

    for (const c of dayCommits) {
      const short = c.hash.slice(0, 7);
      const changes = `+${c.insertions}/-${c.deletions}`;
      lines.push(`  ${short} ${c.subject} (${changes})`);
    }
    lines.push('');
  }

  // Per-author breakdown
  if (stats.authorStats && stats.authorStats.size > 1) {
    lines.push('👥 By author:');
    for (const [name, s] of [...stats.authorStats.entries()].sort((a, b) => b[1].commits - a[1].commits)) {
      lines.push(`  ${name}: ${s.commits} commits, +${s.insertions}/-${s.deletions}`);
    }
    lines.push('');
  }

  if (hotFiles.length > 0) {
    lines.push('🔥 Most changed files:');
    for (const { file, count } of hotFiles.slice(0, 5)) {
      lines.push(`  ${file} (${count} changes)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format recap as JSON.
 */
function formatJson(data) {
  const { byDate, types, hotFiles, stats, repoName } = data;
  return JSON.stringify({
    repo: repoName,
    stats: {
      totalCommits: stats.totalCommits,
      totalFiles: stats.totalFiles,
      totalInsertions: stats.totalInsertions,
      totalDeletions: stats.totalDeletions,
      authors: stats.authors,
      authorStats: stats.authorStats ? Object.fromEntries([...stats.authorStats.entries()].map(([name, s]) => [name, s])) : {},
    },
    types: Object.fromEntries(types),
    byDate: Object.fromEntries(
      [...byDate.entries()].map(([date, commits]) => [
        date,
        commits.map(c => ({
          hash: c.hash,
          subject: c.subject,
          author: c.author,
          files: c.files,
          insertions: c.insertions,
          deletions: c.deletions,
        })),
      ])
    ),
    hotFiles,
  }, null, 2);
}

/**
 * Format recap as markdown.
 */
function formatMarkdown(data) {
  const { byDate, types, hotFiles, stats, repoName } = data;
  const lines = [];

  lines.push(`# ${repoName} — Activity Recap`);
  lines.push('');
  lines.push(`**${stats.totalCommits} commits** by ${stats.authors.join(', ')}`);
  lines.push(`+${stats.totalInsertions} / -${stats.totalDeletions} across ${stats.totalFiles} files`);
  lines.push('');

  if (types.size > 0) {
    lines.push('## Commit Types');
    lines.push('');
    for (const [t, c] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${t}\`: ${c}`);
    }
    lines.push('');
  }

  // Per-author breakdown
  if (stats.authorStats && stats.authorStats.size > 1) {
    lines.push('## Authors');
    lines.push('');
    for (const [name, s] of [...stats.authorStats.entries()].sort((a, b) => b[1].commits - a[1].commits)) {
      lines.push(`- **${name}**: ${s.commits} commits (+${s.insertions}/-${s.deletions})`);
    }
    lines.push('');
  }

  const sortedDates = [...byDate.keys()].sort().reverse();
  for (const date of sortedDates) {
    const dayCommits = byDate.get(date);
    const dayName = getDayName(date);
    lines.push(`## ${date} (${dayName}) — ${dayCommits.length} commits`);
    lines.push('');
    for (const c of dayCommits) {
      lines.push(`- \`${c.hash.slice(0, 7)}\` ${c.subject} (+${c.insertions}/-${c.deletions})`);
    }
    lines.push('');
  }

  if (hotFiles.length > 0) {
    lines.push('## Most Changed Files');
    lines.push('');
    for (const { file, count } of hotFiles) {
      lines.push(`- \`${file}\` — ${count} changes`);
    }
  }

  return lines.join('\n');
}

/**
 * Run a full recap analysis.
 * @param {object} options
 * @param {string} options.repoPath
 * @param {string} [options.since]
 * @param {string} [options.until]
 * @param {string} [options.author]
 * @param {string} [options.branch]
 * @param {'text'|'json'|'markdown'} [options.format]
 * @returns {string}
 */
function recap(options) {
  const { repoPath = '.', format = 'text' } = options;

  // Default since to 7 days ago
  const since = options.since || defaultSince();
  const until = options.until;

  const commits = getCommits({ ...options, since, until });
  if (commits.length === 0) return 'No commits found in the specified range.';

  const byDate = groupByDate(commits);
  const types = detectTypes(commits);
  const hotFiles = getHotFiles(repoPath, { since, until, author: options.author, branch: options.branch });

  const authors = [...new Set(commits.map(c => c.author))];
  const totalInsertions = commits.reduce((s, c) => s + c.insertions, 0);
  const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
  const totalFiles = commits.reduce((s, c) => s + c.files, 0);

  // Per-author stats
  const authorStats = new Map();
  for (const c of commits) {
    if (!authorStats.has(c.author)) {
      authorStats.set(c.author, { commits: 0, insertions: 0, deletions: 0, files: 0 });
    }
    const s = authorStats.get(c.author);
    s.commits++;
    s.insertions += c.insertions;
    s.deletions += c.deletions;
    s.files += c.files;
  }

  let repoName;
  try {
    repoName = execSync(`git -C "${repoPath}" remote get-url origin`, { encoding: 'utf-8' }).trim().split('/').pop().replace('.git', '');
  } catch {
    repoName = repoPath === '.' ? process.cwd().split('/').pop() : repoPath.split('/').pop();
  }

  const data = { byDate, types, hotFiles, stats: { totalCommits: commits.length, totalFiles, totalInsertions, totalDeletions, authors, authorStats }, repoName };

  switch (format) {
    case 'json': return formatJson(data);
    case 'markdown': return formatMarkdown(data);
    default: return formatRecap(data);
  }
}

function defaultSince() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function getDayName(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  } catch {
    return '';
  }
}

module.exports = { recap, getCommits, groupByDate, detectTypes, getHotFiles, formatRecap, formatJson, formatMarkdown };
