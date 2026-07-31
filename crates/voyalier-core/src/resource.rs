//! Traveler-curated research material. A resource is something the traveler
//! deliberately kept to read — a link or a dropped file — never evidence.
//!
//! The distinction matters more than it looks. A source document is imported to
//! be parsed: it yields candidate facts and carries confirmation codes, so it is
//! sealed and fed to nothing. A resource is imported to be *read*: it yields
//! nothing, asserts nothing, and clears no readiness item. Dropping a boarding
//! pass here is a mis-file, and the interface says so rather than quietly
//! parsing it.

use serde::{Deserialize, Serialize};

use crate::{AppError, ErrorCode};

pub const MAX_RESOURCE_TITLE_CHARS: usize = 240;
pub const MAX_RESOURCE_NOTE_CHARS: usize = 20_000;
pub const MAX_RESOURCE_URL_CHARS: usize = 2_000;
pub const MAX_RESOURCE_TAGS: usize = 12;
pub const MAX_RESOURCE_TAG_CHARS: usize = 40;
/// How much readable text a snapshot keeps. A page that runs past this is
/// stored truncated and says so, rather than letting a hostile or merely
/// enormous page decide how much of the database it occupies.
pub const MAX_SNAPSHOT_TEXT_CHARS: usize = 40_000;

/// Elements whose *content* is not prose. Their text is dropped with them, so a
/// stored snapshot can never carry script or stylesheet source.
const SKIP_ELEMENTS: &[&str] = &[
    "script", "style", "noscript", "svg", "head", "template", "iframe", "object",
];

/// Query parameters that address a visitor rather than a page, so two links
/// that differ only by one are the same resource.
const TRACKING_PARAMS: &[&str] = &[
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref_src", "ref_url",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Link,
    File,
}

/// A dated copy of what a link said when the traveler asked for it. The same
/// category as any other retrieved snapshot: attributed, stale-able, and never
/// promoted into evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub text: String,
    pub fetched_at: String,
    pub content_hash: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub trip_id: String,
    pub kind: ResourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    pub title: String,
    pub note: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<ResourceSnapshot>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResourceInput {
    pub trip_id: String,
    pub kind: ResourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResourceInput {
    pub resource_id: String,
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Standing preferences for research capture.
///
/// One field today, and a settings object rather than a bare boolean because
/// the alternative is a new gateway method the next time a preference appears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSettings {
    /// Whether saving a link may also fetch what the page says. Off until the
    /// traveler turns it on, and reversible at any time.
    pub auto_fetch_details: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetResearchSettingsInput {
    pub auto_fetch_details: bool,
}

/// What a fetched page said, reduced to the parts worth keeping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadablePage {
    pub title: Option<String>,
    pub description: Option<String>,
    pub text: String,
    pub truncated: bool,
}

/// Accept only addresses a browser would open over the network.
///
/// The rejected schemes are the point: `javascript:` and `data:` are code, and
/// `file:` reaches the traveler's own disk. A saved link is opened later, often
/// with one click, so the check belongs here rather than at the click.
pub fn validate_resource_url(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("url", "a link needs a web address"));
    }
    if trimmed.chars().count() > MAX_RESOURCE_URL_CHARS {
        return Err(invalid(
            "url",
            format!("url must be at most {MAX_RESOURCE_URL_CHARS} characters"),
        ));
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(invalid("url", "a web address cannot contain spaces"));
    }
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return Err(invalid("url", "a link must start with http:// or https://"));
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(invalid("url", "only http and https links can be saved"));
    }
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() {
        return Err(invalid("url", "a link must name a site"));
    }
    Ok(trimmed.to_owned())
}

/// The key two links are the same resource under.
///
/// Folds the differences that address a visitor rather than a page — casing,
/// the default port, a fragment, a trailing slash, campaign parameters — and
/// keeps everything else, because `?page=kyoto` and `?page=tokyo` are two pages.
pub fn resource_url_identity(raw: &str) -> String {
    let trimmed = raw.trim();
    let Some((scheme, rest)) = trimmed.split_once("://") else {
        return trimmed.to_ascii_lowercase();
    };
    let scheme = scheme.to_ascii_lowercase();
    let rest = rest.split('#').next().unwrap_or("");
    let (authority, path_and_query) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    let (path, query) = match path_and_query.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (path_and_query, None),
    };
    let mut authority = authority.to_ascii_lowercase();
    let default_port = if scheme == "https" { ":443" } else { ":80" };
    if let Some(stripped) = authority.strip_suffix(default_port) {
        authority = stripped.to_owned();
    }
    let kept: Vec<&str> = query
        .map(|query| {
            query
                .split('&')
                .filter(|pair| !pair.is_empty() && !is_tracking_param(pair))
                .collect()
        })
        .unwrap_or_default();
    let mut identity = format!("{scheme}://{authority}{}", path.trim_end_matches('/'));
    if !kept.is_empty() {
        identity.push('?');
        identity.push_str(&kept.join("&"));
    }
    identity
}

