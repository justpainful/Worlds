#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
import XCTest

final class WorldsLocalSearchScopeUITests: XCTestCase {
    @MainActor func testSearchScopesOnPersonalCopyInRTL() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing-local-copy-fixture", "--ui-testing-search-scopes", "--ui-testing-rtl", "--ui-testing-large-text"]
        app.launch()
        let project = app.descendants(matching: .any)["page.harness-project"].firstMatch
        guard project.waitForExistence(timeout: 30) else { capture(app, "scope-fixture-missing"); XCTFail("Local fixture missing"); return }
        let search = app.searchFields.firstMatch
        guard search.waitForExistence(timeout: 15) else { capture(app, "scope-search-missing"); XCTFail("Search field missing"); return }
        search.tap(); search.typeText("geometry")
        let projectResult = app.descendants(matching: .any)["search-result.harness-project"].firstMatch
        let pageResult = app.descendants(matching: .any)["search-result.fixture-page"].firstMatch
        guard projectResult.waitForExistence(timeout: 20), pageResult.waitForExistence(timeout: 20) else { capture(app, "scope-all-missing"); XCTFail("Expected search results missing"); return }
        let scope = app.descendants(matching: .any)["search-scope"].firstMatch
        guard scope.waitForExistence(timeout: 10) else { capture(app, "scope-picker-missing"); XCTFail("Search type picker missing"); return }
        scope.tap()
        let projects = app.buttons["Projects"].firstMatch
        guard projects.waitForExistence(timeout: 10) else { capture(app, "scope-project-option-missing"); XCTFail("Projects option missing"); return }
        projects.tap()
        guard projectResult.waitForExistence(timeout: 20) else { capture(app, "scope-project-result-missing"); XCTFail("Project result missing"); return }
        XCTAssertFalse(pageResult.exists, "Page results must be filtered from projects")
        scope.tap()
        let pages = app.buttons["Pages and documents"].firstMatch
        guard pages.waitForExistence(timeout: 10) else { capture(app, "scope-pages-option-missing"); XCTFail("Pages option missing"); return }
        pages.tap()
        guard pageResult.waitForExistence(timeout: 20) else { capture(app, "scope-page-result-missing"); XCTFail("Page result missing"); return }
        XCTAssertFalse(projectResult.exists, "Project results must be filtered from pages")
        pageResult.tap()
        XCTAssertTrue(app.descendants(matching: .any)["page-content"].waitForExistence(timeout: 20))
        capture(app, "scope-page-opened")
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
        let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
    }
}
#endif
