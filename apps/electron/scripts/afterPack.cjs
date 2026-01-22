/**
 * Post-packaging hook for electron-builder
 * Used to compile macOS 26+ Liquid Glass icons
 */
module.exports = async function (context) {
  const { electronPlatformName, appOutDir } = context;

  // Only run for macOS builds
  if (electronPlatformName !== 'darwin') {
    return;
  }

  console.log('afterPack hook: Skipping Liquid Glass icon compilation');
  // TODO: Add Liquid Glass icon compilation if needed
  // This would use actool to compile Assets.xcassets into Assets.car
};
