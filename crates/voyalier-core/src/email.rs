//! Best-effort extraction of a confirmation body from a raw RFC 822 email.
//!
//! Deliberately dependency-light (matching the JSON-LD parser's string-scan
//! approach): it splits headers from the body, walks a multipart tree preferring
//! the `text/html` part (so the JSON-LD parser can run) over `text/plain`, and
//! decodes quoted-printable and base64 transfer encodings. UTF-8 is assumed;
//! exotic charsets and attachments are out of scope for this first slice — the
//! extracted body then flows through the same parsers as any pasted document.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

use crate::DocumentKind;

/// The most useful body found in an email, plus its subject for a default label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailBody {
    /// `Html` when a `text/html` part was chosen (JSON-LD parseable), else
    /// `PastedText`. Never `Email` — the caller stores the extracted body.
    pub kind: DocumentKind,
    pub content: String,
    pub subject: Option<String>,
}

/// Extract the best confirmation body from a raw email. Always returns a body:
/// input that is not a recognizable email is treated as pasted text, so a user
/// who pastes just the email body still gets a sensible result.
pub fn extract_email_body(raw: &str) -> EmailBody {
    let (headers, _) = split_headers_and_body(raw);
    let subject = header_value(&headers, "subject").map(|value| decode_rfc2047(&value));

    match best_part(raw, 0) {
        Some((kind, content)) => EmailBody {
            kind,
            content: content.trim().to_owned(),
            subject,
        },
        // No text part was found. If this was a recognizable email (e.g. an
        // attachment-only e-ticket), return an EMPTY body — importing the raw
        // MIME headers + base64 blob would be wrong and would store recipient
        // headers in cleartext. Non-email input (no headers) still falls back to
        // plain text so a pasted body works.
        None => EmailBody {
            kind: DocumentKind::PastedText,
            content: if headers.is_empty() {
                raw.trim().to_owned()
            } else {
                String::new()
            },
            subject,
        },
    }
}

/// Cap on multipart nesting depth. Real confirmation emails nest 2-3 levels;
/// this bounds recursion so a crafted deeply-nested email cannot overflow the
/// stack (an uncatchable abort), and — with the raw-length check at import —
/// keeps the parse cost linear.
const MAX_MULTIPART_DEPTH: usize = 20;

/// Recursively process one MIME entity (`headers\n\n body`), returning the best
/// `(kind, decoded body)` or `None` for a non-text part (image/attachment) or
/// once nesting exceeds `MAX_MULTIPART_DEPTH`.
fn best_part(entity: &str, depth: usize) -> Option<(DocumentKind, String)> {
    if depth > MAX_MULTIPART_DEPTH {
        return None;
    }
    let (headers, body) = split_headers_and_body(entity);
    let content_type = header_value(&headers, "content-type").unwrap_or_default();
    let ct_lower = content_type.to_ascii_lowercase();

    if let Some(boundary) = multipart_boundary(&content_type) {
        // Prefer HTML, then plain text, recursing into each part.
        let mut html: Option<String> = None;
        let mut text: Option<String> = None;
        for part in split_parts(body, &boundary) {
            match best_part(part, depth + 1) {
                Some((DocumentKind::Html, content)) if html.is_none() => html = Some(content),
                Some((DocumentKind::PastedText, content)) if text.is_none() => text = Some(content),
                _ => {}
            }
        }
        return html
            .map(|content| (DocumentKind::Html, content))
            .or_else(|| text.map(|content| (DocumentKind::PastedText, content)));
    }

    // A leaf entity. Treat missing/`text/*` content types as text; skip the rest.
    if ct_lower.is_empty() || ct_lower.starts_with("text/") {
        let cte = header_value(&headers, "content-transfer-encoding").unwrap_or_default();
        let decoded = decode_transfer_encoding(body, &cte);
        let kind = if ct_lower.contains("text/html") {
            DocumentKind::Html
        } else {
            DocumentKind::PastedText
        };
        return Some((kind, decoded));
    }
    None
}

