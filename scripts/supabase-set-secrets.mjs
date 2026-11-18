import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Run from an interactive terminal to enter the password without displaying it.');

function hidden(prompt) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value + decoder.end());
    };
    const onData = (chunk) => {
      if (chunk.includes(3)) return finish(new Error('Cancelled.'));
      if (chunk.includes(13) || chunk.includes(10)) return finish();
      if (chunk.includes(8) || chunk.includes(127)) value = Array.from(value + decoder.end()).slice(0, -1).join('');
      else value += decoder.write(chunk);
    };
    process.stdin.on('data', onData);
  });
}

const password = await hidden('Choose admin password (hidden, at least 16 characters): ');
if (password.length < 16) throw new Error('Use at least 16 characters.');
const salt = randomBytes(24);
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const digest = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt }, key, 256));
const hex = (value) => [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const hash = `pbkdf2-sha256$600000$${hex(salt)}$${hex(digest)}`;
const sessionSecret = randomBytes(48).toString('base64url');
const file = path.join(root, '.supabase-secrets.local');
fs.writeFileSync(file, `ADMIN_PASSWORD_HASH=${hash}\nSESSION_SIGNING_SECRET=${sessionSecret}\n`, { mode: 0o600 });
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['supabase', 'secrets', 'set', '--env-file', '.supabase-secrets.local', '--yes'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) throw new Error('Supabase secrets were not confirmed. The ignored local secret file was retained for retry.');
fs.rmSync(file, { force: true });
console.log('Administrator password hash and session signing secret are set in Supabase.');
