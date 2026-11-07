# Apple testing matrix

None of the device, visual, integration or end-to-end checks below has been completed. Unit test source is being added; record results only after the corresponding run succeeds.

| Scope | Required coverage | Current evidence |
| --- | --- | --- |
| Shared core | Models, storage, identity, protocol, errors and migrations | Initial Swift tests; first CI job failed to compile a fixture, correction pending rerun |
| Integration | Real service contracts, CRUD, search, collaboration, AI and import/export using isolated data | Not run |
| iPhone | Small, standard and large devices, light/dark, Dynamic Type and RTL | No simulator interaction or visual review |
| iPad | Portrait, landscape, split view, resizable windows, keyboard and Pencil | No simulator interaction or visual review |
| macOS | Small, standard, large and full-screen windows, menus and keyboard | No application interaction or visual review |
| OS versions | Current native glass and iOS 17/macOS 14 fallbacks | No runtime coverage; macOS 14 requires a suitable external runner |
| UI automation | Real end-to-end workflows and interactive states with isolated fixtures | Not implemented |
| Visual review | Captures of each supported view and state, reviewed individually | Not performed |

CI build-only results must not be reported as interaction, visual, device or feature verification.
