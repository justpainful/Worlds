import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { ResourceHeader } from "../resources/views/ResourceHeader";
import { Icon } from "../ui/Icon";
import { useMenu, type MenuItem } from "../ui/Menu";
import { Modal, confirmDialog } from "../ui/Modal";
import { promptText } from "../editor/prompt";
import {
  FUNCTION_DOCS,
  WORKBOOK_TEMPLATES,
  cellKey,
  colToName,
  cycleRefAbsolute,
  evaluateWorkbook,
  expandRangeCoords,
  conditionalStyle,
  formatScalar,
  generateAutofillValue,
  newSheet,
  normalizeWorkbook,
  parseCellRef,
  shiftFormulaReferences,
  shiftSheetStructure,
  type CellData,
  type CellStyle,
  type NumberFormat,
  type SheetData,
  type WorkbookData,
} from "./engine";

interface SelectionRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

interface ClipboardBuffer {
  sheetId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  cut: boolean;
  cells: Record<string, { dr: number; dc: number; cell: CellData; evaluatedDisplay: string }>;
}

const TEXT_COLORS = [
  "#1e293b",
  "#ffffff",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0284c7",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];

const FILL_COLORS = [
  "transparent",
  "#f8fafc",
  "#fee2e2",
  "#ffedd5",
  "#fef3c7",
  "#dcfce7",
  "#e0f2fe",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
  "#1e293b",
];

export function SpreadsheetView({ pageId }: { pageId: string }) {
  const pageMeta = useStore((s) => s.pages[pageId]);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [undoStack, setUndoStack] = useState<WorkbookData[]>([]);
  const [redoStack, setRedoStack] = useState<WorkbookData[]>([]);
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [sel, setSel] = useState<SelectionRange>({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>("");
  const [nameBoxText, setNameBoxText] = useState<string>("A1");
  const [findOpen, setFindOpen] = useState<boolean>(false);
  const [findQuery, setFindQuery] = useState<string>("");
  const [replaceQuery, setReplaceQuery] = useState<string>("");
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [fillDrag, setFillDrag] = useState<{ r2: number; c2: number } | null>(null);
  const [clipboardBuf, setClipboardBuf] = useState<ClipboardBuffer | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const formulaInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const isSelectingRef = useRef<boolean>(false);
  const showMenu = useMenu((s) => s.show);

  // Load initial workbook from page metadata
  useEffect(() => {
    let cancelled = false;
    api.page(pageId, true).then((p) => {
      if (cancelled || !p) return;
      const loaded = normalizeWorkbook(p.metadata?.sheet);
      setWb(loaded);
      setUndoStack([]);
      setRedoStack([]);
      setActive({ r: 0, c: 0 });
      setSel({ r1: 0, c1: 0, r2: 0, c2: 0 });
      setEditing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const persistWorkbook = useCallback(
    (nextWb: WorkbookData) => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        api.setPageMeta(pageId, "sheet" as never, nextWb).catch((e) => {
          useStore.getState().toast({ message: errorMessage(e), tone: "error" });
        });
      }, 220);
    },
    [pageId],
  );

  const commitWb = useCallback(
    (updater: (prev: WorkbookData) => WorkbookData, recordUndo = true) => {
      setWb((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (recordUndo) {
          setUndoStack((u) => [...u.slice(-49), prev]);
          setRedoStack([]);
        }
        persistWorkbook(next);
        return next;
      });
    },
    [persistWorkbook],
  );

  const sheet = useMemo<SheetData | null>(() => {
    if (!wb) return null;
    return wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0] ?? null;
  }, [wb]);

  const evaluated = useMemo(() => (wb ? evaluateWorkbook(wb) : {}), [wb]);
  const sheetEval = useMemo(() => (sheet ? evaluated[sheet.id] ?? {} : {}), [evaluated, sheet]);

  // Sync Name Box & formula bar when active cell changes
  useEffect(() => {
    const minR = Math.min(sel.r1, sel.r2);
    const maxR = Math.max(sel.r1, sel.r2);
    const minC = Math.min(sel.c1, sel.c2);
    const maxC = Math.max(sel.c1, sel.c2);
    if (minR === maxR && minC === maxC) {
      setNameBoxText(cellKey(active.r, active.c));
    } else {
      setNameBoxText(`${cellKey(minR, minC)}:${cellKey(maxR, maxC)}`);
    }
    if (!editing && sheet) {
      const k = cellKey(active.r, active.c);
      setDraft(sheet.cells[k]?.v ?? "");
    }
  }, [active, sel, editing, sheet]);

  const updateActiveSheet = useCallback(
    (fn: (s: SheetData) => SheetData, recordUndo = true) => {
      commitWb((prev) => {
        const sheets = prev.sheets.map((s) => (s.id === prev.activeSheetId ? fn(s) : s));
        return { ...prev, sheets };
      }, recordUndo);
    },
    [commitWb],
  );

  const commitEdit = useCallback(
    (nextValue?: string) => {
      if (!sheet) return;
      const val = nextValue !== undefined ? nextValue : draft;
      const k = cellKey(active.r, active.c);
      const prevVal = sheet.cells[k]?.v ?? "";
      if (val !== prevVal) {
        updateActiveSheet((s) => {
          const nextCells = { ...s.cells };
          if (val === "" && !nextCells[k]?.s && !nextCells[k]?.note) {
            delete nextCells[k];
          } else {
            nextCells[k] = { ...(nextCells[k] ?? {}), v: val };
          }
          return { ...s, cells: nextCells };
        });
      }
      setEditing(false);
    },
    [sheet, draft, active, updateActiveSheet],
  );

  const moveSelection = useCallback(
    (r: number, c: number, extend = false) => {
      if (!sheet) return;
      const nr = Math.max(0, Math.min(sheet.rows - 1, r));
      const nc = Math.max(0, Math.min(sheet.cols - 1, c));
      if (extend) {
        setSel((prev) => ({ ...prev, r2: nr, c2: nc }));
      } else {
        setActive({ r: nr, c: nc });
        setSel({ r1: nr, c1: nc, r2: nr, c2: nc });
      }
    },
    [sheet],
  );

  const jumpDataEdge = useCallback(
    (dr: number, dc: number, extend: boolean) => {
      if (!sheet) return;
      let r = extend ? sel.r2 : active.r;
      let c = extend ? sel.c2 : active.c;
      const hasVal = (rr: number, cc: number) => Boolean(sheet.cells[cellKey(rr, cc)]?.v?.trim());
      const curHas = hasVal(r, c);
      const nextHas = hasVal(r + dr, c + dc);

      while (true) {
        const tr = r + dr;
        const tc = c + dc;
        if (tr < 0 || tc < 0 || tr >= sheet.rows || tc >= sheet.cols) break;
        r = tr;
        c = tc;
        if (curHas && nextHas) {
          if (!hasVal(r + dr, c + dc)) break;
        } else {
          if (hasVal(r, c)) break;
        }
      }
      moveSelection(r, c, extend);
    },
    [sheet, active, sel, moveSelection],
  );

  const undo = useCallback(() => {
    if (!wb || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, wb]);
    setWb(prev);
    persistWorkbook(prev);
  }, [wb, undoStack, persistWorkbook]);

  const redo = useCallback(() => {
    if (!wb || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, wb]);
    setWb(next);
    persistWorkbook(next);
  }, [wb, redoStack, persistWorkbook]);

  // Style helpers on selection
  const selectedCoords = useMemo(
    () => expandRangeCoords(sel.r1, sel.c1, sel.r2, sel.c2),
    [sel.r1, sel.c1, sel.r2, sel.c2],
  );

  const activeCellStyle = useMemo<CellStyle>(() => {
    if (!sheet) return {};
    return sheet.cells[cellKey(active.r, active.c)]?.s ?? {};
  }, [sheet, active]);

  const patchSelectionStyle = useCallback(
    (patch: Partial<CellStyle> | ((prev: CellStyle) => CellStyle)) => {
      updateActiveSheet((s) => {
        const nextCells = { ...s.cells };
        for (const { r, c } of selectedCoords) {
          const k = cellKey(r, c);
          const existing = nextCells[k] ?? { v: "" };
          const prevStyle = existing.s ?? {};
          const nextStyle = typeof patch === "function" ? patch(prevStyle) : { ...prevStyle, ...patch };
          nextCells[k] = { ...existing, s: nextStyle };
        }
        return { ...s, cells: nextCells };
      });
    },
    [selectedCoords, updateActiveSheet],
  );

  // Fill Down (Ctrl+D) & Fill Right (Ctrl+R)
  const fillDown = useCallback(() => {
    if (!sheet) return;
    const minR = Math.min(sel.r1, sel.r2);
    const maxR = Math.max(sel.r1, sel.r2);
    const minC = Math.min(sel.c1, sel.c2);
    const maxC = Math.max(sel.c1, sel.c2);
    if (minR === maxR && minR > 0) {
      // Single row selected: copy from row above
      updateActiveSheet((s) => {
        const nextCells = { ...s.cells };
        for (let c = minC; c <= maxC; c++) {
          const src = nextCells[cellKey(minR - 1, c)];
          nextCells[cellKey(minR, c)] = generateAutofillValue([{ r: minR - 1, c, cell: src }], minR, c, 0);
        }
        return { ...s, cells: nextCells };
      });
      return;
    }
    updateActiveSheet((s) => {
      const nextCells = { ...s.cells };
      for (let c = minC; c <= maxC; c++) {
        const src = nextCells[cellKey(minR, c)];
        for (let r = minR + 1; r <= maxR; r++) {
          nextCells[cellKey(r, c)] = generateAutofillValue([{ r: minR, c, cell: src }], r, c, r - minR - 1);
        }
      }
      return { ...s, cells: nextCells };
    });
  }, [sheet, sel, updateActiveSheet]);

  const fillRight = useCallback(() => {
    if (!sheet) return;
    const minR = Math.min(sel.r1, sel.r2);
    const maxR = Math.max(sel.r1, sel.r2);
    const minC = Math.min(sel.c1, sel.c2);
    const maxC = Math.max(sel.c1, sel.c2);
    if (minC === maxC && minC > 0) {
      updateActiveSheet((s) => {
        const nextCells = { ...s.cells };
        for (let r = minR; r <= maxR; r++) {
          const src = nextCells[cellKey(r, minC - 1)];
          nextCells[cellKey(r, minC)] = generateAutofillValue([{ r, c: minC - 1, cell: src }], r, minC, 0);
        }
        return { ...s, cells: nextCells };
      });
      return;
    }
    updateActiveSheet((s) => {
      const nextCells = { ...s.cells };
      for (let r = minR; r <= maxR; r++) {
        const src = nextCells[cellKey(r, minC)];
        for (let c = minC + 1; c <= maxC; c++) {
          nextCells[cellKey(r, c)] = generateAutofillValue([{ r, c: minC, cell: src }], r, c, c - minC - 1);
        }
      }
      return { ...s, cells: nextCells };
    });
  }, [sheet, sel, updateActiveSheet]);

  // AutoSum (Alt+=)
  const insertAutoFunction = useCallback(
    (fnName = "SUM") => {
      if (!sheet) return;
      const { r, c } = active;
      // Check numbers above first
      let rStart = r - 1;
      while (rStart >= 0 && sheetEval[cellKey(rStart, c)]?.numeric !== null && sheetEval[cellKey(rStart, c)]?.numeric !== undefined) {
        rStart--;
      }
      rStart++;
      if (rStart <= r - 1) {
        const formula = `=${fnName}(${cellKey(rStart, c)}:${cellKey(r - 1, c)})`;
        commitEdit(formula);
        setDraft(formula);
        return;
      }
      // Check numbers to the left
      let cStart = c - 1;
      while (cStart >= 0 && sheetEval[cellKey(r, cStart)]?.numeric !== null && sheetEval[cellKey(r, cStart)]?.numeric !== undefined) {
        cStart--;
      }
      cStart++;
      if (cStart <= c - 1) {
        const formula = `=${fnName}(${cellKey(r, cStart)}:${cellKey(r, c - 1)})`;
        commitEdit(formula);
        setDraft(formula);
        return;
      }
      setEditing(true);
      setDraft(`=${fnName}()`);
    },
    [sheet, active, sheetEval, commitEdit],
  );

  // Copy / Cut / Paste
  const copySelection = useCallback(
    (cut = false) => {
      if (!sheet) return;
      const minR = Math.min(sel.r1, sel.r2);
      const maxR = Math.max(sel.r1, sel.r2);
      const minC = Math.min(sel.c1, sel.c2);
      const maxC = Math.max(sel.c1, sel.c2);
      const bufCells: ClipboardBuffer["cells"] = {};
      const tsvRows: string[] = [];

      for (let r = minR; r <= maxR; r++) {
        const rowStrings: string[] = [];
        for (let c = minC; c <= maxC; c++) {
          const k = cellKey(r, c);
          const cell = sheet.cells[k] ?? { v: "" };
          const disp = sheetEval[k]?.display ?? cell.v;
          bufCells[`${r - minR}:${c - minC}`] = {
            dr: r - minR,
            dc: c - minC,
            cell: structuredClone(cell),
            evaluatedDisplay: disp,
          };
          rowStrings.push(disp.replace(/\t|\n/g, " "));
        }
        tsvRows.push(rowStrings.join("\t"));
      }
      setClipboardBuf({ sheetId: sheet.id, r1: minR, c1: minC, r2: maxR, c2: maxC, cut, cells: bufCells });
      navigator.clipboard?.writeText(tsvRows.join("\n")).catch(() => {});
    },
    [sheet, sel, sheetEval],
  );

  const pasteSelection = useCallback(
    async (valuesOnly = false) => {
      if (!sheet) return;
      if (clipboardBuf) {
        const baseR = Math.min(sel.r1, sel.r2);
        const baseC = Math.min(sel.c1, sel.c2);
        const shiftR = baseR - clipboardBuf.r1;
        const shiftC = baseC - clipboardBuf.c1;

        updateActiveSheet((s) => {
          const nextCells = { ...s.cells };
          if (clipboardBuf.cut && clipboardBuf.sheetId === s.id) {
            for (let r = clipboardBuf.r1; r <= clipboardBuf.r2; r++) {
              for (let c = clipboardBuf.c1; c <= clipboardBuf.c2; c++) {
                delete nextCells[cellKey(r, c)];
              }
            }
          }
          for (const item of Object.values(clipboardBuf.cells)) {
            const tr = baseR + item.dr;
            const tc = baseC + item.dc;
            const tk = cellKey(tr, tc);
            if (valuesOnly) {
              nextCells[tk] = {
                ...(nextCells[tk] ?? {}),
                v: item.evaluatedDisplay,
              };
            } else {
              const raw = item.cell.v;
              const nextV = raw.startsWith("=") ? shiftFormulaReferences(raw, shiftR, shiftC) : raw;
              nextCells[tk] = {
                v: nextV,
                s: item.cell.s ? structuredClone(item.cell.s) : undefined,
                note: item.cell.note,
              };
            }
          }
          return { ...s, cells: nextCells };
        });
        if (clipboardBuf.cut) setClipboardBuf(null);
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        const lines = text.replace(/\r\n/g, "\n").split("\n");
        if (lines.length && lines[lines.length - 1] === "") lines.pop();
        const baseR = Math.min(sel.r1, sel.r2);
        const baseC = Math.min(sel.c1, sel.c2);
        updateActiveSheet((s) => {
          const nextCells = { ...s.cells };
          lines.forEach((line, dr) => {
            line.split("\t").forEach((val, dc) => {
              const k = cellKey(baseR + dr, baseC + dc);
              nextCells[k] = { ...(nextCells[k] ?? {}), v: val };
            });
          });
          return { ...s, cells: nextCells };
        });
      } catch {
        // Ignore clipboard permission errors
      }
    },
    [sheet, clipboardBuf, sel, updateActiveSheet],
  );

  // Sort active column
  const sortByColumn = useCallback(
    (asc: boolean) => {
      if (!sheet) return;
      const col = active.c;
      const startRow = sheet.frozenRows > 0 ? sheet.frozenRows : 1; // keep header row 1 intact by default
      let maxPopulatedRow = startRow;
      for (const k of Object.keys(sheet.cells)) {
        const p = parseCellRef(k);
        if (p && p.r > maxPopulatedRow) maxPopulatedRow = p.r;
      }
      if (maxPopulatedRow <= startRow) return;

      const rowIndices: number[] = [];
      for (let r = startRow; r <= maxPopulatedRow; r++) rowIndices.push(r);

      rowIndices.sort((ra, rb) => {
        const ea = sheetEval[cellKey(ra, col)];
        const eb = sheetEval[cellKey(rb, col)];
        const va = ea?.value ?? "";
        const vb = eb?.value ?? "";
        if (va === null || va === "") return 1;
        if (vb === null || vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") {
          return asc ? va - vb : vb - va;
        }
        return asc
          ? String(va).localeCompare(String(vb), undefined, { numeric: true })
          : String(vb).localeCompare(String(va), undefined, { numeric: true });
      });

      updateActiveSheet((s) => {
        const nextCells: Record<string, CellData> = {};
        for (const [k, cell] of Object.entries(s.cells)) {
          const p = parseCellRef(k);
          if (p && p.r < startRow) nextCells[k] = cell;
        }
        rowIndices.forEach((oldR, idx) => {
          const newR = startRow + idx;
          const dr = newR - oldR;
          for (let c = 0; c < s.cols; c++) {
            const oldCell = s.cells[cellKey(oldR, c)];
            if (oldCell) {
              const v = oldCell.v.startsWith("=") ? shiftFormulaReferences(oldCell.v, dr, 0) : oldCell.v;
              nextCells[cellKey(newR, c)] = { ...oldCell, v };
            }
          }
        });
        return { ...s, cells: nextCells };
      });
    },
    [sheet, active.c, sheetEval, updateActiveSheet],
  );

  // Auto-fit column width on double click
  const autoFitColumn = useCallback(
    (col: number) => {
      if (!sheet) return;
      let maxChars = 6;
      for (let r = 0; r < sheet.rows; r++) {
        const k = cellKey(r, col);
        const text = sheetEval[k]?.display ?? sheet.cells[k]?.v ?? "";
        if (text.length > maxChars) maxChars = text.length;
      }
      const width = Math.min(360, Math.max(76, maxChars * 9 + 26));
      updateActiveSheet((s) => ({
        ...s,
        colWidths: { ...s.colWidths, [col]: width },
      }));
    },
    [sheet, sheetEval, updateActiveSheet],
  );

  // Import / Export XLSX & CSV
  const exportFile = useCallback(
    async (format: "xlsx" | "csv") => {
      if (!wb || !sheet) return;
      // Loaded on demand so the spreadsheet library stays out of the startup bundle.
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      for (const s of wb.sheets) {
        const evMap = evaluated[s.id] ?? {};
        let maxR = 0;
        let maxC = 0;
        for (const k of Object.keys(s.cells)) {
          const p = parseCellRef(k);
          if (p) {
            if (p.r > maxR) maxR = p.r;
            if (p.c > maxC) maxC = p.c;
          }
        }
        const aoa: (string | number | boolean | null)[][] = [];
        for (let r = 0; r <= maxR; r++) {
          const row: (string | number | boolean | null)[] = [];
          for (let c = 0; c <= maxC; c++) {
            const k = cellKey(r, c);
            const ev = evMap[k];
            row.push(ev ? ev.value : null);
          }
          aoa.push(row);
        }
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // Preserve formulas in exported XLSX
        for (const [k, cell] of Object.entries(s.cells)) {
          if (cell.v.startsWith("=") && ws[k]) {
            ws[k].f = cell.v.slice(1);
          }
        }
        XLSX.utils.book_append_sheet(book, ws, s.name.slice(0, 31));
      }
      const pageTitle = useStore.getState().pages[pageId]?.title || "Spreadsheet";
      if (format === "csv") {
        const ws = book.Sheets[sheet.name.slice(0, 31)];
        const csv = XLSX.utils.sheet_to_csv(ws);
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${pageTitle}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        XLSX.writeFile(book, `${pageTitle}.xlsx`);
      }
    },
    [wb, sheet, evaluated, pageId],
  );

  const importFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv,.tsv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const XLSX = await import("xlsx");
        const book = XLSX.read(buf, { cellFormula: true, cellDates: true });
        const importedSheets: SheetData[] = book.SheetNames.map((name, idx) => {
          const ws = book.Sheets[name];
          const ref = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 30, c: 12 } };
          const rows = Math.max(60, ref.e.r + 15);
          const cols = Math.max(26, ref.e.c + 6);
          const sh = newSheet(name || `Sheet ${idx + 1}`, rows, cols);
          for (let r = ref.s.r; r <= ref.e.r; r++) {
            for (let c = ref.s.c; c <= ref.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cellObj = ws[addr];
              if (!cellObj) continue;
              const k = cellKey(r, c);
              if (cellObj.f) {
                sh.cells[k] = { v: `=${cellObj.f}` };
              } else if (cellObj.v !== undefined && cellObj.v !== null) {
                sh.cells[k] = {
                  v: cellObj.v instanceof Date ? cellObj.v.toISOString().slice(0, 10) : String(cellObj.v),
                };
              }
            }
          }
          return sh;
        });
        if (importedSheets.length > 0) {
          commitWb(() => ({
            sheets: importedSheets,
            activeSheetId: importedSheets[0].id,
          }));
        }
      } catch (e) {
        useStore.getState().toast({ message: errorMessage(e), tone: "error" });
      }
    };
    input.click();
  }, [commitWb]);

  // Function autocomplete list when typing '='
  const formulaSuggestions = useMemo(() => {
    if (!editing || !draft.startsWith("=")) return [];
    const match = draft.match(/([A-Za-z_]{1,16})$/);
    if (!match) return [];
    const q = match[1].toUpperCase();
    return FUNCTION_DOCS.filter((f) => f.name.startsWith(q)).slice(0, 8);
  }, [editing, draft]);

  const applySuggestion = (fnName: string) => {
    const next = draft.replace(/([A-Za-z_]{1,16})$/, `${fnName}(`);
    setDraft(next);
    formulaInputRef.current?.focus();
  };

  // Status bar live aggregations for selected cells
  const statusStats = useMemo(() => {
    if (!sheet) return { count: 0, numCount: 0, sum: 0, avg: 0, min: 0, max: 0 };
    let count = 0;
    const nums: number[] = [];
    for (const { r, c } of selectedCoords) {
      const k = cellKey(r, c);
      const ev = sheetEval[k];
      if (ev && ev.display !== "") {
        count++;
        if (ev.numeric !== null) nums.push(ev.numeric);
      }
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      count,
      numCount: nums.length,
      sum,
      avg: nums.length ? sum / nums.length : 0,
      min: nums.length ? Math.min(...nums) : 0,
      max: nums.length ? Math.max(...nums) : 0,
    };
  }, [sheet, selectedCoords, sheetEval]);

  // Global grid keyboard handler
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (!sheet) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.key === "F1") {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }

    if (editing) {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        setDraft(sheet.cells[cellKey(active.r, active.c)]?.v ?? "");
        gridRef.current?.focus();
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        const cursor = formulaInputRef.current?.selectionStart ?? draft.length;
        const cycled = cycleRefAbsolute(draft, cursor);
        setDraft(cycled.formula);
        return;
      }
      if (e.key === "Tab" && formulaSuggestions.length > 0) {
        e.preventDefault();
        applySuggestion(formulaSuggestions[0].name);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (ctrl) {
          // Ctrl+Enter: Fill all selected cells with draft
          const val = draft;
          updateActiveSheet((s) => {
            const nextCells = { ...s.cells };
            for (const { r, c } of selectedCoords) {
              const k = cellKey(r, c);
              const v = val.startsWith("=") ? shiftFormulaReferences(val, r - active.r, c - active.c) : val;
              nextCells[k] = { ...(nextCells[k] ?? {}), v };
            }
            return { ...s, cells: nextCells };
          });
          setEditing(false);
        } else {
          commitEdit();
          moveSelection(active.r + (e.shiftKey ? -1 : 1), active.c);
        }
        gridRef.current?.focus();
        return;
      }
      return;
    }

    // Shortcuts while navigating grid
    if (ctrl && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "b") {
      e.preventDefault();
      patchSelectionStyle((s) => ({ ...s, bold: !s.bold }));
      return;
    }
    if (ctrl && e.key.toLowerCase() === "i") {
      e.preventDefault();
      patchSelectionStyle((s) => ({ ...s, italic: !s.italic }));
      return;
    }
    if (ctrl && e.key.toLowerCase() === "u") {
      e.preventDefault();
      patchSelectionStyle((s) => ({ ...s, underline: !s.underline }));
      return;
    }
    if (ctrl && e.key === "5") {
      e.preventDefault();
      patchSelectionStyle((s) => ({ ...s, strike: !s.strike }));
      return;
    }
    if (ctrl && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fillDown();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "r") {
      e.preventDefault();
      fillRight();
      return;
    }
    if (ctrl && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection(false);
      return;
    }
    if (ctrl && e.key.toLowerCase() === "x") {
      e.preventDefault();
      copySelection(true);
      return;
    }
    if (ctrl && e.key.toLowerCase() === "v") {
      e.preventDefault();
      void pasteSelection(e.shiftKey);
      return;
    }
    if (ctrl && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFindOpen((v) => !v);
      return;
    }
    if (ctrl && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSel({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 });
      return;
    }
    if (ctrl && e.key === ";") {
      e.preventDefault();
      const now = new Date();
      if (e.shiftKey) {
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        commitEdit(timeStr);
      } else {
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        commitEdit(dateStr);
      }
      return;
    }
    if (e.altKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      insertAutoFunction("SUM");
      return;
    }

    // Navigation keys
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (ctrl) jumpDataEdge(1, 0, e.shiftKey);
      else moveSelection((e.shiftKey ? sel.r2 : active.r) + 1, e.shiftKey ? sel.c2 : active.c, e.shiftKey);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (ctrl) jumpDataEdge(-1, 0, e.shiftKey);
      else moveSelection((e.shiftKey ? sel.r2 : active.r) - 1, e.shiftKey ? sel.c2 : active.c, e.shiftKey);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (ctrl) jumpDataEdge(0, 1, e.shiftKey);
      else moveSelection(e.shiftKey ? sel.r2 : active.r, (e.shiftKey ? sel.c2 : active.c) + 1, e.shiftKey);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (ctrl) jumpDataEdge(0, -1, e.shiftKey);
      else moveSelection(e.shiftKey ? sel.r2 : active.r, (e.shiftKey ? sel.c2 : active.c) - 1, e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      moveSelection(active.r, active.c + (e.shiftKey ? -1 : 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      moveSelection(ctrl ? 0 : active.r, 0, e.shiftKey);
      return;
    }
    if (e.key === "End" && ctrl) {
      e.preventDefault();
      let maxR = 0;
      let maxC = 0;
      for (const k of Object.keys(sheet.cells)) {
        const p = parseCellRef(k);
        if (p) {
          if (p.r > maxR) maxR = p.r;
          if (p.c > maxC) maxC = p.c;
        }
      }
      moveSelection(maxR, maxC, e.shiftKey);
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEditing(true);
      setDraft(sheet.cells[cellKey(active.r, active.c)]?.v ?? "");
      setTimeout(() => formulaInputRef.current?.focus(), 0);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      updateActiveSheet((s) => {
        const nextCells = { ...s.cells };
        for (const { r, c } of selectedCoords) {
          const k = cellKey(r, c);
          if (nextCells[k]) {
            nextCells[k] = { ...nextCells[k], v: "" };
          }
        }
        return { ...s, cells: nextCells };
      });
      return;
    }

    // Printable character starts immediate cell entry
    if (!ctrl && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      setEditing(true);
      setDraft(e.key);
      setTimeout(() => formulaInputRef.current?.focus(), 0);
    }
  };

  // Handle Fill Handle release
  useEffect(() => {
    if (!fillDrag || !sheet) return;
    const onUp = () => {
      const minR = Math.min(sel.r1, sel.r2);
      const maxR = Math.max(sel.r1, sel.r2);
      const minC = Math.min(sel.c1, sel.c2);
      const maxC = Math.max(sel.c1, sel.c2);
      const targetR = fillDrag.r2;
      const targetC = fillDrag.c2;

      if (targetR > maxR) {
        updateActiveSheet((s) => {
          const nextCells = { ...s.cells };
          for (let c = minC; c <= maxC; c++) {
            const srcList = [];
            for (let r = minR; r <= maxR; r++) {
              srcList.push({ r, c, cell: nextCells[cellKey(r, c)] });
            }
            for (let r = maxR + 1; r <= targetR; r++) {
              nextCells[cellKey(r, c)] = generateAutofillValue(srcList, r, c, r - maxR - 1);
            }
          }
          return { ...s, cells: nextCells };
        });
        setSel({ r1: minR, c1: minC, r2: targetR, c2: maxC });
      } else if (targetC > maxC) {
        updateActiveSheet((s) => {
          const nextCells = { ...s.cells };
          for (let r = minR; r <= maxR; r++) {
            const srcList = [];
            for (let c = minC; c <= maxC; c++) {
              srcList.push({ r, c, cell: nextCells[cellKey(r, c)] });
            }
            for (let c = maxC + 1; c <= targetC; c++) {
              nextCells[cellKey(r, c)] = generateAutofillValue(srcList, r, c, c - maxC - 1);
            }
          }
          return { ...s, cells: nextCells };
        });
        setSel({ r1: minR, c1: minC, r2: maxR, c2: targetC });
      }
      setFillDrag(null);
    };
    window.addEventListener("mouseup", onUp, { once: true });
    return () => window.removeEventListener("mouseup", onUp);
  }, [fillDrag, sheet, sel, updateActiveSheet]);

  useEffect(() => {
    const onUp = () => {
      isSelectingRef.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  if (!wb || !sheet) {
    return <div className="view" />;
  }

  const minSelR = Math.min(sel.r1, sel.r2);
  const maxSelR = Math.max(sel.r1, sel.r2);
  const minSelC = Math.min(sel.c1, sel.c2);
  const maxSelC = Math.max(sel.c1, sel.c2);

  // Filter rows if column filter is active
  const visibleRows: number[] = [];
  for (let r = 0; r < sheet.rows; r++) {
    if (sheet.filter?.enabled && r > 0) {
      let pass = true;
      for (const [colStr, q] of Object.entries(sheet.filter.colFilters)) {
        if (!q.trim()) continue;
        const colIdx = Number(colStr);
        const disp = (sheetEval[cellKey(r, colIdx)]?.display ?? "").toLowerCase();
        if (!disp.includes(q.trim().toLowerCase())) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
    }
    visibleRows.push(r);
  }

  return (
    <div className="sheet-shell" onKeyDown={handleGridKeyDown} tabIndex={0} ref={gridRef}>
      {pageMeta && (
        <ResourceHeader
          meta={pageMeta}
          actions={
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                className="chip-btn"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const items: MenuItem[] = WORKBOOK_TEMPLATES.map((t) => ({
                    label: t.title,
                    icon: "template",
                    onSelect: () => commitWb(() => t.build()),
                  }));
                  showMenu(r.left, r.bottom + 4, items);
                }}
              >
                Templates
              </button>
              <button className="chip-btn" onClick={importFile}>
                Import .xlsx / .csv
              </button>
              <button
                className="chip-btn"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  showMenu(r.left, r.bottom + 4, [
                    { label: "Export Excel (.xlsx)", icon: "download", onSelect: () => exportFile("xlsx") },
                    { label: "Export CSV (.csv)", icon: "download", onSelect: () => exportFile("csv") },
                  ]);
                }}
              >
                Export
              </button>
              <button className="chip-btn" onClick={() => setShortcutsOpen(true)} title="Keyboard Shortcuts (F1)">
                Shortcuts
              </button>
            </div>
          }
        />
      )}

      {/* Excel Formatting Ribbon Toolbar */}
      <div className="sheet-toolbar">
        <button className="sheet-tb-btn" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="sheet-tb-btn" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">
          ↷
        </button>
        <span className="sheet-tb-sep" />

        <select
          className="sheet-tb-select"
          value={activeCellStyle.format ?? "auto"}
          onChange={(e) => patchSelectionStyle({ format: e.target.value as NumberFormat })}
          title="Number Format"
        >
          <option value="auto">General / Auto</option>
          <option value="number">Number (1,234.56)</option>
          <option value="integer">Integer (1,235)</option>
          <option value="currency_sar">Currency (SAR 1,234.56)</option>
          <option value="currency_usd">Currency ($1,234.56)</option>
          <option value="accounting">Accounting ((1,234.56))</option>
          <option value="percent">Percent (12.3%)</option>
          <option value="scientific">Scientific (1.23E+03)</option>
        </select>

        <button
          className="sheet-tb-btn"
          title="Decrease Decimals"
          onClick={() => patchSelectionStyle((s) => ({ ...s, decimals: Math.max(0, (s.decimals ?? 2) - 1) }))}
        >
          .0
        </button>
        <button
          className="sheet-tb-btn"
          title="Increase Decimals"
          onClick={() => patchSelectionStyle((s) => ({ ...s, decimals: Math.min(8, (s.decimals ?? 2) + 1) }))}
        >
          .00
        </button>
        <span className="sheet-tb-sep" />

        <button
          className={`sheet-tb-btn ${activeCellStyle.bold ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle((s) => ({ ...s, bold: !s.bold }))}
          title="Bold (Ctrl+B)"
        >
          <b>B</b>
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.italic ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle((s) => ({ ...s, italic: !s.italic }))}
          title="Italic (Ctrl+I)"
        >
          <i>I</i>
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.underline ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle((s) => ({ ...s, underline: !s.underline }))}
          title="Underline (Ctrl+U)"
        >
          <u>U</u>
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.strike ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle((s) => ({ ...s, strike: !s.strike }))}
          title="Strikethrough (Ctrl+5)"
        >
          <s>S</s>
        </button>

        {/* Text Color */}
        <button
          className="sheet-tb-btn"
          title="Text Color"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu(
              r.left,
              r.bottom + 4,
              TEXT_COLORS.map((col) => ({
                label: col,
                onSelect: () => patchSelectionStyle({ color: col }),
              })),
            );
          }}
        >
          <span style={{ borderBottom: `3px solid ${activeCellStyle.color ?? "#1e293b"}`, fontWeight: 700 }}>A</span>
        </button>

        {/* Fill Color */}
        <button
          className="sheet-tb-btn"
          title="Cell Background Fill"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu(
              r.left,
              r.bottom + 4,
              FILL_COLORS.map((bg) => ({
                label: bg === "transparent" ? "No Fill" : bg,
                onSelect: () => patchSelectionStyle({ bg: bg === "transparent" ? undefined : bg }),
              })),
            );
          }}
        >
          🎨
        </button>
        <span className="sheet-tb-sep" />

        <button
          className={`sheet-tb-btn ${activeCellStyle.align === "left" ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle({ align: "left" })}
          title="Align Left"
        >
          ⇤
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.align === "center" ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle({ align: "center" })}
          title="Align Center"
        >
          ⇔
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.align === "right" ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle({ align: "right" })}
          title="Align Right"
        >
          ⇥
        </button>
        <button
          className={`sheet-tb-btn ${activeCellStyle.wrap ? "is-on" : ""}`}
          onClick={() => patchSelectionStyle((s) => ({ ...s, wrap: !s.wrap }))}
          title="Wrap Text"
        >
          ↵
        </button>
        <span className="sheet-tb-sep" />

        <button
          className="sheet-tb-btn"
          onClick={() => insertAutoFunction("SUM")}
          title="AutoSum (Alt+=)"
        >
          ∑ AutoSum
        </button>
        <button className="sheet-tb-btn" onClick={() => sortByColumn(true)} title="Sort Column A → Z">
          A↓Z
        </button>
        <button className="sheet-tb-btn" onClick={() => sortByColumn(false)} title="Sort Column Z → A">
          Z↓A
        </button>
        <button
          className={`sheet-tb-btn ${sheet.filter?.enabled ? "is-on" : ""}`}
          onClick={() =>
            updateActiveSheet((s) => ({
              ...s,
              filter: { enabled: !s.filter?.enabled, colFilters: s.filter?.colFilters ?? {} },
            }))
          }
          title="Toggle AutoFilter"
        >
          ⏳ Filter
        </button>
        <button
          className={`sheet-tb-btn ${sheet.frozenRows > 0 || sheet.frozenCols > 0 ? "is-on" : ""}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu(r.left, r.bottom + 4, [
              { label: "Freeze Top Row", onSelect: () => updateActiveSheet((s) => ({ ...s, frozenRows: 1 })) },
              { label: "Freeze First Column", onSelect: () => updateActiveSheet((s) => ({ ...s, frozenCols: 1 })) },
              {
                label: `Freeze up to ${cellKey(active.r, active.c)}`,
                onSelect: () => updateActiveSheet((s) => ({ ...s, frozenRows: active.r, frozenCols: active.c })),
              },
              { label: "Unfreeze Panes", onSelect: () => updateActiveSheet((s) => ({ ...s, frozenRows: 0, frozenCols: 0 })) },
            ]);
          }}
          title="Freeze Panes"
        >
          ❄️ Freeze
        </button>
        <span className="sheet-tb-sep" />

        <button
          className="sheet-tb-btn"
          onClick={() => updateActiveSheet((s) => shiftSheetStructure(s, "row", active.r, 1))}
          title="Insert Row Above"
        >
          +Row
        </button>
        <button
          className="sheet-tb-btn"
          onClick={() => updateActiveSheet((s) => shiftSheetStructure(s, "col", active.c, 1))}
          title="Insert Column Left"
        >
          +Col
        </button>
        <button
          className="sheet-tb-btn"
          onClick={() => setFindOpen((v) => !v)}
          title="Find & Replace (Ctrl+F)"
        >
          🔍
        </button>
      </div>

      {/* Find & Replace Bar */}
      {findOpen && (
        <div className="sheet-find-bar">
          <input
            className="sheet-find-input"
            placeholder="Find in sheet…"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && findQuery.trim()) {
                const q = findQuery.toLowerCase();
                for (let r = 0; r < sheet.rows; r++) {
                  for (let c = 0; c < sheet.cols; c++) {
                    if (r < active.r || (r === active.r && c <= active.c)) continue;
                    const k = cellKey(r, c);
                    const txt = `${sheet.cells[k]?.v ?? ""} ${sheetEval[k]?.display ?? ""}`.toLowerCase();
                    if (txt.includes(q)) {
                      moveSelection(r, c);
                      return;
                    }
                  }
                }
              }
            }}
          />
          <input
            className="sheet-find-input"
            placeholder="Replace with…"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            className="chip-btn"
            onClick={() => {
              if (!findQuery) return;
              updateActiveSheet((s) => {
                const nextCells = { ...s.cells };
                for (const [k, cell] of Object.entries(nextCells)) {
                  if (cell.v.includes(findQuery)) {
                    nextCells[k] = { ...cell, v: cell.v.split(findQuery).join(replaceQuery) };
                  }
                }
                return { ...s, cells: nextCells };
              });
            }}
          >
            Replace All
          </button>
          <button className="chip-btn" onClick={() => setFindOpen(false)}>
            Close
          </button>
        </div>
      )}

      {/* Name Box & Formula Bar (fx) */}
      <div className="sheet-formula-bar">
        <input
          className="sheet-name-box"
          value={nameBoxText}
          onChange={(e) => setNameBoxText(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              const parts = nameBoxText.split(":");
              const p1 = parseCellRef(parts[0]);
              const p2 = parts[1] ? parseCellRef(parts[1]) : p1;
              if (p1 && p2) {
                setActive({ r: p1.r, c: p1.c });
                setSel({ r1: p1.r, c1: p1.c, r2: p2.r, c2: p2.c });
                gridRef.current?.focus();
              }
            }
          }}
          title="Name Box — type A1 or A1:D10 and press Enter"
        />
        <button
          className="sheet-fx-btn"
          title="Insert Function"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu(
              r.left,
              r.bottom + 4,
              FUNCTION_DOCS.slice(0, 18).map((fn) => ({
                label: `${fn.name} — ${fn.summary}`,
                onSelect: () => {
                  setEditing(true);
                  setDraft((d) => (d.startsWith("=") ? `${d}${fn.name}(` : `=${fn.name}(`));
                  setTimeout(() => formulaInputRef.current?.focus(), 0);
                },
              })),
            );
          }}
        >
          fx
        </button>
        <div className="sheet-formula-input-wrap">
          <input
            ref={formulaInputRef}
            className="sheet-formula-input bidi"
            value={draft}
            placeholder="Enter value or formula (=SUM(A1:A10), =IF(B2>100, ...), =VLOOKUP(...))"
            onFocus={() => setEditing(true)}
            onChange={(e) => {
              setEditing(true);
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape" || e.key === "F4" || (e.key === "Tab" && formulaSuggestions.length > 0)) {
                handleGridKeyDown(e);
              } else {
                e.stopPropagation();
              }
            }}
          />
          {formulaSuggestions.length > 0 && (
            <div className="sheet-fn-popup">
              {formulaSuggestions.map((fn) => (
                <button
                  key={fn.name}
                  className="sheet-fn-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(fn.name);
                  }}
                >
                  <span className="sheet-fn-sig">{fn.signature}</span>
                  <span className="sheet-fn-desc">{fn.summary}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Grid Viewport */}
      <div className="sheet-grid-viewport">
        <table className="sheet-table">
          <thead>
            <tr>
              <th
                className="sheet-corner"
                onClick={() => setSel({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 })}
                title="Select All (Ctrl+A)"
              >
                ◢
              </th>
              {Array.from({ length: sheet.cols }, (_, c) => {
                const w = sheet.colWidths[c] ?? 108;
                const isSelectedCol = c >= minSelC && c <= maxSelC;
                return (
                  <th
                    key={c}
                    className={`sheet-col-hdr ${isSelectedCol ? "is-selected" : ""}`}
                    style={{ width: w, minWidth: w, maxWidth: w }}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSel((prev) => ({ ...prev, r1: 0, r2: sheet.rows - 1, c2: c }));
                      } else {
                        setActive({ r: 0, c });
                        setSel({ r1: 0, c1: c, r2: sheet.rows - 1, c2: c });
                      }
                    }}
                    onDoubleClick={() => autoFitColumn(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showMenu(e.clientX, e.clientY, [
                        { label: "Sort A → Z", onSelect: () => sortByColumn(true) },
                        { label: "Sort Z → A", onSelect: () => sortByColumn(false) },
                        { label: "Auto-fit Column Width", onSelect: () => autoFitColumn(c) },
                        { kind: "separator" },
                        { label: "Insert Column Left", onSelect: () => updateActiveSheet((s) => shiftSheetStructure(s, "col", c, 1)) },
                        { label: "Delete Column", danger: true, onSelect: () => updateActiveSheet((s) => shiftSheetStructure(s, "col", c, -1)) },
                      ]);
                    }}
                  >
                    <span>{colToName(c)}</span>
                    <span
                      className="sheet-col-resizer"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startW = w;
                        const onMove = (me: MouseEvent) => {
                          const nw = Math.max(52, Math.min(480, startW + (me.clientX - startX)));
                          updateActiveSheet((s) => ({ ...s, colWidths: { ...s.colWidths, [c]: nw } }), false);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                    />
                  </th>
                );
              })}
            </tr>
            {sheet.filter?.enabled && (
              <tr className="sheet-filter-row">
                <th className="sheet-row-hdr">⏳</th>
                {Array.from({ length: sheet.cols }, (_, c) => (
                  <th key={c} style={{ padding: 2 }}>
                    <input
                      className="sheet-filter-input"
                      placeholder="Filter…"
                      value={sheet.filter?.colFilters[c] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateActiveSheet((s) => ({
                          ...s,
                          filter: {
                            enabled: true,
                            colFilters: { ...(s.filter?.colFilters ?? {}), [c]: val },
                          },
                        }));
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const isSelectedRow = r >= minSelR && r <= maxSelR;
              const isFrozenRow = r < sheet.frozenRows;
              return (
                <tr key={r} className={isFrozenRow ? "is-frozen-row" : ""}>
                  <td
                    className={`sheet-row-hdr ${isSelectedRow ? "is-selected" : ""}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSel((prev) => ({ ...prev, c1: 0, c2: sheet.cols - 1, r2: r }));
                      } else {
                        setActive({ r, c: 0 });
                        setSel({ r1: r, c1: 0, r2: r, c2: sheet.cols - 1 });
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showMenu(e.clientX, e.clientY, [
                        { label: "Insert Row Above", onSelect: () => updateActiveSheet((s) => shiftSheetStructure(s, "row", r, 1)) },
                        { label: "Delete Row", danger: true, onSelect: () => updateActiveSheet((s) => shiftSheetStructure(s, "row", r, -1)) },
                      ]);
                    }}
                  >
                    {r + 1}
                  </td>
                  {Array.from({ length: sheet.cols }, (_, c) => {
                    const k = cellKey(r, c);
                    const cell = sheet.cells[k];
                    const ev = sheetEval[k];
                    const st = cell?.s;
                    const isActive = active.r === r && active.c === c;
                    const inSelection = r >= minSelR && r <= maxSelR && c >= minSelC && c <= maxSelC;
                    const inFillPreview =
                      fillDrag &&
                      r >= minSelR &&
                      r <= Math.max(maxSelR, fillDrag.r2) &&
                      c >= minSelC &&
                      c <= Math.max(maxSelC, fillDrag.c2);
                    const showFillHandle = isActive || (r === maxSelR && c === maxSelC && inSelection);
                    const cond = conditionalStyle(sheet.conditionalRules, r, c, ev);

                    const textAlign =
                      st?.align ?? (ev?.numeric !== null && ev?.numeric !== undefined ? "right" : "left");

                    return (
                      <td
                        key={c}
                        className={[
                          "sheet-cell",
                          isActive ? "is-active" : "",
                          inSelection ? "is-in-sel" : "",
                          inFillPreview ? "is-fill-preview" : "",
                          ev?.error ? "is-error" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          fontWeight: st?.bold ? 700 : 400,
                          fontStyle: st?.italic ? "italic" : "normal",
                          textDecoration: [st?.underline ? "underline" : "", st?.strike ? "line-through" : ""]
                            .filter(Boolean)
                            .join(" "),
                          color: ev?.error ? "#dc2626" : (cond?.color ?? st?.color),
                          backgroundColor: cond?.bg ?? st?.bg,
                          textAlign,
                          whiteSpace: st?.wrap ? "normal" : "nowrap",
                        }}
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          // Point-and-click cell reference insertion when typing a formula
                          if (editing && draft.startsWith("=") && /[=(,+\-*/^&:]$/.test(draft.trim())) {
                            e.preventDefault();
                            setDraft((d) => `${d}${k}`);
                            return;
                          }
                          if (editing && (active.r !== r || active.c !== c)) {
                            commitEdit();
                          }
                          isSelectingRef.current = true;
                          if (e.shiftKey) {
                            setSel((prev) => ({ ...prev, r2: r, c2: c }));
                          } else {
                            setActive({ r, c });
                            setSel({ r1: r, c1: c, r2: r, c2: c });
                          }
                        }}
                        onMouseEnter={() => {
                          if (fillDrag) {
                            setFillDrag({ r2: r, c2: c });
                          } else if (isSelectingRef.current) {
                            setSel((prev) => ({ ...prev, r2: r, c2: c }));
                          }
                        }}
                        onDoubleClick={() => {
                          setActive({ r, c });
                          setSel({ r1: r, c1: c, r2: r, c2: c });
                          setEditing(true);
                          setDraft(cell?.v ?? "");
                          setTimeout(() => formulaInputRef.current?.focus(), 0);
                        }}
                      >
                        {isActive && editing ? (
                          <input
                            className="sheet-inline-editor bidi"
                            value={draft}
                            autoFocus
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={handleGridKeyDown}
                          />
                        ) : (
                          <span className="sheet-cell-text bidi">{ev ? ev.display : cell?.v ?? ""}</span>
                        )}
                        {showFillHandle && !editing && (
                          <span
                            className="sheet-fill-handle"
                            title="Drag to Autofill Series or Formulas"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setFillDrag({ r2: maxSelR, c2: maxSelC });
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom Sheet Tabs & Live Excel Status Bar */}
      <div className="sheet-footer">
        <div className="sheet-tabs">
          {wb.sheets.map((s) => (
            <button
              key={s.id}
              className={`sheet-tab ${s.id === wb.activeSheetId ? "is-active" : ""}`}
              style={s.color ? { borderBottom: `3px solid ${s.color}` } : undefined}
              onClick={() => {
                if (editing) commitEdit();
                commitWb((prev) => ({ ...prev, activeSheetId: s.id }), false);
              }}
              onDoubleClick={async () => {
                const name = await promptText({ title: "Rename Sheet", initial: s.name, placeholder: "Sheet name" });
                if (name && name.trim()) {
                  commitWb((prev) => ({
                    ...prev,
                    sheets: prev.sheets.map((sh) => (sh.id === s.id ? { ...sh, name: name.trim() } : sh)),
                  }));
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                showMenu(e.clientX, e.clientY, [
                  {
                    label: "Rename Sheet",
                    icon: "edit",
                    onSelect: async () => {
                      const name = await promptText({ title: "Rename Sheet", initial: s.name, placeholder: "Sheet name" });
                      if (name && name.trim()) {
                        commitWb((prev) => ({
                          ...prev,
                          sheets: prev.sheets.map((sh) => (sh.id === s.id ? { ...sh, name: name.trim() } : sh)),
                        }));
                      }
                    },
                  },
                  {
                    label: "Duplicate Sheet",
                    icon: "duplicate",
                    onSelect: () => {
                      commitWb((prev) => {
                        const copy: SheetData = {
                          ...structuredClone(s),
                          id: `sh_${Math.random().toString(36).slice(2, 10)}`,
                          name: `${s.name} Copy`,
                        };
                        return {
                          ...prev,
                          sheets: [...prev.sheets, copy],
                          activeSheetId: copy.id,
                        };
                      });
                    },
                  },
                  {
                    label: "Delete Sheet",
                    icon: "delete",
                    danger: true,
                    onSelect: async () => {
                      if (wb.sheets.length <= 1) return;
                      if (await confirmDialog({ title: "Delete sheet?", message: `Delete "${s.name}"?`, confirm: "Delete", danger: true })) {
                        commitWb((prev) => {
                          const remaining = prev.sheets.filter((sh) => sh.id !== s.id);
                          return {
                            ...prev,
                            sheets: remaining,
                            activeSheetId: prev.activeSheetId === s.id ? remaining[0].id : prev.activeSheetId,
                          };
                        });
                      }
                    },
                  },
                ]);
              }}
            >
              {s.name}
            </button>
          ))}
          <button
            className="sheet-tab-add"
            title="Add Sheet"
            onClick={() => {
              commitWb((prev) => {
                const ns = newSheet(`Sheet ${prev.sheets.length + 1}`);
                return {
                  ...prev,
                  sheets: [...prev.sheets, ns],
                  activeSheetId: ns.id,
                };
              });
            }}
          >
            <Icon name="add" size={14} />
          </button>
        </div>

        <div className="sheet-status-stats">
          <span>Cells: <b>{statusStats.count}</b></span>
          {statusStats.numCount > 0 && (
            <>
              <span>Sum: <b>{formatScalar(statusStats.sum, { format: "number", decimals: 2 })}</b></span>
              <span>Average: <b>{formatScalar(statusStats.avg, { format: "number", decimals: 2 })}</b></span>
              <span>Min: <b>{formatScalar(statusStats.min)}</b></span>
              <span>Max: <b>{formatScalar(statusStats.max)}</b></span>
            </>
          )}
        </div>
      </div>

      {/* Shortcuts Help Modal */}
      {shortcutsOpen && (
        <Modal onClose={() => setShortcutsOpen(false)} title="Excel Spreadsheet Shortcuts (اختصارات الجداول)" width={560}>
          <div className="sheet-shortcuts-list">
            <div><kbd>Enter</kbd> / <kbd>F2</kbd> — Edit active cell inline / Commit & move down</div>
            <div><kbd>Ctrl + Enter</kbd> — Fill all selected cells with current input/formula</div>
            <div><kbd>Alt + =</kbd> — AutoSum (`=SUM(...)` of adjacent numbers)</div>
            <div><kbd>F4</kbd> (while editing formula) — Cycle `$A$1` → `A$1` → `$A1` → `A1`</div>
            <div><kbd>Ctrl + D</kbd> / <kbd>Ctrl + R</kbd> — Fill Down / Fill Right</div>
            <div><kbd>Ctrl + ;</kbd> / <kbd>Ctrl + Shift + ;</kbd> — Insert current Date / Time</div>
            <div><kbd>Ctrl + Arrows</kbd> — Jump to edge of data region</div>
            <div><kbd>Shift + Arrows</kbd> — Extend cell selection</div>
            <div><kbd>Ctrl + C</kbd> / <kbd>Ctrl + X</kbd> / <kbd>Ctrl + V</kbd> — Copy / Cut / Paste (Excel TSV compatible)</div>
            <div><kbd>Ctrl + Shift + V</kbd> — Paste Values Only (without formulas)</div>
            <div><kbd>Ctrl + B</kbd> / <kbd>Ctrl + I</kbd> / <kbd>Ctrl + U</kbd> / <kbd>Ctrl + 5</kbd> — Bold / Italic / Underline / Strikethrough</div>
            <div><kbd>Ctrl + Z</kbd> / <kbd>Ctrl + Y</kbd> — Undo / Redo</div>
            <div><kbd>Ctrl + F</kbd> — Find & Replace in sheet</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
