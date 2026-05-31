# git-recap

> "What did I do this week?" — answered in seconds.

git-recap generates human-readable summaries of your git activity. Perfect for standups, weekly reports, or just figuring out where your time went.

## Why?

Every Monday: "What did I do last week?" → open GitHub, scroll through commits, try to remember. This tool does it for you.

## Install

```bash
npm install -g git-recap
```

## Usage

```bash
# Last 7 days (default)
git-recap

# Specific range
git-recap --since 2024-01-01 --until 2024-01-31

# Filter by author
git-recap --author sulthonzh

# Different repo
git-recap /path/to/project

# For scripts / CI
git-recap --json

# Markdown for docs/reports
git-recap --markdown
```

## Output Example

```
📋 my-project — Activity Recap
18 commits by Sulthon
+1,247 / -389 across 42 files

📊 Types: feat:8 fix:5 chore:3 docs:2

📅 2024-01-15 (Monday) — 5 commits
  a1b2c3d feat: add user authentication (+120/-12)
  e4f5g6h fix: handle null token (+8/-3)
  ...

🔥 Most changed files:
  src/auth.ts (8 changes)
  package.json (5 changes)
```

## API

```js
const { recap } = require('git-recap');

const summary = recap({
  repoPath: '.',
  since: '2024-01-01',
  format: 'text', // 'text' | 'json' | 'markdown'
});
```

## Features

- Groups commits by day with day-of-week names
- Detects conventional commit types (feat, fix, chore, etc.)
- Shows insertions/deletions per commit
- Hot files — most frequently changed files
- 3 output formats: text, JSON, markdown
- Zero dependencies

## License

MIT
