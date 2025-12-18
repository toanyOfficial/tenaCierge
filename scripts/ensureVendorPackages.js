const fs = require('fs');
const path = require('path');

const vendorPackages = [
  'clsx',
  'eventemitter3',
  'lodash',
  'react-smooth',
  'recharts-scale',
  'tiny-invariant',
  'victory-vendor',
];

const fallbackPackages = {
  'web-push': {
    version: '0.0.0-fallback',
    main: 'index.js',
    index: `"use strict";

class WebPushError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'WebPushError';
    this.statusCode = statusCode;
  }
}

function unavailable(method) {
  const error = new WebPushError(
    'web-push module is not installed. Install it with "npm install web-push" to enable ' + method + '.',
    503
  );
  return Promise.reject(error);
}

module.exports = {
  WebPushError,
  setVapidDetails() {
    console.warn('[web-push] setVapidDetails skipped: fallback shim in use.');
  },
  setGCMAPIKey() {
    console.warn('[web-push] setGCMAPIKey skipped: fallback shim in use.');
  },
  generateVAPIDKeys() {
    throw new WebPushError('generateVAPIDKeys unavailable: install web-push to use this feature.', 503);
  },
  sendNotification() {
    return unavailable('sendNotification');
  }
};
`
  }
};

const repoRoot = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(repoRoot, 'node_modules');

function isBrokenSymlink(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isSymbolicLink()) {
      return false;
    }

    const linkTarget = fs.readlinkSync(targetPath);
    const resolvedTarget = path.resolve(path.dirname(targetPath), linkTarget);
    return !fs.existsSync(resolvedTarget);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function ensureSymlink(pkg) {
  const target = path.join(repoRoot, 'vendor', pkg);
  const dest = path.join(nodeModulesDir, pkg);

  if (!fs.existsSync(target)) {
    console.warn(`Skipping ${pkg}: vendor target missing at ${target}`);
    return;
  }

  if (fs.existsSync(dest) && !isBrokenSymlink(dest)) {
    return;
  }

  if (isBrokenSymlink(dest)) {
    fs.unlinkSync(dest);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(target, dest, 'junction');
}

function ensureFallbackModule(pkg, definition) {
  const dest = path.join(nodeModulesDir, pkg);

  if (fs.existsSync(dest) && !isBrokenSymlink(dest)) {
    return;
  }

  if (isBrokenSymlink(dest)) {
    fs.unlinkSync(dest);
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({
    name: pkg,
    version: definition.version,
    main: definition.main
  }, null, 2));
  fs.writeFileSync(path.join(dest, definition.main), definition.index, 'utf8');
  console.warn(`Created fallback shim for missing package: ${pkg}`);
}

fs.mkdirSync(nodeModulesDir, { recursive: true });
vendorPackages.forEach(ensureSymlink);
Object.entries(fallbackPackages).forEach(([pkg, definition]) => ensureFallbackModule(pkg, definition));
