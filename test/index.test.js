'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCommits, groupByDate, detectTypes, formatRecap, formatJson, formatMarkdown, recap } = require('../src/index');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git init "${dir}"`);
  execSync(`git -C "${dir}" config user.email "test@test.com"`);
  execSync(`git -C "${dir}" config user.name "Test"`);
  return dir;
}

function commit(dir, msg, file, content) {
  const fp = path.join(dir, file);
  fs.writeFileSync(fp, content || Date.now().toString());
  execSync(`git -C "${dir}" add "${file}"`);
  execSync(`git -C "${dir}" commit -m "${msg}"`);
}

describe('groupByDate', () => {
  it('groups commits by date', () => {
    const commits = [
      { date: '2024-01-01', subject: 'a' },
      { date: '2024-01-01', subject: 'b' },
      { date: '2024-01-02', subject: 'c' },
    ];
    const groups = groupByDate(commits);
    assert.equal(groups.size, 2);
    assert.equal(groups.get('2024-01-01').length, 2);
    assert.equal(groups.get('2024-01-02').length, 1);
  });
});

describe('detectTypes', () => {
  it('detects conventional commit types', () => {
    const commits = [
      { subject: 'feat: add login' },
      { subject: 'fix: patch bug' },
      { subject: 'feat(ui): add button' },
      { subject: 'random commit msg' },
    ];
    const types = detectTypes(commits);
    assert.equal(types.get('feat'), 2);
    assert.equal(types.get('fix'), 1);
    assert.equal(types.get('other'), 1);
  });

  it('handles all commits as other when no convention', () => {
    const commits = [
      { subject: 'added stuff' },
      { subject: 'fixed things' },
    ];
    const types = detectTypes(commits);
    assert.equal(types.size, 1);
    assert.equal(types.get('other'), 2);
  });
});

describe('formatRecap', () => {
  it('produces text output', () => {
    const data = {
      repoName: 'test-repo',
      byDate: new Map([['2024-01-01', [{ hash: 'abc1234567', date: '2024-01-01', subject: 'feat: stuff', author: 'Test', files: 2, insertions: 10, deletions: 5 }]]]),
      types: new Map([['feat', 1]]),
      hotFiles: [{ file: 'src/index.js', count: 3 }],
      stats: { totalCommits: 1, totalFiles: 2, totalInsertions: 10, totalDeletions: 5, authors: ['Test'] },
    };
    const out = formatRecap(data);
    assert.ok(out.includes('test-repo'));
    assert.ok(out.includes('feat: stuff'));
    assert.ok(out.includes('abc1234'));
    assert.ok(out.includes('src/index.js'));
  });
});

describe('formatJson', () => {
  it('produces valid JSON', () => {
    const data = {
      repoName: 'test-repo',
      byDate: new Map([['2024-01-01', [{ hash: 'abc', date: '2024-01-01', subject: 'test', author: 'Me', files: 1, insertions: 5, deletions: 2 }]]]),
      types: new Map(),
      hotFiles: [],
      stats: { totalCommits: 1, totalFiles: 1, totalInsertions: 5, totalDeletions: 2, authors: ['Me'] },
    };
    const out = formatJson(data);
    const parsed = JSON.parse(out);
    assert.equal(parsed.repo, 'test-repo');
    assert.equal(parsed.stats.totalCommits, 1);
  });
});

describe('formatMarkdown', () => {
  it('produces markdown output', () => {
    const data = {
      repoName: 'test-repo',
      byDate: new Map([['2024-01-01', [{ hash: 'abc1234567890', date: '2024-01-01', subject: 'init', author: 'Me', files: 1, insertions: 10, deletions: 0 }]]]),
      types: new Map(),
      hotFiles: [],
      stats: { totalCommits: 1, totalFiles: 1, totalInsertions: 10, totalDeletions: 0, authors: ['Me'] },
    };
    const out = formatMarkdown(data);
    assert.ok(out.startsWith('# '));
    assert.ok(out.includes('2024-01-01'));
  });
});

describe('getCommits (integration)', () => {
  it('reads commits from a real repo', () => {
    const dir = path.join(os.tmpdir(), `git-recap-test-${Date.now()}`);
    makeRepo(dir);
    commit(dir, 'feat: initial commit', 'hello.txt', 'world');
    commit(dir, 'fix: bug fix', 'fix.txt', 'patched');

    const commits = getCommits({ repoPath: dir, since: '2024-01-01' });
    assert.equal(commits.length, 2);
    assert.ok(commits[0].subject.includes('fix'));
    assert.ok(commits[1].subject.includes('feat'));
    assert.equal(commits[0].insertions > 0 || commits[1].insertions > 0, true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('recap (integration)', () => {
  it('runs full recap on a repo', () => {
    const dir = path.join(os.tmpdir(), `git-recap-full-${Date.now()}`);
    makeRepo(dir);
    commit(dir, 'feat: add feature', 'a.txt', 'content');
    commit(dir, 'chore: cleanup', 'b.txt', 'more');

    const out = recap({ repoPath: dir, since: '2024-01-01', format: 'text' });
    assert.ok(out.includes('commits'));
    assert.ok(out.includes('feat: add feature') || out.includes('chore: cleanup'));

    const json = recap({ repoPath: dir, since: '2024-01-01', format: 'json' });
    const parsed = JSON.parse(json);
    assert.equal(parsed.stats.totalCommits, 2);

    const md = recap({ repoPath: dir, since: '2024-01-01', format: 'markdown' });
    assert.ok(md.includes('## '));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('handles empty repo', () => {
    const dir = path.join(os.tmpdir(), `git-recap-empty-${Date.now()}`);
    makeRepo(dir);

    const out = recap({ repoPath: dir, since: '2024-01-01' });
    assert.equal(out, 'No commits found in the specified range.');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('filters by author', () => {
    const dir = path.join(os.tmpdir(), `git-recap-auth-${Date.now()}`);
    makeRepo(dir);
    commit(dir, 'feat: thing', 'x.txt', 'y');

    const all = getCommits({ repoPath: dir, since: '2024-01-01' });
    const filtered = getCommits({ repoPath: dir, since: '2024-01-01', author: 'Nobody' });
    assert.equal(all.length, 1);
    assert.equal(filtered.length, 0);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
