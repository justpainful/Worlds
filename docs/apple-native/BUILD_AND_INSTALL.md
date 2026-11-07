# Build and installation status

The Apple applications are incomplete. Do not use an intermediate build as a replacement for Worlds or as evidence of feature parity. No installable deliverable has been published.

The repository's `Apple/project.yml` describes XcodeGen targets for iOS and macOS, and `Apple/WorldsCore` is a Swift package. On an appropriately configured Mac, resolve the package and generate the Xcode project with XcodeGen, then build the relevant scheme with a supported Xcode. The GitHub Actions workflow `apple-platforms.yml` currently runs core tests and build checks without publishing unsigned applications. The workflow is still being validated.

The eventual device IPA requires signing or a separate authorized installation method; an unsigned IPA is not directly installable on a physical iPhone or iPad. Unsigned macOS applications also remain subject to platform security and signing restrictions. Exact download links and installation instructions will be added only after verified artifacts exist.
