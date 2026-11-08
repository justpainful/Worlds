#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
import Foundation
import SQLite3
import WorldsLocalImport

/// Synthetic test data only. This path never accesses Application Support or a user database.
enum LocalCopyUITestFixture {
    static func make() throws -> (LocalProjectImportCoordinator, URL) {
        guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw CocoaError(.fileNoSuchFile) }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let source = root.appendingPathComponent("source.db")
        try FileManager.default.copyItem(at: fixture, to: source)
        var connection: OpaquePointer?
        guard sqlite3_open(source.path, &connection) == SQLITE_OK, let database = connection else {
            if let connection { sqlite3_close(connection) }
            throw CocoaError(.fileReadUnknown)
        }
        defer { sqlite3_close(database) }
        let sql = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('harness-project','Fixture project','project','{"project":{"status":"active","description":"Original fixture","links":[]},"unknown":{"preserve":true}}',1,100);"#
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        let stream = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('fixture-stream','Fixture stream','stream','{"stream":{"url":"https://old.example/video.mp4"},"future":true}',1,100);"#
        guard sqlite3_exec(database, stream, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        #endif
        #if WORLDS_EXPERIMENTAL_PAGE_EDITOR
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-document-table-column-insert") {
            let update = #"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"table","attrs":{"bid":"fixture-block","future":"keep"},"content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"أصل"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"آخر"}]}]}]}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-document-table-insert") {
            let update = #"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"table","attrs":{"bid":"fixture-block","future":"keep"},"content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"عنوان"}]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"بيانات"}]}]}]}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-document-table") {
            let update = #"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"table","attrs":{"bid":"fixture-block","future":"keep"},"content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":1,"rowspan":1,"colwidth":null},"content":[{"type":"paragraph","content":[{"type":"text","text":"خلية"}]}]}]}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-document-alignment") {
            let update = #"UPDATE pages SET kind='document' WHERE id='fixture-page'; UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl","textAlign":null,"future":"keep"},"content":[{"type":"text","text":"نص عربي"}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-link-fixture") {
            let update = #"UPDATE blocks SET content='{"type":"paragraph","attrs":{"bid":"fixture-block","dir":"rtl"},"content":[{"type":"text","text":"Hello ","marks":[{"type":"bold"}]},{"type":"text","text":"Worlds"}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-multi-bullet") {
            let update = #"UPDATE blocks SET content='{"type":"bulletList","attrs":{"bid":"fixture-block"},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-multi-task") {
            let update = #"UPDATE blocks SET content='{"type":"taskList","attrs":{"bid":"fixture-block"},"content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"First task"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[]}]}]}]},{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Second task"}]}]}]}' WHERE id='fixture-block'"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-presentation-fixture") {
            let deck = #"""
            INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('deck-test','Fixture deck','presentation','{}',1,100);
            INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('slide-media','deck-test','image','asset.png','image/png',1,'fixture/asset.png',1);
            INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES
            ('slide-a','deck-test','slide',1,'{"type":"slide","attrs":{"bid":"slide-a","background":{"color":"#16161a"},"elements":[{"id":"title-a","type":"text","x":20,"y":30,"w":500,"h":100,"text":"First slide"},{"id":"unknown","type":"future","data":{"keep":true}},{"id":"media","type":"image","attachmentId":"slide-media"}]}}',1,1),
            ('opaque','deck-test','future',2,'{"type":"future","attrs":{"bid":"opaque","keep":true}}',1,1),
            ('slide-b','deck-test','slide',3,'{"type":"slide","attrs":{"bid":"slide-b","elements":[{"id":"title-a","type":"text","text":"Second slide"}]}}',1,1);
            """#
            guard sqlite3_exec(database, deck, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-presentation-shape") {
                let update = ##"UPDATE blocks SET content='{"type":"slide","attrs":{"bid":"slide-a","background":{"color":"#16161a"},"elements":[{"id":"title-a","type":"text","x":20,"y":30,"w":500,"h":100,"text":"First slide"},{"id":"shape","type":"shape","shape":"rect","x":100,"y":160,"w":300,"h":200,"fill":"#d2a46e","future":{"keep":true}},{"id":"media","type":"image","attachmentId":"slide-media"}]}}' WHERE id='slide-a'"##
                guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
            }
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-presentation-element-order") {
                let update = ##"UPDATE blocks SET content='{"type":"slide","attrs":{"bid":"slide-a","background":{"color":"#16161a"},"elements":[{"id":"title-a","type":"text","text":"First slide"},{"id":"title-b","type":"text","text":"Second text"},{"id":"media","type":"image","attachmentId":"slide-media"}]}}' WHERE id='slide-a'"##
                guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
            }
        }
        #endif
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-duplicate-links") {
            let update = #"UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('["fixture-page","fixture-page"]')) WHERE id='harness-project';"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-unavailable-link") {
            let update = #"UPDATE pages SET metadata=json_set(metadata,'$.project.links',json('["missing-fixture"]')) WHERE id='harness-project';"#
            guard sqlite3_exec(database, update, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        #if WORLDS_EXPERIMENTAL_AUTOMATIONS
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-automation-fixture") {
            let automation = #"""
            INSERT INTO automations(id,name,enabled,spec,created_at,updated_at) VALUES('auto-fixture','Fixture automation',1,'{"trigger":{"kind":"manual"},"source":{"pageId":"fixture-page"},"action":{"kind":"discord.send"},"destination":{"kind":"channel","id":"example"},"policy":{"unattended":false}}',1,1);
            INSERT INTO runs(id,automation_id,status,trigger,started_at) VALUES('run-fixture','auto-fixture','waiting','manual',1);
            INSERT INTO pending_actions(id,kind,payload,requested_by,op_id,status,created_at) VALUES('pending-fixture','discord.send','{"runId":"run-fixture","automationId":"auto-fixture","pageId":"fixture-page"}','automation','run-fixture','pending',1);
            """#
            guard sqlite3_exec(database, automation, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        let drawing = #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('fixture-drawing','Fixture drawing','drawing','{}',1,100); INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);"#
        guard sqlite3_exec(database, drawing, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-unsupported-drawing") {
            let scene = ##"{"schema":1,"defaultFrameId":"f","frames":{"f":{"id":"f","name":"Frame","x":0,"y":0,"w":1280,"h":720,"background":"#ffffff","clip":true}},"frameOrder":["f"],"layers":{"a":{"id":"a","name":"Parent","visible":true,"locked":false,"positionLocked":false,"alphaLocked":false,"opacity":1,"blend":"source-over","parentId":null},"b":{"id":"b","name":"Child","visible":true,"locked":false,"positionLocked":false,"alphaLocked":false,"opacity":1,"blend":"source-over","parentId":"a"}},"layerOrder":["a","b"],"nodes":{},"nodeOrder":[],"assets":{},"masks":{},"steps":{},"stepOrder":[]}"##
            let insert = "INSERT INTO drawing_documents(page_id,revision,seed,scene,updated_at) VALUES('fixture-drawing',0,'\(scene)','\(scene)',1)"
            guard sqlite3_exec(database, insert, nil, nil, nil) == SQLITE_OK else { throw CocoaError(.fileWriteUnknown) }
        }
        #endif
        let importer = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: root.appendingPathComponent("private", isDirectory: true), backup: NativeSQLiteBackup())
        return (importer, source)
    }
}
#endif
