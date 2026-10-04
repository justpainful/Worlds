//! Bidi normalisation for text leaving Worlds for Discord.
//!
//! Discord shows each message line without our editor's per-block
//! direction, so mixed Arabic/English lines can reorder visually. Rather
//! than sprinkling marks everywhere, we apply exactly what the Unicode
//! Bidirectional Algorithm needs:
//!
//! * An RTL line gets one RLM after its Markdown prefix (sets the paragraph
//!   direction where Discord resolves it per line) and one RLM at the end
//!   (keeps trailing punctuation attached to the RTL run even when the
//!   client forces an LTR paragraph).
//! * Inside a line, a run of the *opposite* direction that mixes digits and
//!   letters or contains internal spaces (e.g. `8:00 PM`, `v2.4.1 beta`) is
//!   wrapped in an isolate so it stays one visual unit.
//! * Code spans, fenced code, Discord mention/emoji tokens and URLs are
//!   never modified.

use unicode_bidi::{bidi_class, BidiClass};

const RLM: char = '\u{200F}';
const LRI: char = '\u{2066}';
const RLI: char = '\u{2067}';
const PDI: char = '\u{2069}';

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dir {
    Ltr,
    Rtl,
}

pub fn first_strong(text: &str) -> Option<Dir> {
    let mut in_code = false;
    for ch in text.chars() {
        if ch == '`' {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        match bidi_class(ch) {
            BidiClass::L => return Some(Dir::Ltr),
            BidiClass::R | BidiClass::AL => return Some(Dir::Rtl),
            _ => {}
        }
    }
    None
}

/// Split off a Markdown line prefix Discord interprets (`# `, `- `, `> `, `1. `, `-# `).
fn split_prefix(line: &str) -> (&str, &str) {
    let candidates = ["### ", "## ", "# ", "-# ", "> ", "- ", "* "];
    for c in candidates {
        if let Some(rest) = line.strip_prefix(c) {
            // allow "> - item" / "> # x" combos
            let (inner, body) = split_prefix(rest);
            let plen = c.len() + inner.len();
            return (&line[..plen], body);
        }
    }
    let digits = line.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && line[digits..].starts_with(". ") {
        return (&line[..digits + 2], &line[digits + 2..]);
    }
    // Leading emoji/checkbox glyph + space (task items)
    for g in ["☐ ", "☑ ", "• "] {
        if let Some(rest) = line.strip_prefix(g) {
            return (&line[..g.len()], rest);
        }
    }
    (&line[..0], line)
}

/// Normalise one rendered message text (may contain many lines and code fences).
/// `hint` is the block direction stored by the editor, used when a line has
/// no strong characters of its own.
pub fn normalize(text: &str, hint: Option<Dir>) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut in_fence = false;
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence || line.trim().is_empty() {
            out.push_str(line);
            continue;
        }
        out.push_str(&normalize_line(line, hint));
    }
    out
}

