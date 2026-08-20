/**
 * electron-builder afterPack hook
 *
 * Copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file is compiled locally using actool with the
 * macOS 26 SDK (not available in CI), then committed to the repo.
 *
 * To regenerate Assets.car after icon changes, compile the catalog and record
 * the source SVG hash as its provenance:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *   shasum -a 256 resources/icon.icon/Assets/icon.svg | cut -d' ' -f1 \
 *     > resources/Assets.car.source-sha256
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function hasCurrentAssetProvenance(assetsCar, sourceSvg) {
  const provenanceFile = `${assetsCar}.source-sha256`;
  if (!fs.existsSync(provenanceFile)) {
    return false;
  }

  const recordedHash = fs.readFileSync(provenanceFile, 'utf8').trim();
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(sourceSvg)).digest('hex');
  return recordedHash === sourceHash;
}

module.exports = async function afterPack(context) {
  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const appPath = context.appOutDir;
  const resourcesDir = path.join(appPath, 'Craft Agents.app', 'Contents', 'Resources');
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');
  const sourceSvg = path.join(context.packager.projectDir, 'resources', 'icon.icon', 'Assets', 'icon.svg');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  if (!hasCurrentAssetProvenance(precompiledAssets, sourceSvg)) {
    console.log('Warning: Pre-compiled Assets.car has no provenance for the current icon source; skipping it');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};
