const fs = require('fs');

const lockfile = fs.readFileSync('package-lock.json', 'utf8');
const encoded = Buffer.from(lockfile, 'utf8').toString('base64');

console.log('CODEX_LOCK_BEGIN');
for (let index = 0; index < encoded.length; index += 4000) {
  console.log(encoded.slice(index, index + 4000));
}
console.log('CODEX_LOCK_END');