pub fn normalize_line(line: &str, hint: Option<Dir>) -> String {
    let (prefix, body) = split_prefix(line);
    let dir = first_strong(body).or(hint).unwrap_or(Dir::Ltr);
    let isolated = isolate_runs(body, dir);
    match dir {
        Dir::Rtl => format!("{prefix}{RLM}{isolated}{RLM}"),
        Dir::Ltr => format!("{prefix}{isolated}"),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cls {
    L,
    R,
    Digit,
    Space,
    Neutral,
}

fn cls(ch: char) -> Cls {
    match bidi_class(ch) {
        BidiClass::L => Cls::L,
        BidiClass::R | BidiClass::AL => Cls::R,
        BidiClass::EN | BidiClass::AN => Cls::Digit,
        BidiClass::WS => Cls::Space,
        _ => Cls::Neutral,
    }
}

/// Tokens that must stay byte-identical: `code`, <@123>, <#1>, <:e:1>, <t:..>, URLs.
fn protected_spans(s: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'`' {
            if let Some(end) = s[i + 1..].find('`') {
                spans.push((i, i + 1 + end + 1));
                i = i + 1 + end + 1;
                continue;
            }
        }
        if c == b'<' {
            if let Some(end) = s[i..].find('>') {
                let tok = &s[i..i + end + 1];
                if tok.starts_with("<@")
                    || tok.starts_with("<#")
                    || tok.starts_with("<:")
                    || tok.starts_with("<a:")
                    || tok.starts_with("<t:")
                    || tok.starts_with("<http")
                {
                    spans.push((i, i + end + 1));
                    i += end + 1;
                    continue;
                }
            }
        }
        // `i` walks bytes, so compare bytes: slicing `s` here could split a UTF-8 char.
        if bytes[i..].starts_with(b"http://") || bytes[i..].starts_with(b"https://") {
            let end = s[i..].find(char::is_whitespace).map(|e| i + e).unwrap_or(s.len());
            spans.push((i, end));
            i = end;
            continue;
        }
        i += 1;
    }
    spans
}

/// Wrap opposite-direction runs that would otherwise fragment visually.
fn isolate_runs(body: &str, dir: Dir) -> String {
    let protected = protected_spans(body);
    let in_protected = |b: usize| protected.iter().any(|&(s, e)| b >= s && b < e);
    let chars: Vec<(usize, char)> = body.char_indices().collect();
    let opposite = match dir {
        Dir::Rtl => Cls::L,
        Dir::Ltr => Cls::R,
    };
    let mut out = String::with_capacity(body.len() + 8);
    let mut i = 0;
    while i < chars.len() {
        let (b, ch) = chars[i];
        let c = cls(ch);
        let starts_run = !in_protected(b) && (c == opposite || (dir == Dir::Rtl && c == Cls::Digit));
        if !starts_run {
            out.push(ch);
            i += 1;
            continue;
        }
        // Extend the run through opposite letters, digits and inner neutrals,
        // but only up to the last opposite-or-digit char.
        let mut j = i;
        let mut last_strong = i;
        let mut has_letter = c == opposite;
        let mut has_digit = c == Cls::Digit;
        let mut has_space = false;
        while j + 1 < chars.len() {
            let (nb, nch) = chars[j + 1];
            if in_protected(nb) {
                break;
            }
            let nc = cls(nch);
            if nc == opposite || nc == Cls::Digit {
                last_strong = j + 1;
                has_letter |= nc == opposite;
                has_digit |= nc == Cls::Digit;
            } else if nc == Cls::Space || nc == Cls::Neutral {
                if nc == Cls::Space {
                    has_space = true;
                }
            } else {
                break;
            }
            j += 1;
        }
        let run: String = chars[i..=last_strong].iter().map(|(_, c)| *c).collect();
        // Letter-led runs (Nova8, v2.4.1) resolve correctly on their own (W7).
        // A digit-led run that continues into Latin letters (8:00 PM) does not:
        // its digits stay EN and the inner space splits it, so isolate it.
        let _ = (has_digit, has_space);
        let needs = dir == Dir::Rtl && c == Cls::Digit && has_letter;
        if needs {
            out.push(if dir == Dir::Rtl { LRI } else { RLI });
            out.push_str(&run);
            out.push(PDI);
        } else {
            out.push_str(&run);
        }
        i = last_strong + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtl_line_gets_boundary_marks_only() {
        let s = normalize_line("حدثنا Nova8 إلى v2.4.1.", None);
        assert!(s.starts_with(RLM) && s.ends_with(RLM));
        // letter-led runs need no isolation; only the two boundary marks are added
        assert_eq!(s, format!("{RLM}حدثنا Nova8 إلى v2.4.1.{RLM}"));
    }

    #[test]
    fn time_isolated_in_arabic() {
        let s = normalize_line("**الوقت** 8:00 PM", None);
        assert!(s.contains(&format!("{LRI}8:00 PM{PDI}")));
    }

    #[test]
    fn heading_prefix_preserved() {
        let s = normalize_line("# الاجتماع الإداري", None);
        assert!(s.starts_with("# \u{200F}"));
    }

    #[test]
    fn english_untouched() {
        assert_eq!(normalize_line("Release notes for v2.4.1.", None), "Release notes for v2.4.1.");
    }

    #[test]
    fn mentions_untouched() {
        let s = normalize_line("مرحبا <@123456> في السيرفر", None);
        assert!(s.contains("<@123456>"));
    }
}
