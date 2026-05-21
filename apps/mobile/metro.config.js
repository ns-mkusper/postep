const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const bridgeRoot = path.resolve(workspaceRoot, 'packages/bridge/src');
const config = getDefaultConfig(projectRoot);
const defaultResolveRequest = config.resolver.resolveRequest;

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@postep/bridge') {
    return { type: 'sourceFile', filePath: path.join(bridgeRoot, 'index.ts') };
  }
  if (moduleName === '@postep/bridge/platform/android/saf') {
    return { type: 'sourceFile', filePath: path.join(bridgeRoot, 'platform/android/saf.ts') };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
