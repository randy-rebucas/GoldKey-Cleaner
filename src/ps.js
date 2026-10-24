// Helpers for running PowerShell and plain processes from the main process.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runPS(script, { timeout = 120000 } = {}) {
  const full = "$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;\n" + script;
  // Run from a temp .ps1 file: scripts with embedded data easily exceed the 32K command-line limit.
  // The BOM makes Windows PowerShell read it as UTF-8.
  const file = path.join(os.tmpdir(), `goldkey-${process.pid}-${crypto.randomUUID()}.ps1`);
  fs.writeFileSync(file, '﻿' + full, 'utf8');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        fs.rm(file, { force: true }, () => {});
        if (err && !stdout) return reject(new Error(stderr || err.message));
        resolve(stdout.trim());
      }
    );
  });
}

// Runs a script that ends in ConvertTo-Json and returns the parsed value as an array.
async function runPSJson(script, opts) {
  const out = await runPS(script, opts);
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// Embeds a JS value into a PowerShell script without any quoting/injection issues.
function psData(value) {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json)`;
}

function run(cmd, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

module.exports = { runPS, runPSJson, psData, run };
