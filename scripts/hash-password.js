#!/usr/bin/env node
/**
 * Generate an ADMIN_PASSWORD_HASH value.
 *
 *   npm run hash-password -- "my secret password"
 *
 * or pipe it in, which keeps the password out of your shell history:
 *
 *   echo "my secret password" | npm run hash-password
 */

import { hashPassword } from '../lib/auth.js';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

const password = process.argv.slice(2).join(' ').trim() || await readStdin();

if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  console.error('   or: echo "your password" | npm run hash-password');
  process.exit(1);
}

if (password.length < 10) {
  console.error('Use at least 10 characters.');
  process.exit(1);
}

console.log('\nAdd this to your environment variables:\n');
console.log(`ADMIN_PASSWORD_HASH="${hashPassword(password)}"\n`);