/// Split an entity into parsed headers and the remaining body. Returns empty
/// headers (and the whole input as the body) unless the block before the first
/// blank line looks like a real header block — so pasted prose that happens to
/// contain a "Key: value" line is not mistaken for an email.
fn split_headers_and_body(entity: &str) -> (Vec<(String, String)>, &str) {
    let (head, body) = match find_blank_line(entity) {
        Some((end, body_start)) => (&entity[..end], &entity[body_start..]),
        None => return (Vec::new(), entity),
    };
    let headers = parse_headers(head);
    let recognized = headers.iter().any(|(name, _)| {
        matches!(
            name.as_str(),
            "content-type"
                | "content-transfer-encoding"
                | "mime-version"
                | "from"
                | "to"
                | "subject"
                | "date"
                | "message-id"
        )
    });
    if recognized {
        (headers, body)
    } else {
        (Vec::new(), entity)
    }
}

/// Byte offset of the first blank line: returns `(end_of_headers, start_of_body)`
/// handling both `\r\n\r\n` and `\n\n`.
fn find_blank_line(text: &str) -> Option<(usize, usize)> {
    if let Some(pos) = text.find("\r\n\r\n") {
        return Some((pos, pos + 4));
    }
    if let Some(pos) = text.find("\n\n") {
        return Some((pos, pos + 2));
    }
    None
}

/// Parse header lines into `(lowercased name, value)`, unfolding continuation
/// lines (those beginning with a space or tab belong to the previous header).
fn parse_headers(head: &str) -> Vec<(String, String)> {
    let mut headers: Vec<(String, String)> = Vec::new();
    for line in head.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = headers.last_mut() {
                last.1.push(' ');
                last.1.push_str(line.trim());
            }
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
        }
    }
    headers
}

fn header_value(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

/// The `boundary=` parameter of a `multipart/*` content type, if any.
fn multipart_boundary(content_type: &str) -> Option<String> {
    if !content_type.to_ascii_lowercase().starts_with("multipart/") {
        return None;
    }
    for param in content_type.split(';').skip(1) {
        let param = param.trim();
        if let Some(rest) = param
            .strip_prefix("boundary=")
            .or_else(|| param.strip_prefix("BOUNDARY="))
        {
            return Some(rest.trim().trim_matches('"').to_owned());
        }
    }
    None
}

/// Split a multipart body into its parts on the `--boundary` delimiters,
/// dropping the preamble and the closing `--boundary--`.
fn split_parts<'a>(body: &'a str, boundary: &str) -> Vec<&'a str> {
    let delimiter = format!("--{boundary}");
    let mut parts = Vec::new();
    let mut segments = body.split(delimiter.as_str());
    // Drop the preamble before the first boundary.
    segments.next();
    for segment in segments {
        // The closing delimiter is `--boundary--`; its segment starts with "--".
        if segment.starts_with("--") {
            break;
        }
        // Trim the CRLF that follows the boundary line.
        let part = segment
            .strip_prefix("\r\n")
            .or_else(|| segment.strip_prefix('\n'))
            .unwrap_or(segment);
        parts.push(part);
    }
    parts
}

/// Decode a body per its `Content-Transfer-Encoding`. Unknown/identity encodings
/// (7bit, 8bit, binary, none) pass through unchanged.
fn decode_transfer_encoding(body: &str, cte: &str) -> String {
    match cte.trim().to_ascii_lowercase().as_str() {
        "quoted-printable" => decode_quoted_printable(body),
        "base64" => {
            let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
            match BASE64.decode(compact.as_bytes()) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(_) => body.to_owned(),
            }
        }
        _ => body.to_owned(),
    }
}

