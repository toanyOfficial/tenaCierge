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
  'google-auth-library',
];

const fallbackPackages = {};

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
  const missingDependencies = hasMissingDependencies(dest, definition.requiredModules);

  if (fs.existsSync(dest) && !isBrokenSymlink(dest) && !missingDependencies) {
    return;
  }

  fs.rmSync(dest, { recursive: true, force: true });

  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({
    name: pkg,
    version: definition.version,
    main: definition.main
  }, null, 2));
  fs.writeFileSync(path.join(dest, definition.main), definition.index, 'utf8');
  const reason = missingDependencies ? 'missing dependencies' : 'missing package';
  console.warn(`Created fallback shim for ${pkg} (${reason}).`);
}

function hasMissingDependencies(moduleDir, requiredModules = []) {
  if (!fs.existsSync(moduleDir)) {
    return true;
  }

  if (!requiredModules || requiredModules.length === 0) {
    return false;
  }

  return requiredModules.some((dep) => {
    try {
      require.resolve(dep, { paths: [moduleDir] });
      return false;
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') {
        return true;
      }

      throw error;
    }
  });
}

fs.mkdirSync(nodeModulesDir, { recursive: true });
vendorPackages.forEach(ensureSymlink);
Object.entries(fallbackPackages).forEach(([pkg, definition]) => ensureFallbackModule(pkg, definition));