fn is_tracking_param(pair: &str) -> bool {
    let key = pair.split('=').next().unwrap_or("").to_ascii_lowercase();
    key.starts_with("utm_") || TRACKING_PARAMS.contains(&key.as_str())
}

/// A readable name for a link the traveler did not title, so the list never
/// shows a bare address.
///
/// Public because the fetch path needs to recognize its own handiwork: a title
/// the traveler chose stays theirs, and only one of these is replaced by what
/// the page turns out to call itself.
pub fn derived_link_title(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let rest = rest.split(['#', '?']).next().unwrap_or("");
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    let host = authority
        .split(':')
        .next()
        .unwrap_or(authority)
        .to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_owned();
    match path.rsplit('/').find(|segment| !segment.is_empty()) {
        Some(segment) => format!("{host} — {segment}"),
        None => host,
    }
}

pub fn validate_create_resource(
    mut input: CreateResourceInput,
) -> Result<CreateResourceInput, AppError> {
    match input.kind {
        ResourceKind::Link => {
            let url = input
                .url
                .as_deref()
                .ok_or_else(|| invalid("url", "a link needs a web address"))?;
            input.url = Some(validate_resource_url(url)?);
            input.file_name = None;
        }
        ResourceKind::File => {
            let name = input
                .file_name
                .as_deref()
                .ok_or_else(|| invalid("fileName", "a file needs a name"))?;
            input.file_name = Some(validate_file_name(name)?);
            input.url = None;
        }
    }
    input.title = normalize_title(
        &input.title,
        input.url.as_deref(),
        input.file_name.as_deref(),
    )?;
    input.note = validate_note(&input.note)?;
    input.tags = normalize_tags(input.tags)?;
    Ok(input)
}

pub fn validate_update_resource(
    mut input: UpdateResourceInput,
) -> Result<UpdateResourceInput, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(invalid("title", "title is required"));
    }
    if title.chars().count() > MAX_RESOURCE_TITLE_CHARS {
        return Err(invalid(
            "title",
            format!("title must be at most {MAX_RESOURCE_TITLE_CHARS} characters"),
        ));
    }
    input.title = title.to_owned();
    input.note = validate_note(&input.note)?;
    input.tags = normalize_tags(input.tags)?;
    Ok(input)
}

