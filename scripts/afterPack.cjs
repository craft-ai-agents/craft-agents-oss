/**
 * afterPack hook for electron-builder
 * This is a placeholder for macOS 26+ Liquid Glass icon compilation.
 * The actual implementation requires Xcode toolchain (actool).
 */
module.exports = async function(context) {
  console.log('afterPack: skipping Liquid Glass icon compilation (Xcode required)');
};
