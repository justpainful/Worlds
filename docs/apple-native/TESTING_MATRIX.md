# Apple testing matrix

Device, visual and full end-to-end checks below remain incomplete. The latest completed Swift core test job passed 16 tests in [run 42384342918](https://github.com/justpainful/Worlds/actions/runs/42384342918); these are not proof of full feature parity.

| Scope | Required coverage | Current evidence |
| --- | --- | --- |
| Shared core | Models, storage, identity, protocol, errors and migrations | 16 Swift tests passed on macOS; 9 RustStore and 4 RustCollaboration tests passed on Windows. Real Apple keychain, migration and service coverage remains incomplete |
| Integration | Real service contracts, CRUD, search, collaboration, AI and import/export using isolated data | Not run |
| iPhone | Small, standard and large devices, light/dark, Dynamic Type and RTL | No simulator interaction or visual review |
| iPad | Portrait, landscape, split view, resizable windows, keyboard and Pencil | No simulator interaction or visual review |
| macOS | Small, standard, large and full-screen windows, menus and keyboard | No application interaction or visual review |
| OS versions | Current native glass and iOS 17/macOS 14 fallbacks | No runtime coverage; macOS 14 requires a suitable external runner |
| UI automation | Real end-to-end workflows and interactive states with isolated fixtures | Initial tests exist; run 42384342918 failed at UI-test module compilation. A corrected run is underway |
| Visual review | Captures of each supported view and state, reviewed individually | Not performed |

CI build-only results must not be reported as interaction, visual, device or feature verification.
