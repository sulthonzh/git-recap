#!/usr/bin/env node
'use strict';

const { recap } = require('./index');
const path = require('path');

function parseArgs(argv) {
  const args = { repoPath: '.', format: 'text' };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--since':
        args.since = argv[++i];
        break;
      case '--until':
        args.until = argv[++i];
        break;
      case '--author':
        args.author = argv[++i];
        break;
      case '--branch':
        args.branch = argv[++i];
        break;
      case '--repo':
        args.repoPath = argv[++i];
        break;
      case '--format':
        args.format = argv[++i];
        break;
      case '--json':
        args.format = 'json';
        break;
      case '--markdown':
      case '--md':
        args.format = 'markdown';
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (!argv[i].startsWith('-')) {
          args.repoPath = argv[i];
        }
    }
  }

  return args;
}

function printHelp() {
  console.log(`git-recap — What did I do this week?

Usage:
  git-recap [path]           Recap the last 7 days (default)
  git-recap --since 2024-01-01 --until 2024-01-31
  git-recap --author sulthonzh
  git-recap --branch main
  git-recap --json           Machine-readable output
  git-recap --markdown       Markdown output

Options:
  --since <date>     Start date (YYYY-MM-DD or relative like "2 weeks ago")
  --until <date>     End date
  --author <name>    Filter by author name or email
  --branch <name>    Filter by branch (default: all)
  --repo <path>      Path to git repo (default: current directory)
  --format <fmt>     Output format: text, json, markdown
  --json             Shorthand for --format json
  --markdown, --md   Shorthand for --format markdown
  -h, --help         Show this help
`);
}

const args = parseArgs(process.argv);
console.log(recap(args));
