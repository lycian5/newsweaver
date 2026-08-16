#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { notifyCollectionResult } = require('./collection-notifications');

const repoRoot = path.resolve(__dirname, '..');
const host = process.env.AGENT_REACH_RUNNER_HOST || '0.0.0.0';
const port = Number.parseInt(process.env.AGENT_REACH_RUNNER_PORT || '8787', 10);
const secret = process.env.AGENT_REACH_RUNNER_SECRET || process.env.AGENT_REACH_WEBHOOK_SECRET || '';
const collector = path.join(__dirname, 'agent-reach-collect.js');
const defaultVenvBin = process.platform === 'win32'
  ? path.join(process.env.USERPROFILE || '', '.agent-reach-venv', 'Scripts')
  : path.join(process.env.HOME || '/root', '.agent-reach-venv', 'bin');
const venvBin = process.env.AGENT_REACH_VENV_BIN || defaultVenvBin;

if (!secret) {
  console.error('AGENT_REACH_RUNNER_SECRET or AGENT_REACH_WEBHOOK_SECRET is required.');
  process.exit(1);
}

let activeRun = null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, active: Boolean(activeRun) });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/run') {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }

    if (activeRun) {
      sendJson(res, 409, { ok: false, error: 'Agent Reach collector is already running' });
      return;
    }

    const body = await readJson(req);
    const args = buildCollectorArgs(body || {});
    activeRun = runCollector(args);
    if (body?.async === true) {
      activeRun
        .then(async (result) => {
          if (!isDryRun(body)) {
            const notification = await notifyCollectionResult(result, body);
            if (!notification.sent) console.log(`Collection notification skipped: ${notification.reason}`);
          }
        })
        .catch((err) => { console.error(`Collection notification error: ${err.message}`); })
        .finally(() => { activeRun = null; });
      sendJson(res, 202, { ok: true, accepted: true, args });
      return;
    }
    const result = await activeRun;
    activeRun = null;
    sendJson(res, result.exitCode === 0 ? 200 : 500, result);
  } catch (err) {
    activeRun = null;
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(port, host, () => {
  console.log(`Agent Reach runner listening on ${host}:${port}`);
});

function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const headerSecret = req.headers['x-agent-reach-secret'] || '';
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

function buildCollectorArgs(body) {
  const args = [];
  const allowed = [
    'dry-run',
    'sources',
    'limit-keywords',
    'exa-results',
    'official-results',
    'youtube-results',
    'github-results',
    'reddit-results',
    'rss-results',
    'timeout-ms',
    'jina-enrich',
    'keywords',
  ];
  for (const key of allowed) {
    const value = body[key] ?? body[camelCase(key)];
    if (value == null || value === '') continue;
    if (value === true) args.push(`--${key}`);
    else if (value !== false) args.push(`--${key}=${String(value)}`);
  }
  return args;
}

function runCollector(args) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PATH: `${venvBin}${path.delimiter}${process.env.PATH || ''}`,
    };
    const child = spawn(process.execPath, [collector, ...args], {
      cwd: repoRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (exitCode) => {
      let summary = null;
      try {
        const match = stdout.match(/\{[\s\S]*\}\s*$/);
        summary = JSON.parse(match ? match[0] : stdout);
      } catch (_) {
        summary = null;
      }
      resolve({
        ok: exitCode === 0,
        exitCode,
        completedAt: new Date().toISOString(),
        args,
        summary,
        stdout: stdout.slice(-8000),
        stderr: stderr.slice(-8000),
      });
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function isDryRun(body) {
  return body?.['dry-run'] === true || body?.dryRun === true;
}