fn normalize_title(
    raw: &str,
    url: Option<&str>,
    file_name: Option<&str>,
) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(match (url, file_name) {
            (Some(url), _) => derived_link_title(url),
            (None, Some(name)) => name.to_owned(),
            (None, None) => String::new(),
        });
    }
    if trimmed.chars().count() > MAX_RESOURCE_TITLE_CHARS {
        return Err(invalid(
            "title",
            format!("title must be at most {MAX_RESOURCE_TITLE_CHARS} characters"),
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_note(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.chars().count() > MAX_RESOURCE_NOTE_CHARS {
        return Err(invalid(
            "note",
            format!("note must be at most {MAX_RESOURCE_NOTE_CHARS} characters"),
        ));
    }
    Ok(trimmed.to_owned())
}

fn validate_file_name(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(invalid("fileName", "a file needs a name"));
    }
    if trimmed.chars().count() > MAX_RESOURCE_TITLE_CHARS {
        return Err(invalid(
            "fileName",
            format!("fileName must be at most {MAX_RESOURCE_TITLE_CHARS} characters"),
        ));
    }
    // A name, never a path: the traveler dropped one file, and a separator here
    // would be someone describing a location on disk instead.
    if trimmed.contains(['/', '\\']) || trimmed.contains("..") {
        return Err(invalid("fileName", "a file name cannot contain a path"));
    }
    Ok(trimmed.to_owned())
}

/// Trim, fold case, drop blanks and repeats, keep the traveler's order.
fn normalize_tags(raw: Vec<String>) -> Result<Vec<String>, AppError> {
    let mut tags: Vec<String> = Vec::new();
    for tag in raw {
        let tag = tag.trim().to_lowercase();
        if tag.is_empty() {
            continue;
        }
        if tag.chars().count() > MAX_RESOURCE_TAG_CHARS {
            return Err(invalid(
                "tags",
                format!("each tag must be at most {MAX_RESOURCE_TAG_CHARS} characters"),
            ));
        }
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    if tags.len() > MAX_RESOURCE_TAGS {
        return Err(invalid(
            "tags",
            format!("a resource can carry at most {MAX_RESOURCE_TAGS} tags"),
        ));
    }
    Ok(tags)
}

/// Reduce a fetched page to its words.
///
/// Deliberately hand-written rather than delegated to a scraping crate: the job
/// is small, the input is hostile, and a dependency here would need the
/// licensing and replacement-cost note the change discipline asks for. The
/// email extractor cannot be reused — it preserves HTML on purpose so the
/// JSON-LD parser can still run over it.
pub fn extract_readable_page(html: &str) -> ReadablePage {
    let title = find_element_text(html, "title");
    let description = find_meta_description(html);
    let (text, truncated) = strip_markup(html);
    ReadablePage {
        title,
        description,
        text,
        truncated,
    }
}

fn strip_markup(html: &str) -> (String, bool) {
    let chars: Vec<char> = html.chars().collect();
    // Collapsing only ever shrinks, so gathering twice the cap leaves room to
    // decide truncation on the finished text rather than the raw scan.
    let scan_limit = MAX_SNAPSHOT_TEXT_CHARS.saturating_mul(2);
    let mut raw = String::new();
    let mut index = 0;
    let mut stopped_early = false;
    while index < chars.len() {
        if raw.chars().count() >= scan_limit {
            stopped_early = true;
            break;
        }
        match chars[index] {
            '<' => {
                let (name, is_closing, after) = read_tag(&chars, index);
                index = if !is_closing && SKIP_ELEMENTS.contains(&name.as_str()) {
                    skip_element(&chars, after, &name)
                } else {
                    after
                };
                // Every tag is a word boundary, so adjacent blocks do not run
                // their text together.
                raw.push(' ');
            }
            '&' => match read_entity(&chars, index) {
                Some((decoded, after)) => {
                    raw.push_str(&decoded);
                    index = after;
                }
                None => {
                    raw.push('&');
                    index += 1;
                }
            },
            character => {
                raw.push(character);
                index += 1;
            }
        }
    }
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > MAX_SNAPSHOT_TEXT_CHARS {
        let capped: String = collapsed.chars().take(MAX_SNAPSHOT_TEXT_CHARS).collect();
        return (capped, true);
    }
    (collapsed, stopped_early)
}

/// Read one tag, returning its lowercased name, whether it closes, and where
/// the scan continues. An unterminated tag consumes the rest of the input.
fn read_tag(chars: &[char], start: usize) -> (String, bool, usize) {
    let mut index = start + 1;
    let is_closing = chars.get(index) == Some(&'/');
    if is_closing {
        index += 1;
    }
    let mut name = String::new();
    while let Some(character) = chars.get(index) {
        if !character.is_ascii_alphanumeric() {
            break;
        }
        name.push(character.to_ascii_lowercase());
        index += 1;
    }
    while index < chars.len() && chars[index] != '>' {
        index += 1;
    }
    (name, is_closing, (index + 1).min(chars.len()))
}

/// Skip to just past `</name>`. An element that never closes swallows the rest
/// of the document, which is the safe direction: unreadable beats leaking a
/// half-parsed script body into stored text.
fn skip_element(chars: &[char], from: usize, name: &str) -> usize {
    let needle: Vec<char> = format!("</{name}").chars().collect();
    let mut index = from;
    while index + needle.len() <= chars.len() {
        let matches = chars[index..index + needle.len()]
            .iter()
            .zip(needle.iter())
            .all(|(candidate, expected)| candidate.to_ascii_lowercase() == *expected);
        if matches {
            let mut end = index + needle.len();
            while end < chars.len() && chars[end] != '>' {
                end += 1;
            }
            return (end + 1).min(chars.len());
        }
        index += 1;
    }
    chars.len()
}

fn read_entity(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut index = start + 1;
    let mut name = String::new();
    while let Some(character) = chars.get(index) {
        if *character == ';' || name.len() >= 12 {
            break;
        }
        name.push(*character);
        index += 1;
    }
    if chars.get(index) != Some(&';') {
        return None;
    }
    let end = index + 1;
    let decoded = match name.to_ascii_lowercase().as_str() {
        "amp" => "&".to_owned(),
        "lt" => "<".to_owned(),
        "gt" => ">".to_owned(),
        "quot" => "\"".to_owned(),
        "apos" => "'".to_owned(),
        "nbsp" => " ".to_owned(),
        other => {
            let digits = other.strip_prefix('#')?;
            let code = match digits.strip_prefix('x') {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => digits.parse::<u32>().ok()?,
            };
            char::from_u32(code)?.to_string()
        }
    };
    Some((decoded, end))
}

fn find_element_text(html: &str, element: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = lower.find(&format!("<{element}"))?;
    let content_start = open + html[open..].find('>')? + 1;
    let close = lower[content_start..].find(&format!("</{element}"))? + content_start;
    let (text, _) = strip_markup(&html[content_start..close]);
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

/// The page's own one-line summary, preferring the plain description over the
/// social-card one when a page carries both.
fn find_meta_description(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut og_description: Option<String> = None;
    let mut search_from = 0usize;
    while let Some(offset) = lower[search_from..].find("<meta") {
        let start = search_from + offset;
        let end = match html[start..].find('>') {
            Some(index) => start + index,
            None => break,
        };
        let tag = &html[start..end];
        let name = attribute(tag, "name")
            .or_else(|| attribute(tag, "property"))
            .unwrap_or_default()
            .to_lowercase();
        if let Some(content) = attribute(tag, "content") {
            let (content, _) = strip_markup(&content);
            let content = content.trim().to_owned();
            if !content.is_empty() {
                if name == "description" {
                    return Some(content);
                }
                if name == "og:description" && og_description.is_none() {
                    og_description = Some(content);
                }
            }
        }
        search_from = end + 1;
    }
    og_description
}

fn attribute(tag: &str, key: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let mut search_from = 0usize;
    while let Some(offset) = lower[search_from..].find(key) {
        let start = search_from + offset;
        let after = start + key.len();
        // The character before must be a boundary, so `property` never answers
        // a lookup for `name` inside `og:name`-style attributes.
        let preceded_ok = start == 0
            || lower[..start]
                .chars()
                .next_back()
                .is_some_and(|character| character.is_whitespace());
        let rest = lower[after..].trim_start();
        if preceded_ok && rest.starts_with('=') {
            let value_start = after + lower[after..].find('=')? + 1;
            let value = tag.get(value_start..)?.trim_start();
            let quote = value.chars().next()?;
            return if quote == '"' || quote == '\'' {
                value[quote.len_utf8()..]
                    .split(quote)
                    .next()
                    .map(str::to_owned)
            } else {
                value.split_whitespace().next().map(str::to_owned)
            };
        }
        search_from = after;
    }
    None
}

fn invalid(field: &'static str, message: impl Into<String>) -> AppError {
    AppError::with_detail(ErrorCode::ValidationInvalidInput, message, "field", field)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_web_urls_so_a_saved_link_can_never_be_a_local_path_or_a_script() {
        for hostile in [
            "javascript:alert(1)",
            "data:text/html,<script>x</script>",
            "file:///etc/passwd",
            "ftp://example.com/x",
        ] {
            let error = validate_resource_url(hostile).expect_err(hostile);
            assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
        }

        assert_eq!(
            validate_resource_url("  https://example.com/guide  ").expect("web url"),
            "https://example.com/guide"
        );
    }

    #[test]
    fn folds_the_urls_that_differ_only_by_tracking_into_one_identity() {
        let canonical = resource_url_identity("https://example.com/guide");
        for variant in [
            "https://example.com/guide/",
            "HTTPS://Example.com/guide",
            "https://example.com:443/guide",
            "https://example.com/guide#section-2",
            "https://example.com/guide?utm_source=newsletter&utm_medium=email",
            "https://example.com/guide?fbclid=abc123",
        ] {
            assert_eq!(
                resource_url_identity(variant),
                canonical,
                "{variant} should fold onto the canonical identity"
            );
        }
    }

    #[test]
    fn keeps_meaningful_query_strings_apart_because_they_address_different_pages() {
        assert_ne!(
            resource_url_identity("https://example.com/wiki?page=kyoto"),
            resource_url_identity("https://example.com/wiki?page=tokyo"),
        );
        // A tracking parameter alongside a real one drops only the tracker.
        assert_eq!(
            resource_url_identity("https://example.com/wiki?page=kyoto&utm_source=x"),
            resource_url_identity("https://example.com/wiki?page=kyoto"),
        );
    }

    #[test]
    fn names_an_untitled_link_after_its_page_so_the_list_never_shows_a_bare_url() {
        let saved = validate_create_resource(CreateResourceInput {
            trip_id: "trip_1".to_owned(),
            kind: ResourceKind::Link,
            url: Some("https://www.japan-guide.com/e/e2164.html".to_owned()),
            file_name: None,
            title: "   ".to_owned(),
            note: String::new(),
            tags: Vec::new(),
        })
        .expect("valid link");

        assert_eq!(saved.title, "japan-guide.com — e2164.html");
    }

    #[test]
    fn normalizes_tags_so_the_same_idea_typed_twice_filters_as_one() {
        let saved = validate_create_resource(CreateResourceInput {
            trip_id: "trip_1".to_owned(),
            kind: ResourceKind::Link,
            url: Some("https://example.com/food".to_owned()),
            file_name: None,
            title: "Ramen".to_owned(),
            note: "  worth a detour  ".to_owned(),
            tags: vec![
                "  Food  ".to_owned(),
                "food".to_owned(),
                "FOOD".to_owned(),
                String::new(),
                "kyoto".to_owned(),
            ],
        })
        .expect("valid link");

        assert_eq!(saved.tags, vec!["food".to_owned(), "kyoto".to_owned()]);
        assert_eq!(saved.note, "worth a detour");
    }

    #[test]
    fn requires_a_link_to_carry_a_url_and_a_file_to_carry_a_name() {
        let error = validate_create_resource(CreateResourceInput {
            trip_id: "trip_1".to_owned(),
            kind: ResourceKind::Link,
            url: None,
            file_name: None,
            title: "No address".to_owned(),
            note: String::new(),
            tags: Vec::new(),
        })
        .expect_err("link without a url");
        assert_eq!(error.code, ErrorCode::ValidationInvalidInput);

        let error = validate_create_resource(CreateResourceInput {
            trip_id: "trip_1".to_owned(),
            kind: ResourceKind::File,
            url: None,
            file_name: None,
            title: "No file".to_owned(),
            note: String::new(),
            tags: Vec::new(),
        })
        .expect_err("file without a name");
        assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
    }

    #[test]
    fn reads_a_page_down_to_its_words_without_running_or_keeping_its_code() {
        let page = extract_readable_page(
            "<html><head><title>  Kyoto in April  </title>\
             <meta name=\"description\" content=\"Cherry blossom timing\">\
             <style>body{color:red}</style></head>\
             <body><script>alert('x')</script>\
             <h1>Peak bloom</h1><p>Usually the first week.</p>\
             <p>Crowds &amp; queues &#8212; arrive early.</p></body></html>",
        );

        assert_eq!(page.title.as_deref(), Some("Kyoto in April"));
        assert_eq!(page.description.as_deref(), Some("Cherry blossom timing"));
        assert_eq!(
            page.text,
            "Peak bloom Usually the first week. Crowds & queues — arrive early."
        );
        assert!(!page.text.contains("alert"));
        assert!(!page.text.contains("color:red"));
        assert!(!page.truncated);
    }

    #[test]
    fn keeps_adjacent_blocks_as_separate_words_rather_than_running_them_together() {
        let page = extract_readable_page("<p>Kyoto</p><p>Osaka</p><div>Nara</div>");
        assert_eq!(page.text, "Kyoto Osaka Nara");
    }

    #[test]
    fn caps_a_hostile_page_instead_of_storing_whatever_it_sends() {
        let huge = format!("<p>{}</p>", "word ".repeat(MAX_SNAPSHOT_TEXT_CHARS));
        let page = extract_readable_page(&huge);
        assert!(page.truncated);
        assert!(page.text.chars().count() <= MAX_SNAPSHOT_TEXT_CHARS);
    }

    #[test]
    fn survives_unclosed_and_nested_markup_without_hanging_or_panicking() {
        for hostile in [
            "<script>never closed",
            "<<<>>><p",
            "<title>unclosed title",
            "&#xZZZZ; &# &#99999999999;",
            "<style><style><style>a{}",
        ] {
            let page = extract_readable_page(hostile);
            assert!(page.text.chars().count() <= MAX_SNAPSHOT_TEXT_CHARS);
        }
    }
}
