use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;

#[derive(Debug)]
pub struct SchemaSet {
    schemas: BTreeMap<String, Value>,
}

impl SchemaSet {
    pub fn load(schema_dir: &Path) -> Self {
        let mut schemas = BTreeMap::new();
        for file_name in [
            "AppError.schema.json",
            "CandidateFact.schema.json",
            "ConfirmedFact.schema.json",
            "ImportResult.schema.json",
            "Trip.schema.json",
        ] {
            let path = schema_dir.join(file_name);
            let raw = fs::read_to_string(&path).expect("read schema");
            let schema: Value = serde_json::from_str(&raw).expect("schema json");
            schemas.insert(file_name.to_owned(), schema);
        }
        Self { schemas }
    }

    pub fn validate(&self, schema_name: &str, value: &Value) -> Result<(), Vec<String>> {
        let schema = self
            .schemas
            .get(schema_name)
            .unwrap_or_else(|| panic!("missing schema {schema_name}"));
        let mut errors = Vec::new();
        self.validate_with_root(schema, schema, value, "$", &mut errors);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    fn validate_with_root(
        &self,
        root: &Value,
        schema: &Value,
        value: &Value,
        path: &str,
        errors: &mut Vec<String>,
    ) {
        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            let (ref_root, ref_schema) = self.resolve_ref(root, reference);
            self.validate_with_root(ref_root, ref_schema, value, path, errors);
            return;
        }

        if let Some(enum_values) = schema.get("enum").and_then(Value::as_array) {
            if !enum_values.iter().any(|enum_value| enum_value == value) {
                errors.push(format!("{path}: value {value} was not in enum"));
            }
        }

        if let Some(any_of) = schema.get("anyOf").and_then(Value::as_array) {
            if !any_of.iter().any(|candidate| {
                let mut nested = Vec::new();
                self.validate_with_root(root, candidate, value, path, &mut nested);
                nested.is_empty()
            }) {
                errors.push(format!("{path}: did not match anyOf"));
            }
            return;
        }

        if let Some(one_of) = schema.get("oneOf").and_then(Value::as_array) {
            let matches = one_of
                .iter()
                .filter(|candidate| {
                    let mut nested = Vec::new();
                    self.validate_with_root(root, candidate, value, path, &mut nested);
                    nested.is_empty()
                })
                .count();
            if matches != 1 {
                errors.push(format!("{path}: matched {matches} oneOf schemas"));
            }
            return;
        }

        if let Some(schema_type) = schema.get("type").and_then(Value::as_str) {
            self.validate_type(schema_type, value, path, errors);
        }

        match value {
            Value::Object(object) => self.validate_object(root, schema, object, path, errors),
            Value::Array(items) => {
                if let Some(item_schema) = schema.get("items") {
                    for (index, item) in items.iter().enumerate() {
                        self.validate_with_root(
                            root,
                            item_schema,
                            item,
                            &format!("{path}[{index}]"),
                            errors,
                        );
                    }
                }
            }
            Value::String(text) => self.validate_string(schema, text, path, errors),
            Value::Number(number) => {
                if let Some(minimum) = schema.get("minimum").and_then(Value::as_i64) {
                    if number.as_i64().unwrap_or(i64::MIN) < minimum {
                        errors.push(format!("{path}: number was below minimum {minimum}"));
                    }
                }
            }
            _ => {}
        }
    }

    fn validate_object(
        &self,
        root: &Value,
        schema: &Value,
        object: &serde_json::Map<String, Value>,
        path: &str,
        errors: &mut Vec<String>,
    ) {
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for field in required.iter().filter_map(Value::as_str) {
                if !object.contains_key(field) {
                    errors.push(format!("{path}: missing required field {field}"));
                }
            }
        }

        let properties = schema.get("properties").and_then(Value::as_object);
        if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
            for key in object.keys() {
                if properties
                    .map(|properties| !properties.contains_key(key))
                    .unwrap_or(true)
                {
                    errors.push(format!("{path}: unexpected field {key}"));
                }
            }
        }

        if let Some(properties) = properties {
            for (key, property_schema) in properties {
                if let Some(property_value) = object.get(key) {
                    self.validate_with_root(
                        root,
                        property_schema,
                        property_value,
                        &format!("{path}.{key}"),
                        errors,
                    );
                }
            }
        }
    }

    fn validate_type(
        &self,
        schema_type: &str,
        value: &Value,
        path: &str,
        errors: &mut Vec<String>,
    ) {
        let valid = match schema_type {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
            "null" => value.is_null(),
            _ => true,
        };
        if !valid {
            errors.push(format!("{path}: expected {schema_type}, got {value}"));
        }
    }

    fn validate_string(&self, schema: &Value, text: &str, path: &str, errors: &mut Vec<String>) {
        if let Some(format) = schema.get("format").and_then(Value::as_str) {
            let valid = match format {
                "date" => text.parse::<jiff::civil::Date>().is_ok(),
                "date-time" => text.parse::<jiff::Timestamp>().is_ok(),
                "uuid" => uuid::Uuid::parse_str(text).is_ok(),
                _ => true,
            };
            if !valid {
                errors.push(format!("{path}: invalid {format} string"));
            }
        }

        if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
            let valid = match pattern {
                "^[0-9a-f]{64}$" => {
                    text.len() == 64 && text.chars().all(|character| character.is_ascii_hexdigit())
                }
                "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" => is_contract_local_datetime(text),
                _ => true,
            };
            if !valid {
                errors.push(format!("{path}: failed pattern {pattern}"));
            }
        }
    }

    fn resolve_ref<'a>(&'a self, root: &'a Value, reference: &str) -> (&'a Value, &'a Value) {
        if let Some(local) = reference.strip_prefix("#/") {
            let schema = resolve_pointer(root, local);
            return (root, schema);
        }

        if let Some((file_name, local_ref)) = reference.split_once('#') {
            let root = self
                .schemas
                .get(file_name)
                .unwrap_or_else(|| panic!("missing external schema {file_name}"));
            if local_ref.is_empty() {
                return (root, root);
            }
            let local = local_ref
                .strip_prefix('/')
                .unwrap_or_else(|| panic!("unsupported ref {reference}"));
            let schema = resolve_pointer(root, local);
            return (root, schema);
        }

        let root = self
            .schemas
            .get(reference)
            .unwrap_or_else(|| panic!("missing external schema {reference}"));
        (root, root)
    }
}

fn resolve_pointer<'a>(root: &'a Value, pointer: &str) -> &'a Value {
    let mut value = root;
    for part in pointer.split('/') {
        let key = part.replace("~1", "/").replace("~0", "~");
        value = value
            .get(&key)
            .unwrap_or_else(|| panic!("schema pointer segment {key} not found"));
    }
    value
}

fn is_contract_local_datetime(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 16
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[10] == b'T'
        && bytes[11..13].iter().all(u8::is_ascii_digit)
        && bytes[13] == b':'
        && bytes[14..16].iter().all(u8::is_ascii_digit)
}
