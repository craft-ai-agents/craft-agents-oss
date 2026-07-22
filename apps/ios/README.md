<!-- apps/ios/README.md -->
# Craft Agents — iOS/iPadOS client

This directory requires macOS + Xcode 16+ (iOS 18 SDK) + [XcodeGen](https://github.com/yonaskolb/XcodeGen).
It cannot be built or tested on Linux.

## Layout
- `CraftAgentKit/` — pure-Swift protocol/transport/model layer (SwiftPM package, no UIKit). Test with `swift test`.
- `CraftAgentsApp/` — SwiftUI app target. Generate the Xcode project with:

  ```bash
  brew install xcodegen
  cd apps/ios/CraftAgentsApp && xcodegen generate
  open CraftAgentsApp.xcodeproj
  ```

  The generated `.xcodeproj` is gitignored — `project.yml` is the source of truth.
