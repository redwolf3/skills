#!/usr/bin/env node
'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const USAGE = `
Usage: redwolf3-skills <command> [options]

Commands:
  list        List all available skills
  help        Show this help message

Options:
  --help      Show this help message
  --version   Print the package version

Examples:
  npx redwolf3-skills list
  npx redwolf3-skills --help
  npx redwolf3-skills --version
`.trimStart();

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('help')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write(pkg.version + '\n');
  process.exit(0);
}

if (args[0] === 'list') {
  try {
    const scriptPath = join(__dirname, '..', 'scripts', 'list-skills.sh');
    const output = execFileSync('bash', [scriptPath], { encoding: 'utf8' });
    process.stdout.write(output);
    process.exit(0);
  } catch (err) {
    process.stderr.write('Error listing skills: ' + err.message + '\n');
    process.exit(1);
  }
}

process.stderr.write('Unknown command: ' + args[0] + '\n\n' + USAGE);
process.exit(1);