/// Decode quoted-printable: `=XX` hex escapes and soft line breaks (`=` at end
/// of line). Invalid escapes are left verbatim.
fn decode_quoted_printable(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut bytes = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '=' {
            // Soft line break: `=\r\n` or `=\n`.
            if chars.get(i + 1) == Some(&'\r') && chars.get(i + 2) == Some(&'\n') {
                i += 3;
                continue;
            }
            if chars.get(i + 1) == Some(&'\n') {
                i += 2;
                continue;
            }
            // `=XX` hex byte.
            if let (Some(h), Some(l)) = (chars.get(i + 1), chars.get(i + 2)) {
                if let (Some(hi), Some(lo)) = (h.to_digit(16), l.to_digit(16)) {
                    bytes.push((hi * 16 + lo) as u8);
                    i += 3;
                    continue;
                }
            }
            flush_bytes(&mut bytes, &mut out);
            out.push('=');
            i += 1;
        } else {
            flush_bytes(&mut bytes, &mut out);
            out.push(chars[i]);
            i += 1;
        }
    }
    flush_bytes(&mut bytes, &mut out);
    out
}

fn flush_bytes(bytes: &mut Vec<u8>, out: &mut String) {
    if !bytes.is_empty() {
        out.push_str(&String::from_utf8_lossy(bytes));
        bytes.clear();
    }
}

/// Minimal RFC 2047 decode for a header value: handles `=?UTF-8?B?..?=` and
/// `=?UTF-8?Q?..?=` encoded-words (the common case for subjects), leaving other
/// text — including unknown charsets — as-is.
fn decode_rfc2047(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("=?") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        // charset?enc?text?=
        let Some((charset, tail)) = after.split_once('?') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let Some((enc, tail)) = tail.split_once('?') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let Some((text, remainder)) = tail.split_once("?=") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let decoded = match enc.to_ascii_uppercase().as_str() {
            "B" => BASE64
                .decode(text.as_bytes())
                .ok()
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()),
            "Q" => Some(decode_q_word(text)),
            _ => None,
        };
        let charset_upper = charset.to_ascii_uppercase();
        let is_unicode = charset_upper.starts_with("UTF-8") || charset_upper == "US-ASCII";
        match decoded {
            Some(text) if is_unicode => out.push_str(&text),
            // Unknown charset or encoding: leave the encoded word verbatim rather
            // than mis-decoding it as UTF-8 (out of the stated UTF-8 scope).
            _ => out.push_str(&rest[start..start + 2 + (after.len() - remainder.len())]),
        }
        rest = remainder;
    }
    out.push_str(rest);
    out
}

