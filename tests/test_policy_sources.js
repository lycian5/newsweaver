const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../lib/policySources'), 'utf8');

assert.match(source, /https:\/\/www\.moel\.go\.kr\/news\/enews\/report\/enewsList\.do/);

process.stdout.write('Policy source checks passed.\n');
