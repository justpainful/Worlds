# Build and installation status

The Apple applications are incomplete. Do not use an intermediate build as a replacement for Worlds or as evidence of feature parity. No installable deliverable has been published.

The repository's `Apple/project.yml` describes XcodeGen targets for iOS and macOS, and `Apple/WorldsCore` is a Swift package. On an appropriately configured Mac, resolve the package and generate the Xcode project with XcodeGen, then build the relevant scheme with a supported Xcode. The GitHub Actions workflow `apple-platforms.yml` produces development artifacts labeled incomplete when its packaging prerequisites pass. They do not provide full feature parity and the experimental local-copy editor is not enabled in these builds.

The device IPA requires signing or a separate authorized installation method; an unsigned IPA is not directly installable on a physical iPhone or iPad. The macOS build has no signing certificate or identity; its arm64 executable contains the linker-generated ad hoc signature. It remains subject to platform security restrictions. Build artifacts are available from successful packaging jobs on the GitHub Actions run; a successful packaging job does not imply the whole workflow passed or that the application was tested on a physical device.