/// The "Q" encoding of RFC 2047 (like quoted-printable but `_` means space).
fn decode_q_word(text: &str) -> String {
    decode_quoted_printable(&text.replace('_', " "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_email_yields_pasted_text_body_and_subject() {
        let raw = "From: airline@example.com\r\nSubject: Your flight\r\nContent-Type: text/plain\r\n\r\nConfirmation ABC123\r\nSFO-NRT";
        let body = extract_email_body(raw);
        assert_eq!(body.kind, DocumentKind::PastedText);
        assert_eq!(body.subject.as_deref(), Some("Your flight"));
        assert!(body.content.contains("ABC123"));
        assert!(!body.content.contains("From:"));
    }

    #[test]
    fn multipart_alternative_prefers_the_html_part() {
        let raw = "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"XX\"\r\n\r\n--XX\r\nContent-Type: text/plain\r\n\r\nplain body\r\n--XX\r\nContent-Type: text/html\r\n\r\n<html><body>rich</body></html>\r\n--XX--\r\n";
        let body = extract_email_body(raw);
        assert_eq!(body.kind, DocumentKind::Html);
        assert!(body.content.contains("<html>"));
        assert!(!body.content.contains("plain body"));
    }

    #[test]
    fn decodes_quoted_printable_including_soft_breaks() {
        let raw = "Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nPrice =3D=E2=82=AC50 for a very long line that was so=\r\nft-wrapped";
        let body = extract_email_body(raw);
        assert!(body.content.contains("Price =€50"));
        assert!(body.content.contains("softft-wrapped") || body.content.contains("soft-wrapped"));
    }

    #[test]
    fn decodes_base64_transfer_encoding() {
        // base64("Booking XYZ") with a line break in the encoded text.
        let raw = "Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\nQm9va2lu\r\nZyBYWVo=";
        let body = extract_email_body(raw);
        assert_eq!(body.content, "Booking XYZ");
    }

    #[test]
    fn decodes_rfc2047_encoded_subject() {
        let raw = "Subject: =?UTF-8?B?RmzDrGdodA==?=\r\nContent-Type: text/plain\r\n\r\nbody";
        let body = extract_email_body(raw);
        assert_eq!(body.subject.as_deref(), Some("Flìght"));
    }

    #[test]
    fn pasted_body_without_headers_is_treated_as_text() {
        let raw = "Confirmation HOLD9\nRoute SFO-NRT\nDeparture 2027-04-02T10:00";
        let body = extract_email_body(raw);
        assert_eq!(body.kind, DocumentKind::PastedText);
        assert_eq!(body.content, raw);
        assert_eq!(body.subject, None);
    }

    #[test]
    fn prose_with_a_colon_line_is_not_mistaken_for_headers() {
        let raw = "Meeting notes\nTime: 10:00 at the cafe\n\nRest of the notes here.";
        let body = extract_email_body(raw);
        // No recognized email header → whole thing is the body, nothing stripped.
        assert!(body.content.contains("Meeting notes"));
        assert!(body.content.contains("Rest of the notes"));
    }

    #[test]
    fn nested_multipart_mixed_finds_the_html_alternative() {
        let raw = "Content-Type: multipart/mixed; boundary=\"OUT\"\r\n\r\n--OUT\r\nContent-Type: multipart/alternative; boundary=\"IN\"\r\n\r\n--IN\r\nContent-Type: text/plain\r\n\r\nplain\r\n--IN\r\nContent-Type: text/html\r\n\r\n<p>html</p>\r\n--IN--\r\n--OUT\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nAAAA\r\n--OUT--\r\n";
        let body = extract_email_body(raw);
        assert_eq!(body.kind, DocumentKind::Html);
        assert!(body.content.contains("<p>html</p>"));
    }

    #[test]
    fn deeply_nested_multipart_is_depth_capped_not_a_stack_overflow() {
        fn nested(depth: usize) -> String {
            if depth == 0 {
                return "Content-Type: text/plain\r\n\r\nleaf".to_owned();
            }
            let boundary = format!("b{depth}");
            format!(
                "Content-Type: multipart/mixed; boundary={boundary}\r\n\r\n--{boundary}\r\n{}\r\n--{boundary}--\r\n",
                nested(depth - 1)
            )
        }
        // Far past MAX_MULTIPART_DEPTH: must return (never overflow), and the
        // unreachable leaf means no body is found for this recognized email.
        let body = extract_email_body(&nested(200));
        assert!(body.content.is_empty());
    }

    #[test]
    fn attachment_only_multipart_yields_no_body_not_raw_mime() {
        let raw = "To: me@example.com\r\nContent-Type: multipart/mixed; boundary=\"M\"\r\n\r\n--M\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nAAAA\r\n--M--\r\n";
        let body = extract_email_body(raw);
        // Empty (→ document/empty at import), never the raw headers/blob.
        assert!(body.content.is_empty());
        assert!(!body.content.contains("me@example.com"));
    }

    #[test]
    fn headers_only_email_yields_no_body() {
        let raw = "From: a@b.com\r\nSubject: Nothing here\r\nContent-Type: text/plain\r\n\r\n";
        let body = extract_email_body(raw);
        assert!(body.content.is_empty());
        assert_eq!(body.subject.as_deref(), Some("Nothing here"));
    }

    #[test]
    fn base64_of_non_utf8_bytes_is_lossy_not_a_panic() {
        // base64 of the bytes [0xFF, 0xFE], which are not valid UTF-8.
        let raw = "Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n//4=";
        let body = extract_email_body(raw);
        assert!(!body.content.is_empty()); // replacement chars, no panic
    }
}
