//#region \0@oxc-project+runtime@0.152.0/helpers/esm/typeof.js
function e(t) {
	"@babel/helpers - typeof";
	return e = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
		return typeof e;
	} : function(e) {
		return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
	}, e(t);
}
//#endregion
//#region \0@oxc-project+runtime@0.152.0/helpers/esm/toPrimitive.js
function t(t, n) {
	if (e(t) != "object" || !t) return t;
	var r = t[Symbol.toPrimitive];
	if (r !== void 0) {
		var i = r.call(t, n || "default");
		if (e(i) != "object") return i;
		throw TypeError("@@toPrimitive must return a primitive value.");
	}
	return (n === "string" ? String : Number)(t);
}
//#endregion
//#region \0@oxc-project+runtime@0.152.0/helpers/esm/toPropertyKey.js
function n(n) {
	var r = t(n, "string");
	return e(r) == "symbol" ? r : r + "";
}
//#endregion
//#region \0@oxc-project+runtime@0.152.0/helpers/esm/defineProperty.js
function r(e, t, r) {
	return (t = n(t)) in e ? Object.defineProperty(e, t, {
		value: r,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[t] = r, e;
}
//#endregion
//#region ../src/spreadsheet/engine.ts
function i(e) {
	let t = e + 1, n = "";
	for (; t > 0;) {
		let e = (t - 1) % 26;
		n = String.fromCharCode(65 + e) + n, t = Math.floor((t - 1) / 26);
	}
	return n;
}
function a(e) {
	let t = e.toUpperCase().replace(/[^A-Z]/g, ""), n = 0;
	for (let e = 0; e < t.length; e++) n = n * 26 + (t.charCodeAt(e) - 64);
	return n - 1;
}
function o(e, t) {
	return `${i(t)}${e + 1}`;
}
var s = /^(?:(?:'([^']+)'|([A-Za-z0-9_\u0600-\u06FF]+))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})$/;
function c(e) {
	let t = e.trim().match(s);
	if (!t) return null;
	let n = t[1] || t[2] || void 0, r = t[3] === "$", i = a(t[4]), o = t[5] === "$", c = parseInt(t[6], 10) - 1;
	return c < 0 || i < 0 || c > 99999 || i > 16384 ? null : {
		sheet: n,
		r: c,
		c: i,
		absR: o,
		absC: r
	};
}
function l(e = "Sheet 1", t = 60, n = 26) {
	return {
		id: `sh_${Math.random().toString(36).slice(2, 10)}`,
		name: e,
		rows: t,
		cols: n,
		cells: {},
		colWidths: {},
		rowHeights: {},
		frozenRows: 0,
		frozenCols: 0,
		merges: [],
		conditionalRules: []
	};
}
function u() {
	let e = l("Sheet 1");
	return {
		sheets: [e],
		activeSheetId: e.id
	};
}
var d = class extends Error {
	constructor(e) {
		super(e), r(this, "code", void 0), this.code = e;
	}
};
function f(e) {
	let t = [];
	for (let n of e) if (Array.isArray(n)) for (let e of n) for (let n of e) t.push(n);
	else t.push(n);
	return t;
}
function p(e, t = !1) {
	if (typeof e == "number") return e;
	if (typeof e == "boolean") return +!!e;
	if (e === null || e === "") return 0;
	let n = x(String(e)).replace(/,/g, "").trim();
	if (n.endsWith("%")) {
		let e = Number(n.slice(0, -1));
		if (!Number.isNaN(e)) return e / 100;
	}
	let r = Number(n);
	if (Number.isNaN(r)) {
		if (t) throw new d("#VALUE!");
		return 0;
	}
	return r;
}
function m(e) {
	let t = [];
	for (let n of e) if (Array.isArray(n)) {
		for (let e of n) for (let n of e) if (typeof n == "number" && Number.isFinite(n)) t.push(n);
		else if (typeof n == "string" && n.trim() !== "") {
			let e = Number(n.replace(/,/g, ""));
			Number.isNaN(e) || t.push(e);
		}
	} else if (typeof n == "number" && Number.isFinite(n)) t.push(n);
	else if (typeof n == "boolean") t.push(+!!n);
	else if (typeof n == "string" && n.trim() !== "") {
		let e = Number(n.replace(/,/g, ""));
		Number.isNaN(e) || t.push(e);
	}
	return t;
}
function h(e) {
	if (typeof e == "number") return (t) => {
		let n = typeof t == "number" ? t : Number(String(t ?? "").replace(/,/g, ""));
		return !Number.isNaN(n) && n === e;
	};
	if (typeof e == "boolean") return (t) => !!t === e;
	let t = String(e ?? "").trim(), n = t.match(/^(<=|>=|<>|!=|<|>|=)(.*)$/);
	if (n) {
		let e = n[1], t = n[2].trim(), r = t === "" ? NaN : Number(t.replace(/,/g, "")), i = !Number.isNaN(r);
		return (n) => {
			let a = typeof n == "number" ? n : n !== null && String(n).trim() !== "" ? Number(String(n).replace(/,/g, "")) : NaN;
			if (i && !Number.isNaN(a)) {
				if (e === ">") return a > r;
				if (e === ">=") return a >= r;
				if (e === "<") return a < r;
				if (e === "<=") return a <= r;
				if (e === "=") return a === r;
				if (e === "<>" || e === "!=") return a !== r;
			}
			let o = String(n ?? "").toLowerCase(), s = t.toLowerCase();
			return e === "=" ? o === s : e === "<>" || e === "!=" ? o !== s : e === ">" ? o > s : e === ">=" ? o >= s : e === "<" ? o < s : e === "<=" && o <= s;
		};
	}
	if (t.includes("*") || t.includes("?")) {
		let e = RegExp("^" + t.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
		return (t) => e.test(String(t ?? ""));
	}
	let r = t === "" ? NaN : Number(t.replace(/,/g, ""));
	return Number.isNaN(r) ? (e) => String(e ?? "").toLowerCase() === t.toLowerCase() : (e) => {
		let n = typeof e == "number" ? e : Number(String(e ?? "").replace(/,/g, ""));
		return !Number.isNaN(n) && n === r || String(e ?? "").toLowerCase() === t.toLowerCase();
	};
}
function g(e) {
	if (typeof e == "number") {
		if (e > 1e10) return new Date(e);
		let t = new Date(Date.UTC(1899, 11, 30));
		return new Date(t.getTime() + e * 864e5);
	}
	let t = new Date(String(e ?? ""));
	if (Number.isNaN(t.getTime())) throw new d("#VALUE!");
	return t;
}
function _(e) {
	let t = [], n = 0;
	for (; n < e.length;) {
		let r = e[n];
		if (/\s/.test(r)) {
			n++;
			continue;
		}
		if (r === "\"") {
			let r = "";
			for (n++; n < e.length;) if (e[n] === "\"" && e[n + 1] === "\"") r += "\"", n += 2;
			else if (e[n] === "\"") {
				n++;
				break;
			} else r += e[n++];
			t.push({
				type: "str",
				value: r
			});
			continue;
		}
		if (r === "(" || r === ")") {
			t.push({
				type: "paren",
				value: r
			}), n++;
			continue;
		}
		if (r === "," || r === ";" || r === "،" || r === "؛") {
			t.push({ type: "comma" }), n++;
			continue;
		}
		if (r === "٪") {
			t.push({
				type: "op",
				value: "%"
			}), n++;
			continue;
		}
		let i = e.slice(n, n + 2);
		if ([
			"<=",
			">=",
			"<>",
			"!="
		].includes(i)) {
			t.push({
				type: "op",
				value: i
			}), n += 2;
			continue;
		}
		if ([
			"+",
			"-",
			"*",
			"/",
			"^",
			"&",
			"=",
			"<",
			">",
			":",
			"%"
		].includes(r)) {
			t.push({
				type: "op",
				value: r
			}), n++;
			continue;
		}
		if (/[\d٠-٩۰-۹]/.test(r) || /[.٫]/.test(r) && /[\d٠-٩۰-۹]/.test(e[n + 1] ?? "")) {
			let r = "";
			for (; n < e.length && /[\d٠-٩۰-۹.٫eE+-]/.test(e[n]) && (e[n] !== "+" && e[n] !== "-" || /[eE]/.test(r[r.length - 1] ?? ""));) r += x(e[n++]);
			let i = Number(r);
			if (Number.isNaN(i)) throw new d("#VALUE!");
			t.push({
				type: "num",
				value: i
			});
			continue;
		}
		if (r === "'" || /[A-Za-z_$\u0600-\u06FF#]/.test(r)) {
			let i = "";
			if (r === "'") {
				for (i += e[n++]; n < e.length && e[n] !== "'";) i += e[n++];
				n < e.length && (i += e[n++]);
			}
			for (; n < e.length && /[A-Za-z0-9_$!.?\u0600-\u060B\u060D-\u061A\u061C-\u0669\u066D-\u06FF]/.test(e[n]);) i += e[n++];
			t.push({
				type: "ident",
				value: i
			});
			continue;
		}
		throw new d("#VALUE!");
	}
	return t;
}
function v(e) {
	let t = {}, n = /* @__PURE__ */ new Set();
	for (let n of e.sheets) t[n.id] = {};
	let r = (t) => {
		if (!t) return e.sheets.find((t) => t.id === e.activeSheetId) ?? e.sheets[0];
		let n = t.toLowerCase();
		return e.sheets.find((e) => e.id === t || e.name.toLowerCase() === n);
	}, i = (e, r, i) => {
		let s = o(r, i), c = t[e.id]?.[s];
		if (c) return c;
		let l = `${e.id}:${s}`;
		if (n.has(l)) throw new d("#CYCLE!");
		let u = e.cells[s], f = u?.v ?? "", p = u?.s;
		if (!f.startsWith("=")) {
			let n = te(f), r = typeof n == "number" ? n : null, i = {
				raw: f,
				value: n,
				display: S(n, p),
				error: null,
				isFormula: !1,
				numeric: r
			};
			return t[e.id][s] = i, i;
		}
		n.add(l);
		try {
			let n = a(f.slice(1).trim(), e, r, i), o = Array.isArray(n) ? n[0]?.[0] ?? null : n;
			if (typeof o == "string" && o.startsWith("#") && /[!/?]$/.test(o)) {
				let n = {
					raw: f,
					value: o,
					display: o,
					error: o,
					isFormula: !0,
					numeric: null
				};
				return t[e.id][s] = n, n;
			}
			let c = typeof o == "number" && Number.isFinite(o) ? o : null, l = {
				raw: f,
				value: o,
				display: S(o, p),
				error: null,
				isFormula: !0,
				numeric: c
			};
			return t[e.id][s] = l, l;
		} catch (n) {
			let r = n instanceof d ? n.code : "#ERROR!", i = {
				raw: f,
				value: r,
				display: r,
				error: r,
				isFormula: !0,
				numeric: null
			};
			return t[e.id][s] = i, i;
		} finally {
			n.delete(l);
		}
	};
	function a(e, t, n, a) {
		let o = _(e), s = 0, l = () => o[s], u = () => o[s++];
		function f() {
			let e = m();
			for (; l()?.type === "op" && [
				"=",
				"<>",
				"!=",
				"<",
				"<=",
				">",
				">="
			].includes(l().value);) {
				let t = u().value, n = m();
				e = b(y(e), y(n), t);
			}
			return e;
		}
		function m() {
			let e = h();
			for (; l()?.type === "op" && l().value === "&";) {
				u();
				let t = h();
				e = `${y(e) ?? ""}${y(t) ?? ""}`;
			}
			return e;
		}
		function h() {
			let e = g();
			for (; l()?.type === "op" && ["+", "-"].includes(l().value);) {
				let t = u().value, n = g(), r = p(y(e), !0), i = p(y(n), !0);
				e = t === "+" ? r + i : r - i;
			}
			return e;
		}
		function g() {
			let e = v();
			for (; l()?.type === "op" && ["*", "/"].includes(l().value);) {
				let t = u().value, n = v(), r = p(y(e), !0), i = p(y(n), !0);
				if (t === "/") {
					if (i === 0) throw new d("#DIV/0!");
					e = r / i;
				} else e = r * i;
			}
			return e;
		}
		function v() {
			let e = x();
			for (; l()?.type === "op" && l().value === "^";) {
				u();
				let t = x();
				e = p(y(e), !0) ** +p(y(t), !0);
			}
			return e;
		}
		function x() {
			if (l()?.type === "op" && ["+", "-"].includes(l().value)) {
				let e = u().value, t = p(y(x()), !0);
				return e === "-" ? -t : t;
			}
			let e = te();
			for (; l()?.type === "op" && l().value === "%";) u(), e = p(y(e), !0) / 100;
			return e;
		}
		function te() {
			if (l()?.type === "ident" && o[s + 1]?.type === "op" && o[s + 1].value === ":") {
				let e = u();
				u();
				let n = u();
				if (!n || n.type !== "ident") throw new d("#REF!");
				let a = c(e.value), o = c(n.value);
				if (!a || !o) throw new d("#REF!");
				let s = a.sheet ? r(a.sheet) : t;
				if (!s) throw new d("#REF!");
				let l = Math.min(a.r, o.r), f = Math.max(a.r, o.r), p = Math.min(a.c, o.c), m = Math.max(a.c, o.c), h = [];
				for (let e = l; e <= f; e++) {
					let t = [];
					for (let n = p; n <= m; n++) {
						let r = i(s, e, n);
						if (r.error) throw new d(r.error);
						t.push(r.value);
					}
					h.push(t);
				}
				return h;
			}
			return S();
		}
		function S() {
			let e = l();
			if (!e) throw new d("#VALUE!");
			if (e.type === "num" || e.type === "str") return u(), e.value;
			if (e.type === "paren" && e.value === "(") {
				u();
				let e = f(), t = u();
				if (!t || t.type !== "paren" || t.value !== ")") throw new d("#VALUE!");
				return e;
			}
			if (e.type === "ident") {
				u();
				let o = e.value, s = o.toUpperCase();
				if (l()?.type === "paren" && l().value === "(") {
					if (u(), s === "IF") {
						let e = f();
						if (l()?.type !== "comma") throw new d("#VALUE!");
						if (u(), y(e)) {
							let e = f();
							return l()?.type === "comma" && (u(), C()), w(), e;
						}
						{
							C();
							let e = !1;
							return l()?.type === "comma" && (u(), e = f()), w(), e;
						}
					}
					if (s === "IFERROR" || s === "IFNA") {
						let e, t = null;
						try {
							e = f();
						} catch (n) {
							t = n instanceof d ? n.code : "#ERROR!", e = null;
						}
						if (l()?.type !== "comma") throw new d("#VALUE!");
						u();
						let n = f();
						if (w(), t) {
							if (s === "IFNA" && t !== "#N/A") throw new d(t);
							return n;
						}
						return e;
					}
					let e = [];
					if (l()?.type !== "paren" || l().value !== ")") for (; e.push(f()), l()?.type === "comma";) u();
					return w(), ee(s, e, n, a);
				}
				if (s === "TRUE") return !0;
				if (s === "FALSE") return !1;
				if (s.startsWith("#")) throw new d(s);
				let p = c(o);
				if (p) {
					let e = p.sheet ? r(p.sheet) : t;
					if (!e) throw new d("#REF!");
					let n = i(e, p.r, p.c);
					if (n.error) throw new d(n.error);
					return n.value;
				}
				throw new d("#NAME?");
			}
			throw new d("#VALUE!");
		}
		function C() {
			let e = 0;
			for (; s < o.length;) {
				let t = o[s];
				if (t.type === "paren" && t.value === "(") e++;
				else if (t.type === "paren" && t.value === ")") {
					if (e === 0) break;
					e--;
				} else if (t.type === "comma" && e === 0) break;
				s++;
			}
		}
		function w() {
			let e = u();
			if (!e || e.type !== "paren" || e.value !== ")") throw new d("#VALUE!");
		}
		let T = f();
		if (s < o.length) throw new d("#VALUE!");
		return T;
	}
	for (let t of e.sheets) for (let e of Object.keys(t.cells)) {
		let n = c(e);
		n && i(t, n.r, n.c);
	}
	return t;
}
function y(e) {
	return Array.isArray(e) ? e[0]?.[0] ?? null : e;
}
function b(e, t, n) {
	let r = typeof e == "number" ? e : e !== null && String(e).trim() !== "" ? Number(String(e).replace(/,/g, "")) : NaN, i = typeof t == "number" ? t : t !== null && String(t).trim() !== "" ? Number(String(t).replace(/,/g, "")) : NaN;
	if (!Number.isNaN(r) && !Number.isNaN(i)) {
		if (n === "=") return r === i;
		if (n === "<>" || n === "!=") return r !== i;
		if (n === "<") return r < i;
		if (n === "<=") return r <= i;
		if (n === ">") return r > i;
		if (n === ">=") return r >= i;
	}
	let a = String(e ?? "").toLowerCase(), o = String(t ?? "").toLowerCase();
	return n === "=" ? a === o : n === "<>" || n === "!=" ? a !== o : n === "<" ? a < o : n === "<=" ? a <= o : n === ">" ? a > o : n === ">=" && a >= o;
}
function ee(e, t, n, r) {
	switch (e) {
		case "SUM": return m(t).reduce((e, t) => e + t, 0);
		case "AVERAGE":
		case "AVG": {
			let e = m(t);
			if (e.length === 0) throw new d("#DIV/0!");
			return e.reduce((e, t) => e + t, 0) / e.length;
		}
		case "MIN": {
			let e = m(t);
			return e.length ? Math.min(...e) : 0;
		}
		case "MAX": {
			let e = m(t);
			return e.length ? Math.max(...e) : 0;
		}
		case "COUNT": return m(t).length;
		case "COUNTA": return f(t).filter((e) => e !== null && String(e).trim() !== "").length;
		case "COUNTBLANK": return f(t).filter((e) => e === null || String(e).trim() === "").length;
		case "PRODUCT": {
			let e = m(t);
			return e.length ? e.reduce((e, t) => e * t, 1) : 0;
		}
		case "SUMPRODUCT": {
			if (t.length === 0) return 0;
			let e = t.map((e) => f([e]).map((e) => p(e))), n = e[0].length;
			if (e.some((e) => e.length !== n)) throw new d("#VALUE!");
			let r = 0;
			for (let t = 0; t < n; t++) {
				let n = 1;
				for (let r of e) n *= r[t];
				r += n;
			}
			return r;
		}
		case "MEDIAN": {
			let e = m(t).sort((e, t) => e - t);
			if (e.length === 0) throw new d("#NUM!");
			let n = Math.floor(e.length / 2);
			return e.length % 2 == 0 ? (e[n - 1] + e[n]) / 2 : e[n];
		}
		case "MODE": {
			let e = m(t);
			if (e.length === 0) throw new d("#N/A");
			let n = /* @__PURE__ */ new Map(), r = e[0], i = 0;
			for (let t of e) {
				let e = (n.get(t) ?? 0) + 1;
				n.set(t, e), e > i && (i = e, r = t);
			}
			return r;
		}
		case "STDEV":
		case "STDEVP": {
			let n = m(t), r = e === "STDEV" ? n.length - 1 : n.length;
			if (r <= 0) throw new d("#DIV/0!");
			let i = n.reduce((e, t) => e + t, 0) / n.length, a = n.reduce((e, t) => e + (t - i) ** 2, 0) / r;
			return Math.sqrt(a);
		}
		case "VAR":
		case "VARP": {
			let n = m(t), r = e === "VAR" ? n.length - 1 : n.length;
			if (r <= 0) throw new d("#DIV/0!");
			let i = n.reduce((e, t) => e + t, 0) / n.length;
			return n.reduce((e, t) => e + (t - i) ** 2, 0) / r;
		}
		case "PERCENTILE": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = m([t[0]]).sort((e, t) => e - t), n = p(y(t[1]), !0);
			if (e.length === 0 || n < 0 || n > 1) throw new d("#NUM!");
			let r = n * (e.length - 1), i = Math.floor(r), a = Math.ceil(r);
			return e[i] + (e[a] - e[i]) * (r - i);
		}
		case "LARGE":
		case "SMALL": {
			if (t.length < 2) throw new d("#VALUE!");
			let n = m([t[0]]).sort((t, n) => e === "LARGE" ? n - t : t - n), r = Math.floor(p(y(t[1]), !0));
			if (r < 1 || r > n.length) throw new d("#NUM!");
			return n[r - 1];
		}
		case "RANK": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = p(y(t[0]), !0), n = t[2] ? p(y(t[2])) !== 0 : !1, r = m([t[1]]).sort((e, t) => n ? e - t : t - e).indexOf(e);
			if (r === -1) throw new d("#N/A");
			return r + 1;
		}
		case "SUMIF": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = f([t[0]]), n = h(y(t[1])), r = t[2] ? f([t[2]]) : e, i = 0;
			for (let t = 0; t < e.length; t++) n(e[t]) && (i += p(r[t] ?? 0));
			return i;
		}
		case "COUNTIF": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = f([t[0]]), n = h(y(t[1]));
			return e.filter(n).length;
		}
		case "AVERAGEIF": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = f([t[0]]), n = h(y(t[1])), r = t[2] ? f([t[2]]) : e, i = 0, a = 0;
			for (let t = 0; t < e.length; t++) n(e[t]) && (i += p(r[t] ?? 0), a++);
			if (a === 0) throw new d("#DIV/0!");
			return i / a;
		}
		case "IFS":
			for (let e = 0; e + 1 < t.length; e += 2) if (y(t[e])) return t[e + 1];
			throw new d("#N/A");
		case "SWITCH": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = y(t[0]);
			for (let n = 1; n + 1 < t.length; n += 2) if (b(e, y(t[n]), "=")) return t[n + 1];
			if (t.length % 2 == 0) return t[t.length - 1];
			throw new d("#N/A");
		}
		case "CHOOSE": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = Math.floor(p(y(t[0]), !0));
			if (e < 1 || e >= t.length) throw new d("#VALUE!");
			return t[e];
		}
		case "AND": return f(t).every((e) => !!e);
		case "OR": return f(t).some((e) => !!e);
		case "XOR": return f(t).filter((e) => !!e).length % 2 == 1;
		case "NOT": return !y(t[0] ?? !1);
		case "ISBLANK": {
			let e = y(t[0] ?? null);
			return e === null || e === "";
		}
		case "ISNUMBER": {
			let e = y(t[0] ?? null);
			return typeof e == "number" && Number.isFinite(e);
		}
		case "ISTEXT": return typeof y(t[0] ?? null) == "string";
		case "ABS": return Math.abs(p(y(t[0] ?? 0), !0));
		case "SIGN": return Math.sign(p(y(t[0] ?? 0), !0));
		case "SQRT": {
			let e = p(y(t[0] ?? 0), !0);
			if (e < 0) throw new d("#NUM!");
			return Math.sqrt(e);
		}
		case "POWER": return p(y(t[0] ?? 0), !0) ** +p(y(t[1] ?? 1), !0);
		case "EXP": return Math.exp(p(y(t[0] ?? 0), !0));
		case "LN": {
			let e = p(y(t[0] ?? 0), !0);
			if (e <= 0) throw new d("#NUM!");
			return Math.log(e);
		}
		case "LOG":
		case "LOG10": {
			let n = p(y(t[0] ?? 0), !0), r = e === "LOG10" ? 10 : t[1] ? p(y(t[1]), !0) : 10;
			if (n <= 0 || r <= 0 || r === 1) throw new d("#NUM!");
			return Math.log(n) / Math.log(r);
		}
		case "MOD": {
			let e = p(y(t[0] ?? 0), !0), n = p(y(t[1] ?? 0), !0);
			if (n === 0) throw new d("#DIV/0!");
			return e - n * Math.floor(e / n);
		}
		case "INT":
		case "FLOOR": return Math.floor(p(y(t[0] ?? 0), !0));
		case "CEILING": return Math.ceil(p(y(t[0] ?? 0), !0));
		case "TRUNC": return Math.trunc(p(y(t[0] ?? 0), !0));
		case "ROUND": {
			let e = p(y(t[0] ?? 0), !0), n = 10 ** (t[1] ? Math.floor(p(y(t[1]), !0)) : 0);
			return Math.round(e * n) / n;
		}
		case "ROUNDUP": {
			let e = p(y(t[0] ?? 0), !0), n = 10 ** (t[1] ? Math.floor(p(y(t[1]), !0)) : 0);
			return (e >= 0 ? Math.ceil(e * n) : Math.floor(e * n)) / n;
		}
		case "ROUNDDOWN": {
			let e = p(y(t[0] ?? 0), !0), n = 10 ** (t[1] ? Math.floor(p(y(t[1]), !0)) : 0);
			return Math.trunc(e * n) / n;
		}
		case "PI": return Math.PI;
		case "RAND": return Math.random();
		case "RANDBETWEEN": {
			let e = Math.ceil(p(y(t[0] ?? 0), !0)), n = Math.floor(p(y(t[1] ?? 1), !0));
			if (e > n) throw new d("#NUM!");
			return Math.floor(Math.random() * (n - e + 1)) + e;
		}
		case "VLOOKUP": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = y(t[0]), n = Array.isArray(t[1]) ? t[1] : [[t[1]]], r = Math.floor(p(y(t[2]), !0)) - 1, i = t[3] !== void 0 && !!y(t[3]);
			if (r < 0 || n[0] && r >= n[0].length) throw new d("#REF!");
			for (let t of n) if (b(t[0], e, "=")) return t[r] ?? null;
			if (i) {
				let t = null;
				for (let r of n) b(r[0], e, "<=") && (t = r);
				if (t) return t[r] ?? null;
			}
			throw new d("#N/A");
		}
		case "HLOOKUP": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = y(t[0]), n = Array.isArray(t[1]) ? t[1] : [[t[1]]], r = Math.floor(p(y(t[2]), !0)) - 1;
			if (r < 0 || r >= n.length) throw new d("#REF!");
			let i = n[0] ?? [];
			for (let t = 0; t < i.length; t++) if (b(i[t], e, "=")) return n[r][t] ?? null;
			throw new d("#N/A");
		}
		case "XLOOKUP": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = y(t[0]), n = f([t[1]]), r = f([t[2]]);
			for (let t = 0; t < n.length; t++) if (b(n[t], e, "=")) return r[t] ?? null;
			if (t[3] !== void 0) return y(t[3]);
			throw new d("#N/A");
		}
		case "INDEX": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = Array.isArray(t[0]) ? t[0] : [[t[0]]], n = Math.floor(p(y(t[1]), !0)) - 1, r = t[2] === void 0 ? 0 : Math.floor(p(y(t[2]), !0)) - 1;
			if (n < 0 || r < 0 || n >= e.length || r >= (e[0]?.length ?? 0)) throw new d("#REF!");
			return e[n][r] ?? null;
		}
		case "MATCH": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = y(t[0]), n = f([t[1]]);
			for (let t = 0; t < n.length; t++) if (b(n[t], e, "=")) return t + 1;
			throw new d("#N/A");
		}
		case "ROW": return n + 1;
		case "COLUMN": return r + 1;
		case "ROWS": return Array.isArray(t[0]) ? t[0].length : 1;
		case "COLUMNS": return Array.isArray(t[0]) ? t[0][0]?.length ?? 1 : 1;
		case "PMT": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = p(y(t[0]), !0), n = p(y(t[1]), !0), r = p(y(t[2]), !0), i = t[3] ? p(y(t[3]), !0) : 0, a = t[4] ? p(y(t[4]), !0) === 0 ? 0 : 1 : 0;
			if (n === 0) throw new d("#DIV/0!");
			if (e === 0) return -(r + i) / n;
			let o = (1 + e) ** +n;
			return -e * (r * o + i) / ((1 + e * a) * (o - 1));
		}
		case "FV": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = p(y(t[0]), !0), n = p(y(t[1]), !0), r = p(y(t[2]), !0), i = t[3] ? p(y(t[3]), !0) : 0, a = t[4] ? p(y(t[4]), !0) === 0 ? 0 : 1 : 0;
			if (e === 0) return -(i + r * n);
			let o = (1 + e) ** +n;
			return -(i * o + r * (1 + e * a) * (o - 1) / e);
		}
		case "PV": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = p(y(t[0]), !0), n = p(y(t[1]), !0), r = p(y(t[2]), !0), i = t[3] ? p(y(t[3]), !0) : 0, a = t[4] ? p(y(t[4]), !0) === 0 ? 0 : 1 : 0;
			if (e === 0) return -(i + r * n);
			let o = (1 + e) ** +n;
			return -(i + r * (1 + e * a) * (o - 1) / e) / o;
		}
		case "NPV": {
			if (t.length < 2) throw new d("#VALUE!");
			let e = p(y(t[0]), !0);
			return m(t.slice(1)).reduce((t, n, r) => t + n / (1 + e) ** +(r + 1), 0);
		}
		case "LEN": return String(y(t[0]) ?? "").length;
		case "TRIM": return String(y(t[0]) ?? "").trim().replace(/\s+/g, " ");
		case "UPPER": return String(y(t[0]) ?? "").toUpperCase();
		case "LOWER": return String(y(t[0]) ?? "").toLowerCase();
		case "PROPER": return String(y(t[0]) ?? "").replace(/\b\w/g, (e) => e.toUpperCase());
		case "CONCAT":
		case "CONCATENATE": return f(t).map((e) => String(e ?? "")).join("");
		case "TEXTJOIN": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = String(y(t[0]) ?? ""), n = !!y(t[1]), r = f(t.slice(2)).map((e) => String(e ?? ""));
			return (n ? r.filter((e) => e !== "") : r).join(e);
		}
		case "LEFT": {
			let e = String(y(t[0]) ?? ""), n = t[1] === void 0 ? 1 : Math.max(0, Math.floor(p(y(t[1]), !0)));
			return e.slice(0, n);
		}
		case "RIGHT": {
			let e = String(y(t[0]) ?? ""), n = t[1] === void 0 ? 1 : Math.max(0, Math.floor(p(y(t[1]), !0)));
			return n === 0 ? "" : e.slice(-n);
		}
		case "MID": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = String(y(t[0]) ?? ""), n = Math.max(1, Math.floor(p(y(t[1]), !0))) - 1, r = Math.max(0, Math.floor(p(y(t[2]), !0)));
			return e.slice(n, n + r);
		}
		case "SUBSTITUTE": {
			if (t.length < 3) throw new d("#VALUE!");
			let e = String(y(t[0]) ?? ""), n = String(y(t[1]) ?? ""), r = String(y(t[2]) ?? "");
			return n ? e.split(n).join(r) : e;
		}
		case "REPT": {
			let e = String(y(t[0]) ?? ""), n = Math.max(0, Math.min(1e3, Math.floor(p(y(t[1] ?? 1), !0))));
			return e.repeat(n);
		}
		case "VALUE": return p(y(t[0] ?? 0), !0);
		case "TEXT": {
			let e = y(t[0] ?? "");
			return String(e ?? "");
		}
		case "EXACT": return String(y(t[0]) ?? "") === String(y(t[1]) ?? "");
		case "TODAY": {
			let e = /* @__PURE__ */ new Date();
			return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
		}
		case "NOW": {
			let e = /* @__PURE__ */ new Date();
			return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")} ${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`;
		}
		case "DATE": {
			let e = Math.floor(p(y(t[0] ?? 2026), !0)), n = Math.floor(p(y(t[1] ?? 1), !0)), r = Math.floor(p(y(t[2] ?? 1), !0)), i = new Date(e, n - 1, r);
			return `${i.getFullYear()}-${String(i.getMonth() + 1).padStart(2, "0")}-${String(i.getDate()).padStart(2, "0")}`;
		}
		case "YEAR": return g(y(t[0])).getFullYear();
		case "MONTH": return g(y(t[0])).getMonth() + 1;
		case "DAY": return g(y(t[0])).getDate();
		case "DAYS": {
			let e = g(y(t[0])), n = g(y(t[1]));
			return Math.round((e.getTime() - n.getTime()) / 864e5);
		}
		case "DATEDIF": {
			let e = g(y(t[0])), n = g(y(t[1])), r = String(y(t[2] ?? "D")).toUpperCase(), i = Math.round((n.getTime() - e.getTime()) / 864e5);
			return r === "Y" ? Math.floor(i / 365.25) : r === "M" ? (n.getFullYear() - e.getFullYear()) * 12 + (n.getMonth() - e.getMonth()) : i;
		}
		default: throw new d("#NAME?");
	}
}
function x(e) {
	return e.replace(/[٠-٩]/g, (e) => String(e.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (e) => String(e.charCodeAt(0) - 1776)).replace(/٫/g, ".").replace(/٬/g, ",").replace(/٪/g, "%");
}
function te(e) {
	let t = x(e.trim());
	return t === "" ? null : t.toUpperCase() === "TRUE" ? !0 : t.toUpperCase() === "FALSE" ? !1 : /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t) ? Number(t.replace(/,/g, "")) : /^-?\d+(?:\.\d+)?%$/.test(t) ? Number(t.slice(0, -1)) / 100 : e;
}
function S(e, t) {
	if (e == null || e === "") return "";
	if (typeof e == "boolean") return e ? "TRUE" : "FALSE";
	let n = t?.format ?? "auto", r = t?.decimals ?? 2;
	if (typeof e == "number" && Number.isFinite(e)) switch (n) {
		case "integer": return Math.round(e).toLocaleString("en-US");
		case "number": return e.toLocaleString("en-US", {
			minimumFractionDigits: r,
			maximumFractionDigits: r
		});
		case "currency_sar": return `${e < 0 ? "-" : ""}SAR ${Math.abs(e).toLocaleString("en-US", {
			minimumFractionDigits: r,
			maximumFractionDigits: r
		})}`;
		case "currency_usd": return `${e < 0 ? "-" : ""}$${Math.abs(e).toLocaleString("en-US", {
			minimumFractionDigits: r,
			maximumFractionDigits: r
		})}`;
		case "accounting": return e < 0 ? `(${Math.abs(e).toLocaleString("en-US", {
			minimumFractionDigits: r,
			maximumFractionDigits: r
		})})` : e === 0 ? "-" : e.toLocaleString("en-US", {
			minimumFractionDigits: r,
			maximumFractionDigits: r
		});
		case "percent": return `${(e * 100).toFixed(r)}%`;
		case "scientific": return e.toExponential(r);
		default: return Number.isInteger(e) ? e.toLocaleString("en-US") : Number(e.toFixed(6)).toLocaleString("en-US", { maximumFractionDigits: 4 });
	}
	return String(e);
}
//#endregion
//#region live/planning-dates.ts
var C = (e) => String(e).padStart(2, "0"), w = (e) => `${e.getFullYear()}-${C(e.getMonth() + 1)}-${C(e.getDate())}`, T = (e) => {
	let [t, n, r] = e.split("-").map(Number);
	return new Date(t, (n || 1) - 1, r || 1);
};
function E(e, t) {
	let n = T(e);
	return n.setDate(n.getDate() + t), w(n);
}
function ne(e = /* @__PURE__ */ new Date()) {
	return w(e);
}
function re(e) {
	return T(e).getDay();
}
//#endregion
//#region ../src/planning/quickAdd.ts
var D = {
	sun: 0,
	sunday: 0,
	الأحد: 0,
	الاحد: 0,
	احد: 0,
	mon: 1,
	monday: 1,
	الاثنين: 1,
	الإثنين: 1,
	اثنين: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	الثلاثاء: 2,
	ثلاثاء: 2,
	wed: 3,
	wednesday: 3,
	الأربعاء: 3,
	الاربعاء: 3,
	اربعاء: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	الخميس: 4,
	خميس: 4,
	fri: 5,
	friday: 5,
	الجمعة: 5,
	جمعة: 5,
	الجمعه: 5,
	sat: 6,
	saturday: 6,
	السبت: 6,
	سبت: 6
}, ie = {
	jan: 1,
	january: 1,
	يناير: 1,
	feb: 2,
	february: 2,
	فبراير: 2,
	mar: 3,
	march: 3,
	مارس: 3,
	apr: 4,
	april: 4,
	أبريل: 4,
	ابريل: 4,
	إبريل: 4,
	may: 5,
	مايو: 5,
	jun: 6,
	june: 6,
	يونيو: 6,
	يونيه: 6,
	jul: 7,
	july: 7,
	يوليو: 7,
	يوليه: 7,
	aug: 8,
	august: 8,
	أغسطس: 8,
	اغسطس: 8,
	sep: 9,
	sept: 9,
	september: 9,
	سبتمبر: 9,
	oct: 10,
	october: 10,
	أكتوبر: 10,
	اكتوبر: 10,
	nov: 11,
	november: 11,
	نوفمبر: 11,
	dec: 12,
	december: 12,
	ديسمبر: 12
}, ae = "am|a\\.m\\.|ص|صباحا|صباحًا|صباحاً|صباح|الصبح|الصباح|فجرا|فجراً|الفجر", O = "pm|p\\.m\\.|م|مساء|مساءً|مساءا|المساء|العصر|عصرا|عصراً|الليل|ليلا|ليلاً|بالليل", k = "ظهرا|ظهرًا|ظهراً|الظهر", A = "[0-9٠-٩۰-۹]", j = (e, t = "i") => new RegExp(e, t), M = (e) => Number(e.replace(/[٠-٩]/g, (e) => String(e.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (e) => String(e.charCodeAt(0) - 1776)));
function oe(e, t, n) {
	if (n) {
		let t = n.toLowerCase(), r = j(`^(?:p|${O})$`).test(t);
		j(`^(?:${k})$`).test(t) ? e = e >= 11 ? e : e + 12 : e === 12 ? e = r ? 12 : 0 : r && (e += 12);
	}
	return e > 23 || t > 59 ? null : `${String(e).padStart(2, "0")}:${String(t).padStart(2, "0")}`;
}
function se(e, t = /* @__PURE__ */ new Date()) {
	let n = ne(t), r = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, i = ` ${e.trim()} `, a = null, o = null, s = 0, c = (e, t) => {
		let n = i.match(e);
		n && t(n) !== !1 && (i = i.replace(n[0], " "));
	}, l = (e, t, n) => {
		let r = oe(e, t, n);
		if (!r) return !1;
		o = r;
	};
	c(/\s!([1-3])(?=\s)/, (e) => void (s = Number(e[1]))), s || c(/\s(!{1,3})(?=\s)/, (e) => void (s = e[1].length));
	let u = "\\s(?:at\\s+|@|الساعة\\s+|الساعه\\s+)?";
	if (c(j(`${u}(${A}{1,2})[:٫](${A}{2})\\s*(${ae}|${O}|${k}|a|p)?(?=\\s)`), (e) => l(M(e[1]), M(e[2]), e[3])), o || c(j(`${u}(${A}{1,2})\\s*(${ae}|${O}|${k})(?=\\s)`), (e) => l(M(e[1]), 0, e[2])), o || c(j(`\\s(?:at|الساعة|الساعه)\\s+(${A}{1,2})(?=\\s)`), (e) => l(M(e[1]), 0)), c(/\s(today|tod|اليوم)(?=\s)/i, () => void (a = n)), a || c(j(`\\s(?:tonight|الليلة|الليله)(?:\\s+(?:at\\s+|الساعة\\s+)?(${A}{1,2}))?(?=\\s)`), (e) => {
		a = n, e[1] && !o && M(e[1]) >= 1 && M(e[1]) <= 11 && (o = oe(M(e[1]), 0, "pm")), o ?? (o = "20:00");
	}), a || c(/\s(?:after tomorrow|بعد بكرة|بعد بكره|بعد بكرا|بعد غد|بعد الغد)(?=\s)/i, () => void (a = E(n, 2))), a || c(/\s(tomorrow|tmr|tmrw|بكرة|بكره|بكرا|غدا|غدًا|غداً)(?=\s)/i, () => void (a = E(n, 1))), a || c(/\s(?:next week|(?:الأسبوع|الاسبوع)\s+(?:الجاي|القادم|المقبل))(?=\s)/i, () => void (a = E(n, 7))), a || c(j(`\\s(?:in\\s+(${A}{1,3})\\s+(day|days|week|weeks)|بعد\\s+(${A}{1,3})\\s+(يوم|أيام|ايام|أسبوع|اسبوع|أسابيع|اسابيع))(?=\\s)`), (e) => {
		let t = M(e[1] ?? e[3]), r = (e[2] ?? e[4]).toLowerCase();
		a = E(n, /week|سبوع|سابيع/.test(r) ? t * 7 : t);
	}), a || c(/\s(?:in\s+a\s+(day|week)|بعد\s+(يوم|يومين|أسبوع|اسبوع|أسبوعين|اسبوعين))(?=\s)(?!\s+(?:ال)?(?:أحد|احد|اثنين|إثنين|ثلاثاء|أربعاء|اربعاء|خميس|جمعة|سبت))/i, (e) => {
		let t = (e[1] ?? e[2]).toLowerCase();
		a = E(n, {
			day: 1,
			week: 7,
			يوم: 1,
			يومين: 2,
			أسبوع: 7,
			اسبوع: 7,
			أسبوعين: 14,
			اسبوعين: 14
		}[t]);
	}), !a) for (let e of i.matchAll(/\s(?:(on|next|يوم)\s+)?([A-Za-z]{3,9}|[؀-ۿ]{3,9})(?:\s+(القادم|القادمة|الجاي|الجاية|المقبل|المقبلة))?(?=\s)/gi)) {
		let t = e[2].toLowerCase();
		if (!(t in D)) continue;
		let s = e[1]?.toLowerCase() === "next" || !!e[3], c = (D[t] - re(n) + 7) % 7, l = o;
		c === 0 && (s || l === null || l <= r) && (c = 7), a = E(n, c), i = i.replace(e[0], " ");
		break;
	}
	if (!a) {
		let e = (e, r, i) => {
			if (!e || e > 31 || !r) return !1;
			let o = i ?? t.getFullYear(), s = `${o}-${String(r).padStart(2, "0")}-${String(e).padStart(2, "0")}`;
			if (!i && s < n && (s = `${++o}-${s.slice(5)}`), e > new Date(Date.UTC(o, r, 0)).getUTCDate()) return !1;
			a = s;
		}, r = "([A-Za-z]{3,9}|[؀-ۿ]{3,7})", o = [[j(`\\s(${A}{1,2})\\s+${r}(?:\\s+(${A}{4}))?(?=\\s)`, "gi"), (e) => [
			e[1],
			e[2],
			e[3]
		]], [j(`\\s${r}\\s+(${A}{1,2})(?:,?\\s+(${A}{4}))?(?=\\s)`, "gi"), (e) => [
			e[2],
			e[1],
			e[3]
		]]];
		for (let [t, n] of o) {
			for (let r of i.matchAll(t)) {
				let [t, a, o] = n(r), s = ie[a.toLowerCase()];
				if (s && e(M(t), s, o ? M(o) : void 0) !== !1) {
					i = i.replace(r[0], " ");
					break;
				}
			}
			if (a) break;
		}
	}
	a || c(j(`\\s(${A}{4})-(${A}{2})-(${A}{2})(?=\\s)`), (e) => void (a = `${M(e[1])}-${String(M(e[2])).padStart(2, "0")}-${String(M(e[3])).padStart(2, "0")}`)), a || c(j(`\\s(${A}{1,2})\\/(${A}{1,2})(?=\\s)`), (e) => {
		let r = M(e[1]), i = M(e[2]);
		if (!r || !i || r > 31 || i > 12) return !1;
		let o = t.getFullYear(), s = `${o}-${String(i).padStart(2, "0")}-${String(r).padStart(2, "0")}`;
		s < n && (s = `${o + 1}-${s.slice(5)}`), a = s;
	});
	let d = o;
	return d && !a && (a = d > r ? n : E(n, 1)), {
		title: i.replace(/\s+/g, " ").trim(),
		due: a,
		time: o,
		priority: s
	};
}
function ce(e, t) {
	let n = Math.max(.25, t.size * t.spacing * (t.pressureSize === !1 ? 1 : .1)), r = t.kind === "spray" ? Math.max(1, Math.ceil(t.size / 3)) : t.kind === "crayon" || t.kind === "natural-pencil" ? Math.min(256, Math.max(5, Math.ceil(t.size * (t.kind === "crayon" ? 5 : 4)))) : t.kind === "oil" ? 13 : t.kind === "watercolor" ? 2 : 1;
	return (2 + e / n) * r;
}
function le(e, t) {
	if (!e.length) return 0;
	let n = 0;
	for (let t = 1; t < e.length; t++) n += Math.hypot(e[t].x - e[t - 1].x, e[t].y - e[t - 1].y);
	return ce(n, t);
}
function ue(e, t) {
	if (e.length > 65536 || !e.every((e) => [
		e.x,
		e.y,
		e.pressure,
		e.tiltX,
		e.tiltY,
		e.time
	].every(Number.isFinite)) || !(le(e, t) <= 1e6)) throw Error("This stroke exceeds the paint limit; start another stroke");
}
//#endregion
//#region ../src/drawing/model.ts
var N = {
	kind: "hard",
	size: 12,
	opacity: 1,
	flow: 1,
	hardness: 1,
	spacing: .12,
	angle: 0,
	roundness: 1,
	smoothing: .15,
	stabilizer: 0,
	taperStart: 0,
	taperEnd: 0,
	pressureSize: !0,
	pressureOpacity: !1,
	pressureFlow: !1,
	pressureCurve: 1,
	color: "#202023"
}, de = [
	"pencil",
	"hard",
	"soft",
	"ink",
	"marker",
	"highlighter",
	"spray",
	"texture",
	"calligraphy",
	"oil",
	"crayon",
	"natural-pencil",
	"watercolor"
], fe = (e, t, n) => Math.max(t, Math.min(n, e));
function pe(e) {
	let t = {
		...N,
		...e
	}, n = (e, t, n, r) => Number.isFinite(e) ? fe(e, n, r) : t;
	t.size = n(t.size, 12, 1, 2048), t.opacity = n(t.opacity, 1, 0, 1), t.flow = n(t.flow, 1, 0, 1), t.hardness = n(t.hardness, 1, 0, 1), t.spacing = n(t.spacing, .12, .01, 2), t.roundness = n(t.roundness, 1, .05, 1), t.angle = n(t.angle, 0, -360, 360), t.smoothing = n(t.smoothing, .15, 0, .95), t.stabilizer = n(t.stabilizer, 0, 0, 100), t.taperStart = n(t.taperStart, 0, 0, .5), t.taperEnd = n(t.taperEnd, 0, 0, .5), t.pressureCurve = n(t.pressureCurve, 1, .1, 4), de.includes(t.kind) || (t.kind = N.kind);
	for (let e of [
		"pressureSize",
		"pressureOpacity",
		"pressureFlow"
	]) typeof t[e] != "boolean" && (t[e] = N[e]);
	return (typeof t.color != "string" || !t.color || t.color.length > 128 || /[<>;{}]|url\s*\(/i.test(t.color)) && (t.color = N.color), t.tipAssetId !== void 0 && (typeof t.tipAssetId != "string" || !t.tipAssetId || t.tipAssetId.length > 160) && delete t.tipAssetId, t.straightLine !== void 0 && typeof t.straightLine != "boolean" && delete t.straightLine, t;
}
//#endregion
//#region ../src/drawing/geometry.ts
var P = (e, t, n) => Math.max(t, Math.min(n, e)), F = (e, t) => Math.hypot(e.x - t.x, e.y - t.y);
function I(e, t = 0) {
	if (!e.length) return {
		x: 0,
		y: 0,
		w: 1,
		h: 1
	};
	let n = Infinity, r = Infinity, i = -Infinity, a = -Infinity;
	for (let t of e) n = Math.min(n, t.x), r = Math.min(r, t.y), i = Math.max(i, t.x), a = Math.max(a, t.y);
	return {
		x: n - t,
		y: r - t,
		w: Math.max(1, i - n + t * 2),
		h: Math.max(1, a - r + t * 2)
	};
}
//#endregion
//#region ../src/drawing/recognition.ts
function me(e) {
	let t = 1200;
	return e.length <= t ? e : Array.from({ length: t }, (t, n) => e[Math.round(n * (e.length - 1) / 1199)]);
}
function L(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = P(((e.x - t.x) * r + (e.y - t.y) * i) / (r * r + i * i || 1), 0, 1);
	return F(e, {
		x: t.x + a * r,
		y: t.y + a * i
	});
}
function R(e, t) {
	if (e.length < 3) return e;
	let n = t, r = -1;
	for (let t = 1; t < e.length - 1; t++) {
		let i = L(e[t], e[0], e[e.length - 1]);
		i > n && (r = t, n = i);
	}
	return r < 0 ? [e[0], e[e.length - 1]] : [...R(e.slice(0, r + 1), t).slice(0, -1), ...R(e.slice(r), t)];
}
function he(e) {
	if (e.length < 6) return null;
	e = me(e);
	let t = I(e), n = Math.hypot(t.w, t.h);
	if (n < 24) return null;
	let r = e[0], i = e[e.length - 1], a = e.slice(1).reduce((t, n, r) => t + F(e[r], n), 0);
	if (F(r, i) > n * .24) {
		let o = e.reduce((e, t) => e + L(t, r, i), 0) / e.length, s = F(r, i) / Math.max(1, a);
		return o < n * .045 && s > .92 ? {
			shape: "line",
			rect: t,
			points: [r, i],
			confidence: s
		} : null;
	}
	let o = 0, s = 0, c = 0, l = Math.max(1, Math.floor(e.length / 120));
	for (let t = 0; t < e.length; t += l) for (let n = t + l; n < e.length; n += l) {
		let r = F(e[t], e[n]);
		r > c && (o = t, s = n, c = r);
	}
	let u = n * .055, d = R(e.slice(o, s + 1), u), f = R([...e.slice(s), ...e.slice(0, o + 1)], u), p = [...d.slice(0, -1), ...f.slice(0, -1)];
	if (p = p.filter((e, t, n) => L(e, n[(t + n.length - 1) % n.length], n[(t + 1) % n.length]) > u * .65), p.length === 3) {
		if (Math.abs(p.reduce((e, t, n) => e + t.x * p[(n + 1) % 3].y - t.y * p[(n + 1) % 3].x, 0)) < t.w * t.h * .3) return null;
		for (let e = 0; e < 3; e++) {
			let t = p[e], n = p[(e + 1) % 3], r = p[(e + 2) % 3], i = n.x - t.x, a = n.y - t.y, o = r.x - t.x, s = r.y - t.y, c = Math.abs((i * o + a * s) / (Math.hypot(i, a) * Math.hypot(o, s) || 1));
			if (c < .27) {
				let e = Math.hypot(i, a), r = i / e, l = a / e, u = o * -l + s * r, d = [
					t,
					n,
					{
						x: t.x - l * u,
						y: t.y + r * u
					}
				];
				return {
					shape: "right-triangle",
					rect: I(d),
					points: d,
					confidence: 1 - c * .3
				};
			}
		}
		return {
			shape: "triangle",
			rect: t,
			points: p,
			confidence: .91
		};
	}
	if (p.length === 4) {
		if (p.every((e) => Math.min(Math.abs(e.x - t.x), Math.abs(e.x - t.x - t.w)) < n * .09 && Math.min(Math.abs(e.y - t.y), Math.abs(e.y - t.y - t.h)) < n * .09)) return {
			shape: "rect",
			rect: t,
			confidence: .93
		};
		let [e, r, i, a] = p, o = (r.x - e.x + i.x - a.x) / 2, s = (r.y - e.y + i.y - a.y) / 2, c = (a.x - e.x + i.x - r.x) / 2, l = (a.y - e.y + i.y - r.y) / 2, u = Math.hypot(o, s), d = Math.hypot(c, l), f = Math.abs((o * c + s * l) / (u * d || 1)), m = Math.hypot(e.x + i.x - r.x - a.x, e.y + i.y - r.y - a.y) / n;
		if (u > n * .12 && d > n * .12 && f < .22 && m < .14) {
			let t = o / u, n = s / u, d = c * -n + l * t, p = {
				x: (e.x + r.x + i.x + a.x) / 4,
				y: (e.y + r.y + i.y + a.y) / 4
			}, h = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			].map(([e, r]) => ({
				x: p.x + e * o / 2 - r * n * d / 2,
				y: p.y + e * s / 2 + r * t * d / 2
			}));
			return {
				shape: "rect",
				rect: I(h),
				points: h,
				confidence: 1 - Math.max(f, m)
			};
		}
	}
	let m = t.w / 2, h = t.h / 2;
	if (m < 10 || h < 10) return null;
	let g = e.reduce((e, n) => e + Math.abs(Math.hypot((n.x - t.x - m) / m, (n.y - t.y - h) / h) - 1), 0) / e.length;
	return p.length >= 5 && g < .1 && a < Math.PI * (m + h) * 1.25 ? {
		shape: "ellipse",
		rect: t,
		confidence: 1 - g
	} : null;
}
//#endregion
//#region ../src/drawing/brush.ts
function ge(e, t, n = 1) {
	return Array.from(_e(e, t, n));
}
function* _e(e, t, n = 1) {
	if (!e.length) return;
	let r = pe(t);
	ue(e, r);
	let i = n | 0 || 1, a = () => (i ^= i << 13, i ^= i >>> 17, i ^= i << 5, (i >>> 0) / 4294967296), o = e.map((t, n) => n ? F(e[n - 1], t) : 0), s = o.reduce((e, t) => e + t, 0), c = function* (e, t) {
		let n = P(e.pressure, .01, 1) ** +r.pressureCurve, i = Math.min(1, r.taperStart && s ? t / (s * r.taperStart) : 1, r.taperEnd && s ? (s - t) / (s * r.taperEnd) : 1), o = Math.max(.2, r.size * (r.pressureSize ? n : 1) * Math.max(.03, i)), c = r.flow * (r.pressureOpacity ? n : 1) * (r.pressureFlow ? n : 1);
		if (r.kind === "spray") for (let t = 0; t < Math.max(1, Math.ceil(o / 3)); t++) {
			let t = a() * Math.PI * 2, n = Math.sqrt(a()) * o / 2;
			yield {
				x: e.x + Math.cos(t) * n,
				y: e.y + Math.sin(t) * n,
				size: Math.max(1, o / 24),
				opacity: c,
				angle: r.angle,
				roundness: 1,
				noise: a()
			};
		}
		else yield {
			x: e.x,
			y: e.y,
			size: o,
			opacity: c,
			angle: r.angle,
			roundness: r.roundness,
			noise: a()
		};
	};
	yield* c(e[0], 0);
	let l = 0, u = Math.max(.25, r.size * r.spacing);
	for (let t = 1; t < e.length; t++) {
		let n = e[t - 1], i = e[t], a = o[t], s = u;
		for (; s <= a;) {
			let e = a ? s / a : 0, t = {
				...i,
				x: n.x + (i.x - n.x) * e,
				y: n.y + (i.y - n.y) * e,
				pressure: n.pressure + (i.pressure - n.pressure) * e
			};
			yield* c(t, l + s), s += Math.max(.25, r.size * r.spacing * (r.pressureSize ? Math.max(.1, t.pressure) : 1));
		}
		u = s - a, l += a;
	}
	e.length > 1 && (yield* c(e[e.length - 1], s));
}
//#endregion
//#region live/live.ts
var z = document.documentElement.lang === "ar", ve = "https://app.enterworlds.space", ye = `worlds.site.livepage.${z ? "ar" : "en"}`, B = matchMedia("(prefers-reduced-motion: reduce)"), V = z ? {
	title: "صفحتي الأولى",
	add: "اكتب / لإضافة كتلة، أو اكتب نصًا واضغط Enter",
	text: "نص",
	table: "جدول",
	tasks: "مهام",
	drawing: "رسم",
	slides: "عرض",
	textHint: "فقرة تكتبها",
	tableHint: "يحسب بمحرك الصيغ نفسه",
	tasksHint: "يفهم «بكرة 4م»",
	drawingHint: "يعدّل الأشكال المرسومة",
	slidesHint: "صفحتك شرائح",
	grip: "اسحب لتغيير الترتيب، أو استخدم الأسهم",
	remove: "احذف الكتلة",
	cells: [
		["المادة", "الدرجة"],
		["الأحياء", "92"],
		["الرياضيات", "87"],
		["الكيمياء", "78"],
		["", ""],
		["المعدل", "=ROUND(AVERAGE(B2:B5),1)"]
	],
	tableTip: ["اختر خلية واكتب. جرّب درجة في B5، أو صيغة مثل", "=MAX(B2:B5)"],
	seeds: ["مراجعة الفصل الثالث اليوم 6م", "تسليم تقرير الطاقة المتجددة الخميس !!"],
	taskInput: "أضف مهمة… جرّب: اتصل بالبنك بكرة 4م",
	willAdd: "ستُضاف",
	today: "اليوم",
	tomorrow: "غدًا",
	high: "مهم",
	days: [
		"الأحد",
		"الاثنين",
		"الثلاثاء",
		"الأربعاء",
		"الخميس",
		"الجمعة",
		"السبت"
	],
	draw: "ارسم هنا. ارسم دائرة أو مثلثًا أو مستطيلًا، ويعتدل بعد أن ترفع القلم.",
	straighten: "تعديل الأشكال",
	undo: "تراجع",
	clear: "مسح",
	colors: [
		"حبر",
		"طين",
		"أخضر"
	],
	slide: "شريحة",
	of: "من",
	prev: "السابقة",
	next: "التالية",
	full: "ملء الشاشة",
	emptyPage: "أضف كتلًا إلى صفحتك، وتظهر هنا شرائح.",
	open: "افتح صفحتك في Worlds",
	reset: "ابدأ من جديد",
	example: "املأها بمثال",
	exampleText: "خطة أسبوع الاختبارات: أراجع كل يوم مادة، وأحسب معدلي، وأرسم خريطة للفصل الصعب.",
	kept: "صفحتك محفوظة في هذا المتصفح فقط.",
	handOff: "يُنقل النص والمهام والجدول. الرسم يبقى هنا.",
	formula: "صيغة"
} : {
	title: "My first page",
	add: "Type / to add a block, or type text and press Enter",
	text: "Text",
	table: "Table",
	tasks: "Tasks",
	drawing: "Drawing",
	slides: "Present",
	textHint: "A paragraph",
	tableHint: "The same formula engine",
	tasksHint: "Understands “tomorrow 4pm”",
	drawingHint: "Straightens drawn shapes",
	slidesHint: "Your page as slides",
	grip: "Drag to reorder, or use the arrow keys",
	remove: "Remove the block",
	cells: [
		["Subject", "Grade"],
		["Biology", "92"],
		["Maths", "87"],
		["Chemistry", "78"],
		["", ""],
		["Average", "=ROUND(AVERAGE(B2:B5),1)"]
	],
	tableTip: ["Pick a cell and type. Try a grade in B5, or a formula such as", "=MAX(B2:B5)"],
	seeds: ["Review chapter 3 today 6pm", "Hand in the energy report thursday !!"],
	taskInput: "Add a task… try: call the bank tomorrow 4pm",
	willAdd: "Adds",
	today: "Today",
	tomorrow: "Tomorrow",
	high: "Important",
	days: [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday"
	],
	draw: "Draw here. Draw a circle, a triangle or a box, and it straightens when you lift the pen.",
	straighten: "Straighten shapes",
	undo: "Undo",
	clear: "Clear",
	colors: [
		"Ink",
		"Clay",
		"Green"
	],
	slide: "Slide",
	of: "of",
	prev: "Previous",
	next: "Next",
	full: "Full screen",
	emptyPage: "Add blocks to your page and they show here as slides.",
	open: "Open your page in Worlds",
	reset: "Start over",
	example: "Fill it with an example",
	exampleText: "Exam week plan: one subject a day, my average worked out, and a map of the hard chapter.",
	kept: "Your page is kept in this browser only.",
	handOff: "Text, tasks and the table go across. The drawing stays here.",
	formula: "Formula"
}, be = [
	"يناير",
	"فبراير",
	"مارس",
	"أبريل",
	"مايو",
	"يونيو",
	"يوليو",
	"أغسطس",
	"سبتمبر",
	"أكتوبر",
	"نوفمبر",
	"ديسمبر"
], xe = () => Math.random().toString(36).slice(2, 10);
function H(e, t = {}, ...n) {
	let r = document.createElement(e);
	for (let [e, n] of Object.entries(t)) n !== void 0 && n !== !1 && (e.startsWith("on") && typeof n == "function" ? r.addEventListener(e.slice(2), n) : e === "class" ? r.className = String(n) : r.setAttribute(e, n === !0 ? "" : String(n)));
	for (let e of n) e !== null && e !== !1 && e !== void 0 && r.append(e);
	return r;
}
var Se = "http://www.w3.org/2000/svg", Ce = {
	grip: "M9 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
	close: "M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3Z",
	text: "M5 5h14v2.4h-5.8V19h-2.4V7.4H5Z",
	table: "M4 5h16v14H4Zm2 2v3h5V7Zm7 0v3h5V7Zm-7 5v5h5v-5Zm7 0v5h5v-5Z",
	tasks: "M9.6 7.2 7 9.8 5.4 8.2l-1.1 1.1L7 12l3.7-3.7Zm2.4.8h8v2h-8Zm-2.4 6.2L7 16.8l-1.6-1.6-1.1 1.1L7 19l3.7-3.7Zm2.4.8h8v2h-8Z",
	drawing: "M16.9 3.6a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9.2 18.3 4 20l1.7-5.2Zm-9.7 12-.6 1.8 1.8-.6 8-8-1.2-1.2Z",
	slides: "M3 5h18v11H3Zm2 2v7h14V7Zm5 10h4l1 3H9Z",
	chevron: "M9.3 6.3 15 12l-5.7 5.7-1.4-1.4L12.2 12 7.9 7.7Z",
	expand: "M4 4h6v2H6v4H4Zm10 0h6v6h-2V6h-4ZM4 14h2v4h4v2H4Zm14 0h2v6h-6v-2h4Z",
	undo: "M9 7V4L3.5 9 9 14v-3h4.5a3.5 3.5 0 0 1 0 7H11v2h2.5a5.5 5.5 0 0 0 0-11Z"
};
function U(e, t = 18) {
	let n = document.createElementNS(Se, "svg");
	n.setAttribute("viewBox", "0 0 24 24"), n.setAttribute("width", String(t)), n.setAttribute("height", String(t)), n.setAttribute("aria-hidden", "true"), n.classList.add("ic");
	let r = document.createElementNS(Se, "path");
	return r.setAttribute("d", Ce[e]), r.setAttribute("fill", "currentColor"), n.append(r), n;
}
var W = we();
function we() {
	try {
		let e = localStorage.getItem(ye), t = e ? JSON.parse(e) : null;
		if (t?.v === 1 && Array.isArray(t.blocks)) return t;
	} catch {}
	return {
		v: 1,
		title: V.title,
		blocks: []
	};
}
var Te = 0;
function G() {
	clearTimeout(Te), Te = window.setTimeout(() => {
		try {
			localStorage.setItem(ye, JSON.stringify(W));
		} catch {}
	}, 250);
}
var Ee = (e) => W.blocks.find((t) => t.id === e);
function K(e, t = "") {
	let n = {
		id: xe(),
		kind: e
	};
	return e === "text" && (n.text = t), e === "table" && (n.cells = {}, V.cells.forEach((e, t) => e.forEach((e, r) => e && (n.cells[o(t, r)] = e)))), e === "tasks" && (n.tasks = V.seeds.map((e) => Ae(e)).filter((e) => !!e)), e === "drawing" && (n.strokes = []), n;
}
function De(e, t) {
	try {
		e.setPointerCapture(t);
	} catch {}
}
function Oe() {
	let e = K("drawing"), t = [];
	for (let e = 0; e <= 40; e++) t.push(.5 + e * .011, .62 + Math.sin(e / 4) * .12, .45 + .3 * Math.sin(e / 9));
	return e.strokes = [
		{
			color: "--terra",
			pts: [],
			shape: {
				kind: "ellipse",
				x: .08,
				y: .18,
				w: .22,
				h: .62
			}
		},
		{
			color: "--teal",
			pts: [],
			shape: {
				kind: "triangle",
				x: .34,
				y: .2,
				w: .12,
				h: .56,
				points: [
					.4,
					.2,
					.46,
					.76,
					.34,
					.76
				]
			}
		},
		{
			color: "--ink",
			pts: t
		}
	], [
		K("text", V.exampleText),
		K("tasks"),
		K("table"),
		e,
		K("slides")
	];
}
function ke(e) {
	return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
}
function q(e, t) {
	let n = [];
	if (e) {
		let t = /* @__PURE__ */ new Date(), [r, i, a] = e.split("-").map(Number), o = new Date(r, i - 1, a), s = Math.round((o.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 864e5);
		s === 0 ? n.push(V.today) : s === 1 ? n.push(V.tomorrow) : s > 1 && s < 7 ? n.push(V.days[o.getDay()]) : n.push(z ? `${a} ${be[i - 1]}` : o.toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short"
		}));
	}
	if (t) {
		let [e, r] = t.split(":").map(Number), i = e % 12 || 12;
		n.push(z ? `${i}:${String(r).padStart(2, "0")} ${e < 12 ? "ص" : "م"}` : `${i}:${String(r).padStart(2, "0")} ${e < 12 ? "am" : "pm"}`);
	}
	return n.join(" · ");
}
function Ae(e) {
	let t = se(e);
	return t.title.trim() ? {
		id: xe(),
		title: t.title.trim(),
		due: t.due,
		time: t.time,
		priority: t.priority,
		done: !1
	} : null;
}
var J, Y = [];
function je(e) {
	e.classList.add("is-live");
	let t = e.querySelector(".live-title");
	t.textContent = W.title, t.contentEditable = "plaintext-only", t.spellcheck = !1, t.addEventListener("input", () => {
		W.title = t.textContent?.trim() || V.title, G(), Q();
	}), t.addEventListener("keydown", (e) => {
		e.key === "Enter" && (e.preventDefault(), i.focus());
	}), J = e.querySelector(".live-blocks");
	for (let e of W.blocks) J.append(X(e));
	let n = [
		{
			kind: "text",
			label: V.text,
			hint: V.textHint
		},
		{
			kind: "table",
			label: V.table,
			hint: V.tableHint
		},
		{
			kind: "tasks",
			label: V.tasks,
			hint: V.tasksHint
		},
		{
			kind: "drawing",
			label: V.drawing,
			hint: V.drawingHint
		},
		{
			kind: "slides",
			label: V.slides,
			hint: V.slidesHint
		}
	], r = e.querySelector(".live-add"), i = H("input", {
		class: "live-input",
		type: "text",
		placeholder: V.add,
		"aria-label": V.add,
		autocomplete: "off",
		role: "combobox",
		"aria-expanded": "false",
		"aria-controls": "live-menu"
	}), a = H("div", {
		class: "live-menu",
		id: "live-menu",
		role: "listbox",
		hidden: !0
	}), o = [], s = 0, c = () => {
		a.replaceChildren(...o.map((e, t) => H("button", {
			class: `live-menu-item${t === s ? " is-active" : ""}`,
			type: "button",
			role: "option",
			"aria-selected": String(t === s),
			onmousedown: (e) => e.preventDefault(),
			onclick: () => d(e.kind)
		}, H("span", { class: "mi-ic" }, U(e.kind, 18)), H("span", { class: "mi-text" }, H("strong", {}, e.label), H("small", {}, e.hint)))));
	}, l = (e) => {
		let t = e.toLowerCase();
		o = n.filter((e) => !t || e.label.toLowerCase().includes(t) || e.kind.includes(t)), s = 0, a.hidden = !o.length, i.setAttribute("aria-expanded", String(!a.hidden)), c();
	}, u = () => {
		a.hidden = !0, i.setAttribute("aria-expanded", "false");
	}, d = (e, t = "") => {
		let n = K(e, t);
		W.blocks.push(n), G();
		let r = X(n);
		J.append(r), B.matches || r.classList.add("lb-enter"), i.value = "", u(), Q(), (r.querySelector("[data-focus]") ?? i).focus({ preventScroll: !0 }), r.scrollIntoView({
			block: "nearest",
			behavior: B.matches ? "auto" : "smooth"
		});
	};
	i.addEventListener("input", () => i.value.startsWith("/") ? l(i.value.slice(1)) : u()), i.addEventListener("keydown", (e) => {
		if (!a.hidden) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault(), s = (s + (e.key === "ArrowDown" ? 1 : o.length - 1)) % o.length, c();
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault(), d(o[s].kind);
				return;
			}
			if (e.key === "Escape") {
				u();
				return;
			}
		}
		e.key === "Enter" && i.value.trim() && !i.value.startsWith("/") && (e.preventDefault(), d("text", i.value.trim()));
	}), i.addEventListener("blur", () => setTimeout(u, 120));
	let f = H("div", { class: "live-chips" }, ...n.map((e) => H("button", {
		class: "live-chip",
		type: "button",
		onclick: () => d(e.kind)
	}, U(e.kind, 16), H("span", {}, e.label))));
	r.replaceChildren(H("div", { class: "live-line" }, H("span", {
		class: "live-caret",
		"aria-hidden": "true"
	}, "/"), i, a), f);
	let p = e.querySelector(".live-foot");
	p && p.replaceChildren(H("p", { class: "live-kept" }, `${V.kept} ${V.handOff}`), H("div", { class: "live-actions" }, H("a", {
		class: "btn primary",
		href: ve,
		onclick: (e) => Ue(e)
	}, V.open), H("button", {
		class: "btn",
		type: "button",
		onclick: () => m()
	}, V.example), H("button", {
		class: "btn",
		type: "button",
		onclick: () => h()
	}, V.reset)));
	function m() {
		J.querySelectorAll(".lb[data-id]").forEach((e) => e.remove()), Y = [], W.blocks = Oe(), G();
		for (let e of W.blocks) {
			let t = X(e);
			J.append(t), B.matches || t.classList.add("lb-enter");
		}
		Q();
	}
	location.hash === "#example" && m();
	function h() {
		W = {
			v: 1,
			title: V.title,
			blocks: []
		}, G(), t.textContent = W.title, J.querySelectorAll(".lb[data-id]").forEach((e) => e.remove()), Y = [];
	}
}
function X(e) {
	let t = H("div", { class: "lb-body" }), n = H("button", {
		class: "lb-grip",
		type: "button",
		"aria-label": V.grip,
		title: V.grip
	}, U("grip", 18)), r = H("button", {
		class: "lb-remove",
		type: "button",
		"aria-label": V.remove,
		title: V.remove
	}, U("close", 16)), i = H("div", {
		class: `lb lb-${e.kind}`,
		"data-id": e.id
	}, n, t, r);
	return r.addEventListener("click", () => {
		W.blocks = W.blocks.filter((t) => t.id !== e.id), G(), i.remove(), Q();
	}), ze(i, n), e.kind === "text" && t.append(Me(e)), e.kind === "table" && t.append(Ne(e)), e.kind === "tasks" && t.append(Pe(e)), e.kind === "drawing" && t.append(Ie(e)), e.kind === "slides" && t.append(Re(e)), i;
}
function Me(e) {
	let t = H("p", {
		class: "lt-text",
		"data-focus": ""
	});
	return t.contentEditable = "plaintext-only", t.textContent = e.text ?? "", t.addEventListener("input", () => {
		e.text = t.textContent ?? "", G(), Q();
	}), t;
}
function Ne(e) {
	let t = u(), n = t.sheets[0], r = {
		r: 4,
		c: 1
	}, i = H("span", { class: "tb-ref" }), a = H("input", {
		class: "tb-input",
		type: "text",
		"aria-label": V.formula,
		spellcheck: "false",
		"data-focus": ""
	}), s = H("table", { class: "tb-grid" }), c = H("p", { class: "tb-tip" }, `${V.tableTip[0]} `, H("code", { dir: "ltr" }, V.tableTip[1])), l = {}, d = () => {
		n.cells = {};
		for (let [t, r] of Object.entries(e.cells ?? {})) r && (n.cells[t] = { v: r });
		l = v(t)[n.id] ?? {};
	}, f = (t = []) => {
		let n = H("tr", {}, H("th", { class: "tb-corner" }), ...Array.from({ length: 2 }, (e, t) => H("th", { scope: "col" }, String.fromCharCode(65 + t)))), c = Array.from({ length: 6 }, (e, n) => H("tr", {}, H("th", { scope: "row" }, String(n + 1)), ...Array.from({ length: 2 }, (e, i) => {
			let a = o(n, i), s = l[a];
			return H("td", {
				class: [
					n === 0 ? "is-head" : "",
					s?.isFormula ? "is-formula" : "",
					s?.numeric !== null && s?.numeric !== void 0 ? "is-num" : "",
					r.r === n && r.c === i ? "is-sel" : "",
					t.includes(a) ? "is-flash" : ""
				].filter(Boolean).join(" "),
				tabindex: r.r === n && r.c === i ? 0 : -1,
				"data-r": n,
				"data-c": i
			}, s?.error ? H("span", { class: "tb-err" }, s.display || "#ERR") : s?.display ?? "");
		})));
		s.replaceChildren(H("thead", {}, n), H("tbody", {}, ...c)), i.textContent = o(r.r, r.c), document.activeElement !== a && (a.value = e.cells?.[o(r.r, r.c)] ?? "");
	}, p = () => {
		let t = o(r.r, r.c), n = { ...l }, i = a.value.trim();
		i ? e.cells[t] = i : delete e.cells[t], G(), d();
		let s = Object.keys(l).filter((e) => l[e]?.display !== n[e]?.display);
		f(B.matches ? [] : s), Q();
	}, m = (t, n, i = !0) => {
		r = {
			r: Math.max(0, Math.min(5, t)),
			c: Math.max(0, Math.min(1, n))
		}, a.value = e.cells?.[o(r.r, r.c)] ?? "", f(), i && s.querySelector(".is-sel")?.focus();
	};
	return s.addEventListener("click", (e) => {
		let t = e.target.closest("td");
		t && m(Number(t.dataset.r), Number(t.dataset.c));
	}), s.addEventListener("dblclick", () => a.focus()), s.addEventListener("keydown", (e) => {
		let t = z ? -1 : 1, n = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -t],
			ArrowRight: [0, t]
		};
		n[e.key] ? (e.preventDefault(), m(r.r + n[e.key][0], r.c + n[e.key][1])) : e.key === "Enter" || e.key === "F2" ? (e.preventDefault(), a.focus()) : e.key === "Delete" || e.key === "Backspace" ? (a.value = "", p()) : e.key.length === 1 && !e.ctrlKey && !e.metaKey && (e.preventDefault(), a.value = e.key, a.focus());
	}), a.addEventListener("keydown", (t) => {
		t.key === "Enter" ? (t.preventDefault(), p(), m(r.r + 1, r.c)) : t.key === "Escape" && (a.value = e.cells?.[o(r.r, r.c)] ?? "", s.querySelector(".is-sel")?.focus());
	}), a.addEventListener("blur", () => {
		(e.cells?.[o(r.r, r.c)] ?? "") !== a.value.trim() && p();
	}), d(), f(), H("div", { class: "tb" }, H("div", { class: "tb-bar" }, i, H("span", {
		class: "tb-fx",
		"aria-hidden": "true"
	}, "fx"), a), H("div", { class: "tb-scroll" }, s), c);
}
function Pe(e) {
	let t = H("ul", { class: "tk-list" }), n = H("p", {
		class: "tk-preview",
		"aria-live": "polite"
	}), r = H("input", {
		class: "tk-input",
		type: "text",
		placeholder: V.taskInput,
		"aria-label": V.taskInput,
		"data-focus": ""
	}), i = () => {
		t.replaceChildren(...(e.tasks ?? []).map((e) => {
			let t = H("input", {
				type: "checkbox",
				id: `tk-${e.id}`,
				checked: e.done
			});
			t.addEventListener("change", () => {
				e.done = t.checked, r.classList.toggle("is-done", e.done), G(), Q();
			});
			let n = q(e.due, e.time), r = H("li", { class: `tk-item${e.done ? " is-done" : ""}` }, t, H("label", { for: `tk-${e.id}` }, e.title), n ? H("span", { class: `tk-chip${e.due === ke(/* @__PURE__ */ new Date()) ? " is-today" : ""}` }, n) : null, e.priority >= 2 ? H("span", { class: "tk-chip is-high" }, V.high) : null);
			return r;
		}));
	}, a = () => {
		let e = r.value.trim();
		if (!e) {
			n.textContent = "";
			return;
		}
		let t = se(e), i = q(t.due, t.time);
		n.replaceChildren(H("span", { class: "tk-will" }, `${V.willAdd}:`), H("strong", {}, t.title.trim() || e), i ? H("span", { class: "tk-chip" }, i) : null, t.priority >= 2 ? H("span", { class: "tk-chip is-high" }, V.high) : null);
	};
	return r.addEventListener("input", a), r.addEventListener("keydown", (n) => {
		if (n.key !== "Enter") return;
		n.preventDefault();
		let o = Ae(r.value);
		o && (e.tasks.push(o), G(), r.value = "", a(), i(), B.matches || t.lastElementChild?.classList.add("tk-enter"), Q());
	}), i(), H("div", { class: "tk" }, t, H("div", { class: "tk-add" }, r), n);
}
var Z = [
	"--ink",
	"--terra",
	"--teal"
];
function Fe(e) {
	return getComputedStyle(document.documentElement).getPropertyValue(e).trim() || "#2a2420";
}
function Ie(e) {
	let t = H("canvas", {
		class: "dr-canvas",
		"aria-label": V.draw,
		role: "img",
		"data-focus": ""
	}), n = H("p", { class: "dr-hint" }, V.draw), r = Z[0], i = !0, a = Z.map((e, t) => H("button", {
		class: `dr-swatch dr-${t}${t === 0 ? " is-on" : ""}`,
		type: "button",
		"aria-label": V.colors[t],
		"aria-pressed": String(t === 0),
		onclick: () => o(t)
	})), o = (e) => {
		r = Z[e], a.forEach((t, n) => {
			t.classList.toggle("is-on", e === n), t.setAttribute("aria-pressed", String(e === n));
		});
	}, s = H("button", {
		class: "dr-tool is-on",
		type: "button",
		"aria-pressed": "true"
	}, V.straighten);
	s.addEventListener("click", () => {
		i = !i, s.classList.toggle("is-on", i), s.setAttribute("aria-pressed", String(i));
	});
	let c = H("button", {
		class: "dr-tool",
		type: "button",
		"aria-label": V.undo,
		title: V.undo
	}, U("undo", 16));
	c.addEventListener("click", () => {
		e.strokes.pop(), G(), _(), Q();
	});
	let l = H("button", {
		class: "dr-tool",
		type: "button"
	}, V.clear);
	l.addEventListener("click", () => {
		e.strokes = [], G(), _(), Q();
	});
	let u = t.getContext("2d"), d = 0, f = 0, p = (e) => ({
		...N,
		kind: "ink",
		size: 5,
		smoothing: .35,
		taperStart: .12,
		taperEnd: .2,
		color: e
	}), m = () => {
		let e = t.getBoundingClientRect();
		if (!e.width) return;
		let n = Math.min(2, window.devicePixelRatio || 1);
		d = e.width, f = e.height, t.width = Math.round(d * n), t.height = Math.round(f * n), u.setTransform(n, 0, 0, n, 0, 0), _();
	}, h = (e) => {
		let t = [];
		for (let n = 0; n < e.length; n += 3) t.push({
			x: e[n] * d,
			y: e[n + 1] * f,
			pressure: e[n + 2],
			tiltX: 0,
			tiltY: 0,
			time: n
		});
		return t;
	}, g = (e, t = 1) => {
		let n = Fe(e.color);
		if (u.globalAlpha = t, e.shape) Le(u, e.shape, n, d, f);
		else {
			u.fillStyle = n;
			for (let r of ge(h(e.pts), p(n))) u.globalAlpha = t * r.opacity, u.beginPath(), u.arc(r.x, r.y, Math.max(.6, r.size / 2), 0, Math.PI * 2), u.fill();
		}
		u.globalAlpha = 1;
	}, _ = (t) => {
		u.clearRect(0, 0, d, f);
		for (let t of e.strokes ?? []) g(t);
		t && g(t), n.hidden = !!(e.strokes?.length || t);
	}, v = null;
	t.addEventListener("pointerdown", (e) => {
		(!d || !f) && m(), De(t, e.pointerId), v = {
			color: r,
			pts: []
		}, y(e);
	});
	let y = (e) => {
		if (!v) return;
		let n = t.getBoundingClientRect(), r = typeof e.getCoalescedEvents == "function" ? e.getCoalescedEvents() : [e];
		for (let t of r.length ? r : [e]) {
			let e = t.pointerType === "mouse" || !t.pressure ? .55 : t.pressure;
			v.pts.push((t.clientX - n.left) / (n.width || 1), (t.clientY - n.top) / (n.height || 1), e);
		}
		_(v);
	};
	t.addEventListener("pointermove", (e) => v && y(e));
	let b = () => {
		if (!v) return;
		let t = v;
		if (v = null, t.pts.length < 6) return _();
		let n = null;
		if (i) {
			let e = [];
			for (let n = 0; n < t.pts.length; n += 3) e.push({
				x: t.pts[n] * d,
				y: t.pts[n + 1] * f
			});
			n = he(e);
		}
		if (!n || n.confidence < .6) {
			e.strokes.push(t), G(), _(), Q();
			return;
		}
		let r = {
			color: t.color,
			pts: t.pts,
			shape: {
				kind: n.shape,
				x: n.rect.x / d,
				y: n.rect.y / f,
				w: n.rect.w / d,
				h: n.rect.h / f,
				points: n.points?.flatMap((e) => [e.x / d, e.y / f])
			}
		};
		if (e.strokes.push(r), G(), Q(), B.matches) return _();
		let a = performance.now(), o = (n) => {
			let i = Math.min(1, (n - a) / 320);
			u.clearRect(0, 0, d, f);
			for (let t of e.strokes.slice(0, -1)) g(t);
			g({
				color: t.color,
				pts: t.pts
			}, 1 - i), g(r, i), i < 1 && requestAnimationFrame(o);
		};
		requestAnimationFrame(o);
	};
	return t.addEventListener("pointerup", b), t.addEventListener("pointercancel", b), new ResizeObserver(m).observe(t), matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => _()), H("div", { class: "dr" }, H("div", { class: "dr-bar" }, H("div", {
		class: "dr-swatches",
		role: "group",
		"aria-label": V.drawing
	}, ...a), H("span", { class: "dr-space" }), s, c, l), H("div", { class: "dr-stage" }, t, n));
}
function Le(e, t, n, r, i) {
	let a = t.x * r, o = t.y * i, s = t.w * r, c = t.h * i;
	if (e.strokeStyle = n, e.lineWidth = 4, e.lineJoin = "round", e.lineCap = "round", e.beginPath(), t.kind === "ellipse") e.ellipse(a + s / 2, o + c / 2, Math.max(1, s / 2), Math.max(1, c / 2), 0, 0, Math.PI * 2);
	else if (t.kind === "rect" || t.kind === "roundrect") e.roundRect(a, o, s, c, t.kind === "roundrect" ? 14 : 4);
	else if (t.points && t.points.length >= 4) {
		e.moveTo(t.points[0] * r, t.points[1] * i);
		for (let n = 2; n < t.points.length; n += 2) e.lineTo(t.points[n] * r, t.points[n + 1] * i);
		t.kind !== "line" && e.closePath();
	} else t.kind === "triangle" ? (e.moveTo(a + s / 2, o), e.lineTo(a + s, o + c), e.lineTo(a, o + c), e.closePath()) : t.kind === "right-triangle" ? (e.moveTo(a, o), e.lineTo(a, o + c), e.lineTo(a + s, o + c), e.closePath()) : (e.moveTo(a, o), e.lineTo(a + s, o + c));
	e.stroke();
}
function Re(e) {
	let t = 0, n = H("div", {
		class: "sl-stage",
		tabindex: 0,
		"aria-roledescription": V.slides
	}), r = H("span", { class: "sl-count" }), i = H("button", {
		class: "sl-btn sl-prev",
		type: "button",
		"aria-label": V.prev
	}, U("chevron", 18)), a = H("button", {
		class: "sl-btn sl-next",
		type: "button",
		"aria-label": V.next
	}, U("chevron", 18)), s = H("button", {
		class: "sl-btn",
		type: "button",
		"aria-label": V.full,
		title: V.full
	}, U("expand", 16)), c = () => {
		let e = [H("div", { class: "sl-slide sl-cover" }, H("p", { class: "sl-kicker" }, "Worlds"), H("h3", {}, W.title))];
		for (let t of W.blocks) {
			if (t.kind === "text" && t.text && e.push(H("div", { class: "sl-slide" }, H("p", { class: "sl-text" }, t.text))), t.kind === "tasks" && t.tasks?.length && e.push(H("div", { class: "sl-slide" }, H("h3", {}, V.tasks), H("ul", { class: "sl-tasks" }, ...t.tasks.map((e) => H("li", { class: e.done ? "is-done" : "" }, e.title, e.due || e.time ? H("small", {}, q(e.due, e.time)) : null))))), t.kind === "table" && t.cells) {
				let n = u();
				for (let [e, r] of Object.entries(t.cells)) n.sheets[0].cells[e] = { v: r };
				let r = v(n)[n.sheets[0].id] ?? {}, i = Array.from({ length: 6 }, (e, t) => [0, 1].map((e) => r[o(t, e)]?.display ?? "")).filter((e) => e.some(Boolean));
				e.push(H("div", { class: "sl-slide" }, H("h3", {}, V.table), H("table", { class: "sl-table" }, ...i.map((e, t) => H("tr", {}, ...e.map((e) => H(t === 0 ? "th" : "td", {}, e)))))));
			}
			if (t.kind === "drawing" && t.strokes?.length) {
				let n = document.querySelector(`[data-id="${t.id}"] canvas`);
				if (n) {
					let t = H("canvas", { class: "sl-drawing" });
					t.width = n.width, t.height = n.height, t.getContext("2d").drawImage(n, 0, 0), e.push(H("div", { class: "sl-slide" }, t));
				}
			}
		}
		return e;
	}, l = () => {
		let e = c();
		t = Math.max(0, Math.min(e.length - 1, t));
		let o = e[t];
		e.length === 1 && !W.blocks.some((e) => e.kind !== "slides") && o.append(H("p", { class: "sl-empty" }, V.emptyPage)), n.replaceChildren(o), r.textContent = `${V.slide} ${t + 1} ${V.of} ${e.length}`, i.disabled = t === 0, a.disabled = t === e.length - 1;
	};
	i.addEventListener("click", () => {
		t--, l();
	}), a.addEventListener("click", () => {
		t++, l();
	}), n.addEventListener("keydown", (e) => {
		let n = z ? "ArrowLeft" : "ArrowRight", r = z ? "ArrowRight" : "ArrowLeft";
		e.key === n || e.key === " " || e.key === "PageDown" ? (e.preventDefault(), t++, l()) : (e.key === r || e.key === "PageUp") && (e.preventDefault(), t--, l());
	});
	let d = H("div", { class: "sl" }, n, H("div", { class: "sl-bar" }, i, r, a, H("span", { class: "dr-space" }), s));
	return s.addEventListener("click", () => {
		document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen?.().then(() => n.focus());
	}), Y.push(l), l(), d;
}
function Q() {
	for (let e of Y) try {
		e();
	} catch {}
}
function ze(e, t) {
	t.addEventListener("keydown", (n) => {
		if (n.key !== "ArrowUp" && n.key !== "ArrowDown") return;
		n.preventDefault();
		let r = n.key === "ArrowUp" ? e.previousElementSibling : e.nextElementSibling;
		r && r.dataset.id && (Be(() => n.key === "ArrowUp" ? r.before(e) : r.after(e)), Ve(), t.focus());
	}), t.addEventListener("pointerdown", (n) => {
		n.preventDefault(), De(t, n.pointerId);
		let r = n.clientY, i = 0;
		e.classList.add("is-dragging");
		let a = (t) => {
			e.style.setProperty("--drag-y", `${t.clientY - r - i}px`);
			let n = e.getBoundingClientRect(), a = n.top + n.height / 2, o = [...J.querySelectorAll(".lb[data-id]")].filter((t) => t !== e).find((e) => {
				let t = e.getBoundingClientRect();
				return a < t.top + t.height / 2;
			}) ?? null;
			if (o ? e.nextElementSibling === o : e === J.lastElementChild) return;
			let s = e.offsetTop;
			Be(() => o ? o.before(e) : J.append(e), e), i += e.offsetTop - s, e.style.setProperty("--drag-y", `${t.clientY - r - i}px`);
		}, o = () => {
			t.removeEventListener("pointermove", a), e.classList.remove("is-dragging"), e.style.removeProperty("--drag-y"), Ve();
		};
		t.addEventListener("pointermove", a), t.addEventListener("pointerup", o, { once: !0 }), t.addEventListener("pointercancel", o, { once: !0 });
	});
}
function Be(e, t) {
	let n = [...J.querySelectorAll(".lb[data-id]")].filter((e) => e !== t), r = new Map(n.map((e) => [e, e.getBoundingClientRect().top]));
	if (e(), !B.matches) for (let e of n) {
		let t = (r.get(e) ?? 0) - e.getBoundingClientRect().top;
		t && e.animate([{ transform: `translateY(${t}px)` }, { transform: "translateY(0)" }], {
			duration: 220,
			easing: "cubic-bezier(0.2, 0.7, 0.2, 1)"
		});
	}
}
function Ve() {
	let e = [...J.querySelectorAll(".lb[data-id]")].map((e) => e.dataset.id);
	W.blocks = e.map((e) => Ee(e)).filter((e) => !!e), G(), Q();
}
function He() {
	let e = [];
	for (let t of W.blocks) if (t.kind === "text" && t.text?.trim() && e.push(t.text.trim()), t.kind === "tasks" && t.tasks?.length && e.push(t.tasks.map((e) => `- [${e.done ? "x" : " "}] ${e.title}${e.due || e.time ? ` (${q(e.due, e.time)})` : ""}`).join("\n")), t.kind === "table" && t.cells) {
		let n = u();
		for (let [e, r] of Object.entries(t.cells)) n.sheets[0].cells[e] = { v: r };
		let r = v(n)[n.sheets[0].id] ?? {}, i = Array.from({ length: 6 }, (e, t) => [0, 1].map((e) => (r[o(t, e)]?.display ?? "").replace(/\|/g, "/"))).filter((e) => e.some(Boolean));
		i.length && e.push([
			`| ${i[0].join(" | ")} |`,
			"|---|---|",
			...i.slice(1).map((e) => `| ${e.join(" | ")} |`)
		].join("\n"));
	}
	return e.join("\n\n");
}
function Ue(e) {
	let t = JSON.stringify({
		title: W.title,
		markdown: He()
	}), n = new TextEncoder().encode(t), r = "";
	for (let e of n) r += String.fromCharCode(e);
	let i = btoa(r).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	e.currentTarget.href = `${ve}/#page=${i}`;
}
var $ = document.querySelector("[data-live]");
$ && je($);
//#endregion
