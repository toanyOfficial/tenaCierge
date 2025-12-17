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

const repoRoot = path.resolve(__dirname, '..');
const nodeModulesDir = path.join(repoRoot, 'node_modules');

function ensureSymlink(pkg) {
  const target = path.join(repoRoot, 'vendor', pkg);
  const dest = path.join(nodeModulesDir, pkg);

  if (!fs.existsSync(target)) {
    console.warn(`Skipping ${pkg}: vendor target missing at ${target}`);
    return;
  }

  if (fs.existsSync(dest)) {
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(target, dest, 'junction');
}

fs.mkdirSync(nodeModulesDir, { recursive: true });
vendorPackages.forEach(ensureSymlink);
