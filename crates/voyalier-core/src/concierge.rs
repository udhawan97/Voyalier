use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{AppError, ErrorCode, Trip, TripDetail};

pub const MAX_TRAVELERS: usize = 20;
pub const MAX_CONCIERGE_ITEMS: usize = 200;
pub const MAX_CONCIERGE_TEXT: usize = 240;
// This is also JavaScript's largest exactly representable integer. With at
// most 200 cost rows, every same-currency total remains within i64.
pub const MAX_EXACT_MINOR_AMOUNT: i64 = 9_007_199_254_740_991;
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_TRIP: usize = 100;
// Keep accepted binary custody comfortably below the 2 GiB encrypted backup
// container after both base64 layers and SQLite overhead are applied.
pub const MAX_ATTACHMENT_WORKSPACE_BYTES: usize = 500 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidenceStatus {
    Unknown,
    Citizen,
    National,
    PermanentResident,
    TemporaryWorker,
    Student,
    Visitor,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripPace {
    Unset,
    Slow,
    Balanced,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CarPreference {
    Unset,
    Avoid,
    Open,
    Prefer,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TravelMode {
    #[default]
    Unknown,
    Air,
    Land,
    Sea,
    Mixed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripPurpose {
    #[default]
    Unknown,
    Tourism,
    Business,
    Visit,
    Study,
    Other,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExistingDocumentStatus {
    #[default]
    Unknown,
    Yes,
    No,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConciergeTaskState {
    NotStarted,
    InProgress,
    Waiting,
    DoneByTraveler,
    NotApplicable,
    NeedsRecheck,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityClass {
    Traveler,
    Provider,
    Official,
    Evidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostState {
    Estimate,
    Committed,
    Refund,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostTaxStatus {
    #[default]
    Unknown,
    Included,
    Extra,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderVerification {
    DocumentedTemplate,
    ObservedDestinationLink,
    LinkOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAcquisition {
    LinkOnly,
    PublicPage,
    LicensedApi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparationDocumentStatus {
    PortalRequired,
    AuthorityConditional,
    TravelerAdded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffState {
    Considering,
    Saved,
    UserReportedBooked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelerProfile {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passport_country_iso2: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residence_country_iso2: Option<String>,
    pub residence_status: ResidenceStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_country_iso2: Option<String>,
    #[serde(default)]
    pub existing_destination_document: ExistingDocumentStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaStay {
    pub id: String,
    pub area: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_in: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_out: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergePreferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_area: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub area_stays: Vec<AreaStay>,
    pub party_size: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adults: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedrooms: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub beds: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rooms: Option<u8>,
    #[serde(default)]
    pub kitchen_required: bool,
    #[serde(default)]
    pub laundry_required: bool,
    #[serde(default)]
    pub air_conditioning_required: bool,
    #[serde(default)]
    pub accessibility_required: bool,
    #[serde(default)]
    pub flexible_cancellation_preferred: bool,
    pub pace: TripPace,
    pub car_preference: CarPreference,
    #[serde(default)]
    pub travel_mode: TravelMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_foreign_connection: Option<bool>,
    #[serde(default)]
    pub purpose: TripPurpose,
    pub base_currency: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_min_minor: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_max_minor: Option<i64>,
    pub budget_is_per_person: bool,
}

impl Default for ConciergePreferences {
    fn default() -> Self {
        Self {
            selected_area: None,
            area_stays: Vec::new(),
            party_size: 1,
            adults: None,
            children: None,
            bedrooms: None,
            beds: None,
            rooms: None,
            kitchen_required: false,
            laundry_required: false,
            air_conditioning_required: false,
            accessibility_required: false,
            flexible_cancellation_preferred: false,
            pace: TripPace::Unset,
            car_preference: CarPreference::Unset,
            travel_mode: TravelMode::Unknown,
            has_foreign_connection: None,
            purpose: TripPurpose::Unknown,
            base_currency: "USD".to_owned(),
            budget_min_minor: None,
            budget_max_minor: None,
            budget_is_per_person: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub task_id: String,
    pub state: ConciergeTaskState,
    #[serde(default)]
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<TaskProgressEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressEvent {
    pub state: ConciergeTaskState,
    #[serde(default)]
    pub note: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_revision: Option<String>,
    pub recorded_at: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostItem {
    pub id: String,
    pub label: String,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount_minor: Option<i64>,
    pub currency: String,
    pub state: CostState,
    #[serde(default)]
    pub tax_status: CostTaxStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletLink {
    pub id: String,
    pub label: String,
    pub category: String,
    #[serde(default)]
    pub traveler_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preparation_requirement_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attachment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_on: Option<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHandoff {
    pub id: String,
    pub provider_action_id: String,
    pub provider: String,
    pub url: String,
    pub search_brief: String,
    pub opened_at: String,
    pub state: HandoffState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergeProfile {
    pub trip_id: String,
    pub preferences: ConciergePreferences,
    #[serde(default)]
    pub travelers: Vec<TravelerProfile>,
    #[serde(default)]
    pub task_progress: Vec<TaskProgress>,
    #[serde(default)]
    pub costs: Vec<CostItem>,
    #[serde(default)]
    pub wallet_links: Vec<WalletLink>,
    #[serde(default)]
    pub provider_handoffs: Vec<ProviderHandoff>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripIntentDraft {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub origin: String,
    pub destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    pub party_size: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_area: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTripIntentDraftInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub origin: String,
    pub destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    pub party_size: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_area: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertTripIntentInput {
    pub draft_id: String,
    pub start_date: String,
    pub end_date: String,
}

pub fn validate_trip_intent(
    mut input: SaveTripIntentDraftInput,
) -> Result<SaveTripIntentDraftInput, AppError> {
    input.origin = input.origin.trim().to_owned();
    input.destination = input.destination.trim().to_owned();
    validate_short("origin", &input.origin)?;
    validate_short("destination", &input.destination)?;
    if input.party_size == 0 || input.party_size as usize > MAX_TRAVELERS {
        return invalid("partySize", "party size must be between 1 and 20");
    }
    input.title = clean_optional(input.title, "title")?;
    input.selected_area = clean_optional(input.selected_area, "selectedArea")?;
    match (&input.start_date, &input.end_date) {
        (None, None) => {}
        (Some(start), Some(end)) => {
            let start = start.trim().parse::<jiff::civil::Date>().map_err(|_| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "invalid date",
                    "field",
                    "startDate",
                )
            })?;
            let end = end.trim().parse::<jiff::civil::Date>().map_err(|_| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "invalid date",
                    "field",
                    "endDate",
                )
            })?;
            if end < start {
                return invalid("dates", "end date cannot be before start date");
            }
        }
        _ => return invalid("dates", "set both dates or leave both undecided"),
    }
    Ok(input)
}

impl ConciergeProfile {
    pub fn empty(trip_id: &str) -> Self {
        Self {
            trip_id: trip_id.to_owned(),
            preferences: ConciergePreferences::default(),
            travelers: Vec::new(),
            task_progress: Vec::new(),
            costs: Vec::new(),
            wallet_links: Vec::new(),
            provider_handoffs: Vec::new(),
            updated_at: None,
        }
    }

    pub fn validate(mut self) -> Result<Self, AppError> {
        validate_short("tripId", &self.trip_id)?;
        if self.preferences.party_size == 0 || self.preferences.party_size as usize > MAX_TRAVELERS
        {
            return invalid("partySize", "party size must be between 1 and 20");
        }
        if self.travelers.len() > MAX_TRAVELERS
            || self.task_progress.len() > MAX_CONCIERGE_ITEMS
            || self.costs.len() > MAX_CONCIERGE_ITEMS
            || self.wallet_links.len() > MAX_CONCIERGE_ITEMS
            || self.provider_handoffs.len() > MAX_CONCIERGE_ITEMS
        {
            return invalid("items", "that concierge profile has too many items");
        }
        if self.travelers.len() > self.preferences.party_size as usize {
            return invalid("travelers", "traveler profiles exceed the party size");
        }
        if self
            .preferences
            .adults
            .is_some_and(|value| value > self.preferences.party_size)
            || self
                .preferences
                .children
                .is_some_and(|value| value > self.preferences.party_size)
        {
            return invalid(
                "partySize",
                "adult and child counts cannot exceed the party size",
            );
        }
        if let (Some(adults), Some(children)) = (self.preferences.adults, self.preferences.children)
            && adults.saturating_add(children) != self.preferences.party_size
        {
            return invalid(
                "partySize",
                "adults and children must add up to the party size",
            );
        }
        if self.preferences.bedrooms.is_some_and(|value| value > 20)
            || self.preferences.beds.is_some_and(|value| value > 40)
            || self.preferences.rooms.is_some_and(|value| value > 20)
        {
            return invalid(
                "accommodation",
                "rooms and bedrooms must be 20 or fewer and beds 40 or fewer",
            );
        }
        validate_currency(&self.preferences.base_currency)?;
        if self
            .preferences
            .budget_min_minor
            .is_some_and(|value| value < 0)
            || self
                .preferences
                .budget_max_minor
                .is_some_and(|value| value < 0)
        {
            return invalid("budget", "budget range is invalid");
        }
        if let (Some(min), Some(max)) = (
            self.preferences.budget_min_minor,
            self.preferences.budget_max_minor,
        ) && max < min
        {
            return invalid("budget", "budget maximum cannot be below the minimum");
        }
        self.preferences.selected_area =
            clean_optional(self.preferences.selected_area, "selectedArea")?;
        if self.preferences.area_stays.len() > 20 {
            return invalid("areaStays", "a trip can have at most 20 area stays");
        }
        let mut area_stay_ids = BTreeSet::new();
        for stay in &mut self.preferences.area_stays {
            validate_id(&stay.id, "areaStay.id")?;
            validate_short("areaStay.area", &stay.area)?;
            stay.area = stay.area.trim().to_owned();
            if !area_stay_ids.insert(stay.id.clone()) {
                return invalid("areaStays", "area stay ids must be unique");
            }
            match (&stay.check_in, &stay.check_out) {
                (None, None) => {}
                (Some(check_in), Some(check_out)) => {
                    let start = check_in.parse::<jiff::civil::Date>().map_err(|_| {
                        AppError::with_detail(
                            ErrorCode::ValidationInvalidInput,
                            "invalid area-stay date",
                            "field",
                            "areaStay.checkIn",
                        )
                    })?;
                    let end = check_out.parse::<jiff::civil::Date>().map_err(|_| {
                        AppError::with_detail(
                            ErrorCode::ValidationInvalidInput,
                            "invalid area-stay date",
                            "field",
                            "areaStay.checkOut",
                        )
                    })?;
                    if end < start {
                        return invalid("areaStay.dates", "check-out cannot precede check-in");
                    }
                }
                _ => return invalid("areaStay.dates", "set both area-stay dates or neither"),
            }
        }

        let mut traveler_ids = BTreeSet::new();
        for traveler in &mut self.travelers {
            validate_id(&traveler.id, "traveler.id")?;
            validate_short("traveler.displayName", &traveler.display_name)?;
            traveler.display_name = traveler.display_name.trim().to_owned();
            validate_iso2(
                &traveler.passport_country_iso2,
                "traveler.passportCountryIso2",
            )?;
            validate_iso2(
                &traveler.residence_country_iso2,
                "traveler.residenceCountryIso2",
            )?;
            validate_iso2(&traveler.return_country_iso2, "traveler.returnCountryIso2")?;
            if !traveler_ids.insert(traveler.id.clone()) {
                return invalid("travelers", "traveler ids must be unique");
            }
        }
        let mut task_ids = BTreeSet::new();
        for progress in &mut self.task_progress {
            validate_id(&progress.task_id, "taskProgress.taskId")?;
            validate_optional_text("taskProgress.note", &progress.note, 2_000)?;
            if let Some(revision) = &progress.context_revision {
                validate_optional_text("taskProgress.contextRevision", revision, 80)?;
            }
            progress.note = progress.note.trim().to_owned();
            if progress.history.len() > 50 {
                return invalid("taskProgress.history", "task history has too many entries");
            }
            for event in &mut progress.history {
                validate_optional_text("taskProgress.history.note", &event.note, 2_000)?;
                validate_optional_text("taskProgress.history.recordedAt", &event.recorded_at, 80)?;
                validate_short("taskProgress.history.reason", &event.reason)?;
                event.note = event.note.trim().to_owned();
                event.reason = event.reason.trim().to_owned();
            }
            if !task_ids.insert(progress.task_id.clone()) {
                return invalid("taskProgress", "task ids must be unique");
            }
        }
        let mut cost_ids = BTreeSet::new();
        for cost in &mut self.costs {
            validate_id(&cost.id, "cost.id")?;
            validate_short("cost.label", &cost.label)?;
            validate_short("cost.category", &cost.category)?;
            validate_currency(&cost.currency)?;
            if let Some(amount) = cost.amount_minor
                && !(0..=MAX_EXACT_MINOR_AMOUNT).contains(&amount)
            {
                return invalid("cost.amountMinor", "cost amount is outside the exact range");
            }
            if let Some(due_date) = &cost.due_date {
                due_date.trim().parse::<jiff::civil::Date>().map_err(|_| {
                    AppError::with_detail(
                        ErrorCode::ValidationInvalidInput,
                        "invalid date",
                        "field",
                        "cost.dueDate",
                    )
                })?;
            }
            if !cost_ids.insert(cost.id.clone()) {
                return invalid("costs", "cost ids must be unique");
            }
        }
        let mut wallet_ids = BTreeSet::new();
        for link in &mut self.wallet_links {
            validate_id(&link.id, "walletLink.id")?;
            validate_short("walletLink.label", &link.label)?;
            validate_short("walletLink.category", &link.category)?;
            validate_optional_text("walletLink.note", &link.note, 2_000)?;
            if link.source_document_id.is_some() && link.source_attachment_id.is_some() {
                return invalid(
                    "walletLink.source",
                    "a wallet link can point to one imported source",
                );
            }
            if let Some(expires_on) = &link.expires_on {
                expires_on
                    .trim()
                    .parse::<jiff::civil::Date>()
                    .map_err(|_| {
                        AppError::with_detail(
                            ErrorCode::ValidationInvalidInput,
                            "invalid date",
                            "field",
                            "walletLink.expiresOn",
                        )
                    })?;
            }
            if link
                .traveler_ids
                .iter()
                .any(|id| !traveler_ids.contains(id))
            {
                return invalid(
                    "walletLink.travelerIds",
                    "wallet links must name travelers on this trip",
                );
            }
            let mut requirement_ids = BTreeSet::new();
            for requirement_id in &link.preparation_requirement_ids {
                validate_id(requirement_id, "walletLink.preparationRequirementIds")?;
                if !requirement_ids.insert(requirement_id) {
                    return invalid(
                        "walletLink.preparationRequirementIds",
                        "preparation requirement ids must be unique",
                    );
                }
            }
            if !wallet_ids.insert(link.id.clone()) {
                return invalid("walletLinks", "wallet link ids must be unique");
            }
        }
        let mut handoff_ids = BTreeSet::new();
        for handoff in &mut self.provider_handoffs {
            validate_id(&handoff.id, "providerHandoff.id")?;
            validate_id(
                &handoff.provider_action_id,
                "providerHandoff.providerActionId",
            )?;
            validate_short("providerHandoff.provider", &handoff.provider)?;
            validate_optional_text("providerHandoff.searchBrief", &handoff.search_brief, 2_000)?;
            validate_optional_text("providerHandoff.openedAt", &handoff.opened_at, 80)?;
            let url = Url::parse(&handoff.url).map_err(|_| {
                AppError::with_detail(
                    ErrorCode::ValidationInvalidInput,
                    "provider handoff URL is invalid",
                    "field",
                    "providerHandoff.url",
                )
            })?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return invalid(
                    "providerHandoff.url",
                    "provider handoff URL must be a credential-free HTTPS address",
                );
            }
            if !handoff_ids.insert(handoff.id.clone()) {
                return invalid("providerHandoffs", "provider handoff ids must be unique");
            }
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSummary {
    pub id: String,
    pub trip_id: String,
    pub label: String,
    pub mime_type: String,
    pub byte_count: u32,
    pub content_hash: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContent {
    pub attachment: AttachmentSummary,
    pub content_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAttachmentInput {
    pub trip_id: String,
    pub label: String,
    pub mime_type: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergeTask {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub state: ConciergeTaskState,
    pub authority: AuthorityClass,
    pub section: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAction {
    pub id: String,
    pub provider: String,
    pub category: String,
    pub label: String,
    pub reason: String,
    pub url: String,
    pub canonical_domain: String,
    pub verification: ProviderVerification,
    pub transferred_fields: Vec<String>,
    pub remaining_fields: Vec<String>,
    pub evidence_url: String,
    pub search_brief: String,
    pub acquisition: ProviderAcquisition,
    pub cached_in_voyalier: bool,
    pub allowed_for_ai: bool,
    pub allowed_for_export: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationDocumentRequirement {
    pub id: String,
    pub label: String,
    pub status: PreparationDocumentStatus,
    #[serde(default)]
    pub linked_wallet_link_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationStep {
    pub id: String,
    pub traveler_id: String,
    pub title: String,
    pub applicability: String,
    pub next_action: String,
    pub authority_url: String,
    pub authority_name: String,
    pub source_checked_on: String,
    pub section: String,
    pub order: u16,
    #[serde(default)]
    pub prerequisite_ids: Vec<String>,
    #[serde(default)]
    pub document_requirements: Vec<PreparationDocumentRequirement>,
    pub state: ConciergeTaskState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AreaGuide {
    pub id: String,
    pub name: String,
    pub fit: String,
    pub tradeoff: String,
    pub source_url: String,
    pub source_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTotal {
    pub currency: String,
    pub estimates_minor: i64,
    pub committed_minor: i64,
    pub refunds_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConciergeWorkspace {
    pub profile: ConciergeProfile,
    pub attachments: Vec<AttachmentSummary>,
    pub tasks: Vec<ConciergeTask>,
    pub provider_actions: Vec<ProviderAction>,
    pub preparation_steps: Vec<PreparationStep>,
    pub area_guides: Vec<AreaGuide>,
    pub totals: Vec<CurrencyTotal>,
}

pub fn build_concierge_workspace(
    trip: &TripDetail,
    profile: ConciergeProfile,
    attachments: Vec<AttachmentSummary>,
) -> ConciergeWorkspace {
    let tasks = build_tasks(trip, &profile);
    let provider_actions = build_provider_actions(&trip.trip, &profile.preferences);
    let preparation_steps = build_preparation_steps(&trip.trip, &profile);
    let area_guides = build_area_guides(&trip.trip);
    let totals = build_totals(&profile.costs);
    ConciergeWorkspace {
        profile,
        attachments,
        tasks,
        provider_actions,
        preparation_steps,
        area_guides,
        totals,
    }
}

fn build_tasks(trip: &TripDetail, profile: &ConciergeProfile) -> Vec<ConciergeTask> {
    let is_hawaii = normalized(&trip.trip.destination).contains("hawai");
    let definitions = [
        (
            "choose-area",
            "Choose where to stay",
            "Select an island or neighborhood before comparing stays.",
            AuthorityClass::Traveler,
            "people",
            is_hawaii && profile.preferences.selected_area.is_none(),
        ),
        (
            "complete-party",
            "Complete traveler context",
            "Entry and room guidance stays conditional until each traveler has a profile.",
            AuthorityClass::Traveler,
            "people",
            profile.travelers.len() < profile.preferences.party_size as usize,
        ),
        (
            "compare-flights",
            "Compare flight routes",
            "Check live schedules and baggage rules on the provider before saving a candidate.",
            AuthorityClass::Provider,
            "book",
            !trip
                .confirmed_facts
                .iter()
                .any(|fact| matches!(fact.fact_type, crate::FactType::FlightSegment)),
        ),
        (
            "compare-stays",
            "Compare places to stay",
            "Carry the trip brief to providers, then import the confirmation you choose.",
            AuthorityClass::Provider,
            "book",
            !trip
                .confirmed_facts
                .iter()
                .any(|fact| matches!(fact.fact_type, crate::FactType::LodgingStay)),
        ),
        (
            "review-entry",
            "Review each traveler's official route",
            "Citizenship, document, residence and transit details can change the official pathway.",
            AuthorityClass::Official,
            "entry",
            !profile.travelers.is_empty(),
        ),
        (
            "collect-documents",
            "Collect travel documents",
            "Link imported confirmations and authority letters to the people who need them.",
            AuthorityClass::Evidence,
            "wallet",
            profile.wallet_links.is_empty(),
        ),
        (
            "plan-local",
            "Plan local transportation",
            "Record transfers, car decisions and time between confirmed segments.",
            AuthorityClass::Traveler,
            "plan",
            trip.trip_items.is_empty(),
        ),
        (
            "review-money",
            "Review the money plan",
            "Keep estimates, commitments and refunds separate in their original currencies.",
            AuthorityClass::Traveler,
            "money",
            profile.costs.is_empty(),
        ),
    ];
    let progress: BTreeMap<_, _> = profile
        .task_progress
        .iter()
        .map(|item| (item.task_id.as_str(), item))
        .collect();
    let mut tasks: Vec<_> = definitions
        .into_iter()
        .filter(|(id, _, _, _, _, active)| *active || progress.contains_key(id))
        .map(|(id, title, reason, authority, section, _)| {
            let saved = progress.get(id).copied();
            let saved_state = saved
                .map(|item| item.state)
                .unwrap_or(ConciergeTaskState::NotStarted);
            let route_sensitive_completion = matches!(
                saved_state,
                ConciergeTaskState::DoneByTraveler | ConciergeTaskState::NotApplicable
            ) && saved
                .and_then(|item| item.context_revision.as_deref())
                != Some(trip.trip.updated_at.as_str());
            ConciergeTask {
                id: id.to_owned(),
                title: title.to_owned(),
                reason: reason.to_owned(),
                state: if route_sensitive_completion {
                    ConciergeTaskState::NeedsRecheck
                } else {
                    saved_state
                },
                authority,
                section: section.to_owned(),
            }
        })
        .collect();
    let projected_state = |id: &str| {
        let saved = progress.get(id).copied();
        let state = saved
            .map(|item| item.state)
            .unwrap_or(ConciergeTaskState::NotStarted);
        if matches!(
            state,
            ConciergeTaskState::DoneByTraveler | ConciergeTaskState::NotApplicable
        ) && saved.and_then(|item| item.context_revision.as_deref())
            != Some(trip.trip.updated_at.as_str())
        {
            ConciergeTaskState::NeedsRecheck
        } else {
            state
        }
    };
    for stay in &profile.preferences.area_stays {
        let id = format!("compare-stay-{}", stay.id);
        let dates = match (&stay.check_in, &stay.check_out) {
            (Some(check_in), Some(check_out)) => format!("{check_in} to {check_out}"),
            _ => "dates still needed".to_owned(),
        };
        tasks.push(ConciergeTask {
            id: id.clone(),
            title: format!("Compare stays in {}", stay.area),
            reason: format!("This base covers {dates}; keep its confirmation separate."),
            state: projected_state(&id),
            authority: AuthorityClass::Provider,
            section: "book".to_owned(),
        });
    }
    for pair in profile.preferences.area_stays.windows(2) {
        let from = &pair[0];
        let to = &pair[1];
        let id = format!("plan-transfer-{}-{}", from.id, to.id);
        let timing = match (&from.check_out, &to.check_in) {
            (Some(check_out), Some(check_in)) if check_in < check_out => {
                "The base dates overlap; review the intended handoff before booking."
            }
            (Some(check_out), Some(check_in)) if check_in > check_out => {
                "There is a gap between bases; add lodging or confirm the overnight transfer."
            }
            (Some(_), Some(_)) => "The bases meet on the same local date.",
            _ => "Set both base date windows before treating this transfer as timed.",
        };
        tasks.push(ConciergeTask {
            id: id.clone(),
            title: format!("Plan the transfer from {} to {}", from.area, to.area),
            reason: timing.to_owned(),
            state: projected_state(&id),
            authority: AuthorityClass::Traveler,
            section: "plan".to_owned(),
        });
    }
    tasks.sort_by_key(|task| task_state_priority(task.state));
    tasks
}

fn task_state_priority(state: ConciergeTaskState) -> u8 {
    match state {
        ConciergeTaskState::NeedsRecheck => 0,
        ConciergeTaskState::InProgress => 1,
        ConciergeTaskState::Waiting => 2,
        ConciergeTaskState::NotStarted => 3,
        ConciergeTaskState::DoneByTraveler => 4,
        ConciergeTaskState::NotApplicable => 5,
    }
}

fn build_provider_actions(trip: &Trip, preferences: &ConciergePreferences) -> Vec<ProviderAction> {
    let destination = normalized(&trip.destination);
    let origin = normalized(&trip.origin);
    let area = preferences
        .selected_area
        .as_deref()
        .unwrap_or(&trip.destination);
    let mut brief_parts = vec![
        format!("{} to {}", trip.origin, area),
        format!("{} to {}", trip.start_date, trip.end_date),
        format!(
            "{} traveler{}",
            preferences.party_size,
            if preferences.party_size == 1 { "" } else { "s" }
        ),
        preferences
            .adults
            .map(|value| format!("{value} adult(s)"))
            .unwrap_or_else(|| "adult count unknown".to_owned()),
    ];
    if let Some(children) = preferences.children {
        brief_parts.push(format!("{children} child traveler(s)"));
    }
    if let Some(rooms) = preferences.rooms {
        brief_parts.push(format!("{rooms} room(s)"));
    }
    if let Some(bedrooms) = preferences.bedrooms {
        brief_parts.push(format!("{bedrooms} bedroom(s)"));
    }
    if let Some(beds) = preferences.beds {
        brief_parts.push(format!("{beds} bed(s)"));
    }
    let mut stay_needs = Vec::new();
    if preferences.kitchen_required {
        stay_needs.push("kitchen");
    }
    if preferences.laundry_required {
        stay_needs.push("laundry");
    }
    if preferences.air_conditioning_required {
        stay_needs.push("air conditioning");
    }
    if preferences.accessibility_required {
        stay_needs.push("accessibility features");
    }
    if preferences.flexible_cancellation_preferred {
        stay_needs.push("flexible cancellation");
    }
    if !stay_needs.is_empty() {
        brief_parts.push(format!("stay needs: {}", stay_needs.join(", ")));
    }
    brief_parts.push(format!("pace: {:?}", preferences.pace).to_lowercase());
    brief_parts.push(format!("car: {:?}", preferences.car_preference).to_lowercase());
    if preferences.budget_min_minor.is_some() || preferences.budget_max_minor.is_some() {
        brief_parts.push(format!(
            "budget {}–{} {} {}",
            preferences
                .budget_min_minor
                .map(|value| value.to_string())
                .unwrap_or_else(|| "open".to_owned()),
            preferences
                .budget_max_minor
                .map(|value| value.to_string())
                .unwrap_or_else(|| "open".to_owned()),
            preferences.base_currency,
            if preferences.budget_is_per_person {
                "per person in minor units"
            } else {
                "for the party in minor units"
            }
        ));
    }
    let search_brief = brief_parts.join(" · ");
    let (stay_url, stay_evidence) = if destination.contains("montr") {
        (
            "https://www.airbnb.com/montreal-canada/stays",
            "https://www.airbnb.com/montreal-canada/stays",
        )
    } else if normalized(area).contains("oahu") || normalized(area).contains("honolulu") {
        (
            "https://www.airbnb.com/oahu-hi/stays",
            "https://www.airbnb.com/oahu-hi/stays",
        )
    } else if destination.contains("hawai") {
        (
            "https://www.airbnb.com/hawaii-united-states/stays",
            "https://www.airbnb.com/hawaii-united-states/stays",
        )
    } else {
        ("https://www.airbnb.com/", "https://www.airbnb.com/")
    };
    let area_key = normalized(area);
    let is_oahu = area_key.contains("oahu") || area_key.contains("honolulu");
    let flight_url = if origin.contains("chicago") && destination.contains("montr") {
        "https://www.google.com/travel/flights/flights-from-chicago-to-montreal.html"
    } else if origin.contains("chicago") && destination.contains("hawai") && is_oahu {
        "https://www.google.com/travel/flights/flights-from-chicago-to-honolulu.html"
    } else {
        "https://www.google.com/travel/flights"
    };
    let expedia_url = if destination.contains("montr") {
        "https://www.expedia.com/Montreal-Hotels.d178288.Travel-Guide-Hotels"
    } else if destination.contains("hawai") && is_oahu {
        "https://www.expedia.com/Honolulu-Hotels.d1488.Travel-Guide-Hotels"
    } else {
        "https://www.expedia.com/"
    };
    let alltrails_url = if destination.contains("montr") {
        "https://www.alltrails.com/trail/canada/quebec/visite-a-pied-panoramique-de-montreal"
    } else if destination.contains("hawai") && is_oahu {
        "https://www.alltrails.com/hawaii/oahu/state-parks"
    } else {
        "https://www.alltrails.com/"
    };
    let mut actions = vec![
        action(
            "flights-google",
            "Google Flights",
            "flights",
            ActionCopy {
                label: "Compare flight routes",
                reason: "Useful route overview; confirm dates, airports, party, cabin and baggage on Google.",
            },
            ActionSource {
                url: flight_url,
                domain: "www.google.com",
                verification: if flight_url.ends_with("/flights") {
                    ProviderVerification::LinkOnly
                } else {
                    ProviderVerification::ObservedDestinationLink
                },
                evidence: flight_url,
            },
            ActionFields {
                transferred: if flight_url.ends_with("/flights") {
                    vec![]
                } else {
                    vec!["origin and destination route"]
                },
                remaining: if flight_url.ends_with("/flights") {
                    vec![
                        "origin",
                        "destination",
                        "dates",
                        "party",
                        "airports",
                        "cabin",
                        "baggage",
                    ]
                } else {
                    vec!["dates", "party", "airports", "cabin", "baggage"]
                },
            },
            &search_brief,
        ),
        action(
            "stays-airbnb",
            "Airbnb",
            "stays",
            ActionCopy {
                label: "Explore whole-home stays",
                reason: "A useful starting point for homes, kitchens and bedrooms; enter every filter on Airbnb.",
            },
            ActionSource {
                url: stay_url,
                domain: "www.airbnb.com",
                verification: if stay_url == "https://www.airbnb.com/" {
                    ProviderVerification::LinkOnly
                } else {
                    ProviderVerification::ObservedDestinationLink
                },
                evidence: stay_evidence,
            },
            ActionFields {
                transferred: if stay_url == "https://www.airbnb.com/" {
                    vec![]
                } else {
                    vec!["destination"]
                },
                remaining: if stay_url == "https://www.airbnb.com/" {
                    vec![
                        "destination",
                        "dates",
                        "guests",
                        "bedrooms",
                        "accessibility",
                        "cancellation",
                    ]
                } else {
                    vec![
                        "dates",
                        "guests",
                        "bedrooms",
                        "accessibility",
                        "cancellation",
                    ]
                },
            },
            &search_brief,
        ),
        action(
            "stays-expedia",
            "Expedia",
            "stays",
            ActionCopy {
                label: "Compare hotels and packages",
                reason: "Compare serviced stays and packages; the link opens Expedia and the brief carries your details.",
            },
            ActionSource {
                url: expedia_url,
                domain: "www.expedia.com",
                verification: if expedia_url == "https://www.expedia.com/" {
                    ProviderVerification::LinkOnly
                } else {
                    ProviderVerification::ObservedDestinationLink
                },
                evidence: expedia_url,
            },
            ActionFields {
                transferred: if expedia_url == "https://www.expedia.com/" {
                    vec![]
                } else {
                    vec!["destination"]
                },
                remaining: if expedia_url == "https://www.expedia.com/" {
                    vec!["destination", "dates", "travelers", "rooms", "filters"]
                } else {
                    vec!["dates", "travelers", "rooms", "filters"]
                },
            },
            &search_brief,
        ),
        action(
            "food-yelp",
            "Yelp",
            "food",
            ActionCopy {
                label: "Explore local food",
                reason: "Community reviews are one input; check the restaurant's own menu, hours and booking page.",
            },
            ActionSource {
                url: "https://www.yelp.com/",
                domain: "www.yelp.com",
                verification: ProviderVerification::LinkOnly,
                evidence: "https://www.yelp.com/",
            },
            ActionFields {
                transferred: vec![],
                remaining: vec!["destination", "cuisine", "date", "party"],
            },
            &search_brief,
        ),
        action(
            "community-reddit",
            "Reddit",
            "community",
            ActionCopy {
                label: "Read recent local discussions",
                reason: "Anecdotal ideas can expose tradeoffs; verify every practical claim with an official or direct source.",
            },
            ActionSource {
                url: "https://www.reddit.com/search/",
                domain: "www.reddit.com",
                verification: ProviderVerification::LinkOnly,
                evidence: "https://www.reddit.com/search/",
            },
            ActionFields {
                transferred: vec![],
                remaining: vec!["destination", "topic", "recency"],
            },
            &search_brief,
        ),
        action(
            "outdoors-alltrails",
            "AllTrails",
            "outdoors",
            ActionCopy {
                label: "Explore hikes and walks",
                reason: "Use community routes for discovery and official park pages for access, closures and permits.",
            },
            ActionSource {
                url: alltrails_url,
                domain: "www.alltrails.com",
                verification: if alltrails_url == "https://www.alltrails.com/" {
                    ProviderVerification::LinkOnly
                } else {
                    ProviderVerification::ObservedDestinationLink
                },
                evidence: alltrails_url,
            },
            ActionFields {
                transferred: if alltrails_url == "https://www.alltrails.com/" {
                    vec![]
                } else {
                    vec!["destination"]
                },
                remaining: if alltrails_url == "https://www.alltrails.com/" {
                    vec![
                        "destination",
                        "difficulty",
                        "distance",
                        "date",
                        "current access",
                    ]
                } else {
                    vec!["difficulty", "distance", "date", "current access"]
                },
            },
            &search_brief,
        ),
    ];
    if destination.contains("hawai") {
        actions.push(action(
            "destination-gohawaii",
            "Go Hawaiʻi",
            "official",
            ActionCopy {
                label: "Compare the Hawaiian Islands",
                reason: "Use the state tourism authority to choose an island before narrowing airports, stays and transport.",
            },
            ActionSource {
                url: "https://www.gohawaii.com/islands",
                domain: "www.gohawaii.com",
                verification: ProviderVerification::ObservedDestinationLink,
                evidence: "https://www.gohawaii.com/islands",
            },
            ActionFields {
                transferred: vec![],
                remaining: vec!["island", "area", "transport needs"],
            },
            &search_brief,
        ));
        if is_oahu {
            actions.push(action(
                "outdoors-diamond-head",
                "Hawaiʻi State Parks",
                "official",
                ActionCopy {
                    label: "Check Diamond Head access",
                    reason: "Use the park authority for reservations, current access rules and notices before adding a dated outing.",
                },
                ActionSource {
                    url: "https://dlnr.hawaii.gov/dsp/parks/oahu/diamond-head-state-monument/",
                    domain: "dlnr.hawaii.gov",
                    verification: ProviderVerification::ObservedDestinationLink,
                    evidence: "https://dlnr.hawaii.gov/dsp/parks/oahu/diamond-head-state-monument/",
                },
                ActionFields {
                    transferred: vec!["selected island"],
                    remaining: vec![
                        "date",
                        "reservation",
                        "current notices",
                        "traveler ability",
                    ],
                },
                &search_brief,
            ));
        }
    }
    if destination.contains("montr") {
        actions.push(action(
            "destination-montreal",
            "Tourisme Montréal",
            "official",
            ActionCopy {
                label: "Compare Montréal neighborhoods",
                reason: "Use official destination context for neighborhoods and food ideas, then verify each operator directly.",
            },
            ActionSource {
                url: "https://www.mtl.org/en/city/about-montreal/neighbourhoods/plateau-and-mile-end",
                domain: "www.mtl.org",
                verification: ProviderVerification::ObservedDestinationLink,
                evidence: "https://www.mtl.org/en/city/about-montreal/neighbourhoods/plateau-and-mile-end",
            },
            ActionFields {
                transferred: vec!["destination"],
                remaining: vec!["area", "dates", "opening hours", "reservations"],
            },
            &search_brief,
        ));
        actions.push(action(
            "transit-montreal-airport",
            "Google Maps",
            "transport",
            ActionCopy {
                label: "Plan airport transit",
                reason: "This documented Maps URL opens a transit route; confirm live service, fare and the final stay address there.",
            },
            ActionSource {
                url: "https://www.google.com/maps/dir/?api=1&origin=Montreal-Trudeau+International+Airport&destination=Downtown+Montreal&travelmode=transit",
                domain: "www.google.com",
                verification: ProviderVerification::DocumentedTemplate,
                evidence: "https://developers.google.com/maps/documentation/urls/get-started",
            },
            ActionFields {
                transferred: vec!["airport", "downtown", "transit mode"],
                remaining: vec!["arrival time", "final stay address", "live service", "fare"],
            },
            &search_brief,
        ));
    }
    actions.retain(|action| {
        Url::parse(&action.url).is_ok_and(|url| {
            url.scheme() == "https" && url.domain() == Some(action.canonical_domain.as_str())
        })
    });
    actions
}

struct ActionCopy<'a> {
    label: &'a str,
    reason: &'a str,
}

struct ActionSource<'a> {
    url: &'a str,
    domain: &'a str,
    verification: ProviderVerification,
    evidence: &'a str,
}

struct ActionFields<'a> {
    transferred: Vec<&'a str>,
    remaining: Vec<&'a str>,
}

fn action(
    id: &str,
    provider: &str,
    category: &str,
    copy: ActionCopy<'_>,
    source: ActionSource<'_>,
    fields: ActionFields<'_>,
    brief: &str,
) -> ProviderAction {
    ProviderAction {
        id: id.to_owned(),
        provider: provider.to_owned(),
        category: category.to_owned(),
        label: copy.label.to_owned(),
        reason: copy.reason.to_owned(),
        url: source.url.to_owned(),
        canonical_domain: source.domain.to_owned(),
        verification: source.verification,
        transferred_fields: fields.transferred.into_iter().map(str::to_owned).collect(),
        remaining_fields: fields.remaining.into_iter().map(str::to_owned).collect(),
        evidence_url: source.evidence.to_owned(),
        search_brief: brief.to_owned(),
        acquisition: ProviderAcquisition::LinkOnly,
        cached_in_voyalier: false,
        allowed_for_ai: false,
        allowed_for_export: false,
    }
}

fn build_preparation_steps(trip: &Trip, profile: &ConciergeProfile) -> Vec<PreparationStep> {
    let destination = normalized(&trip.destination);
    profile
        .travelers
        .iter()
        .flat_map(|traveler| {
            let mut specs = Vec::new();
            if destination.contains("hawai") {
                let (route_title, route_copy, route_action, route_url, route_authority) =
                    match profile.preferences.has_foreign_connection {
                        Some(false) => (
                            "Confirm domestic ID and flight route",
                            "This is a domestic U.S. route only while every booked segment remains inside the United States.",
                            "Check the accepted-ID list and every booked segment before travel.",
                            "https://www.tsa.gov/travel/security-screening/identification",
                            "U.S. Transportation Security Administration",
                        ),
                        Some(true) => (
                            "Review the international connection and U.S. return",
                            "A foreign connection makes this an international route even though Hawaiʻi is in the United States. Entry and return documents depend on the connection and traveler.",
                            "Use the official international-traveler route for every connection and return; do not rely on domestic-only guidance.",
                            "https://www.cbp.gov/travel/international-visitors",
                            "U.S. Customs and Border Protection",
                        ),
                        None => (
                            "Confirm whether every segment stays in the U.S.",
                            "Voyalier does not yet know whether the itinerary has a foreign connection, so domestic-only guidance is not established.",
                            "Choose the travel mode and foreign-connection answer, then review the route again.",
                            "https://www.cbp.gov/travel/international-visitors",
                            "U.S. Customs and Border Protection",
                        ),
                    };
                specs.push(StepSpec {
                    suffix: "hawaii-route",
                    title: route_title,
                    applicability: route_copy,
                    next_action: route_action,
                    authority_url: route_url,
                    authority_name: route_authority,
                    section: "transit",
                    order: 10,
                    prerequisites: vec![],
                    documents: vec![DocSpec {
                        suffix: "travel-id",
                        label: "Accepted travel identification",
                        status: PreparationDocumentStatus::TravelerAdded,
                    }],
                });
                specs.push(StepSpec {
                    suffix: "hawaii-ag",
                    title: "Prepare Hawaiʻi arrival declarations",
                    applicability: "Agricultural inspection and declaration rules apply to arrivals in Hawaiʻi; the official portal controls the current process.",
                    next_action: "Review the Hawaiʻi arrival portal close to departure and follow current carrier instructions.",
                    authority_url: "https://akamaiarrival.hawaii.gov/",
                    authority_name: "State of Hawaiʻi",
                    section: "entry",
                    order: 20,
                    prerequisites: vec!["hawaii-route"],
                    documents: vec![],
                });
            } else if destination.contains("montr") || destination.contains("canada") {
                let (entry_title, entry_copy) = match traveler.residence_status {
                    ResidenceStatus::PermanentResident
                        if traveler.residence_country_iso2.as_deref() == Some("US") =>
                    {
                        (
                            "Review the U.S. permanent-resident route",
                            "Canada publishes a distinct route for U.S. lawful permanent residents. Travel mode and proof still need confirmation in the official checker.",
                        )
                    }
                    ResidenceStatus::Citizen
                        if traveler.passport_country_iso2.as_deref() == Some("US") =>
                    {
                        (
                            "Review the U.S.-citizen document route",
                            "Confirm the current document rule for the selected travel mode. Voyalier does not infer citizenship from nationality or residence.",
                        )
                    }
                    _ => (
                        "Use Canada’s official entry-requirements tool",
                        "Passport, residence, purpose, travel mode and existing Canadian documents can change the route. U.S. residence or H-1B status alone does not establish Canadian admission.",
                    ),
                };
                let mode_copy = match profile.preferences.travel_mode {
                    TravelMode::Land => "Land-mode guidance can differ across official summaries. Treat this as a source conflict and confirm the exact document route in the official checker.",
                    TravelMode::Unknown => "Travel mode is unknown. Select air, land, sea or mixed before treating any document route as applicable.",
                    _ => entry_copy,
                };
                specs.push(StepSpec {
                    suffix: "canada-entry",
                    title: entry_title,
                    applicability: mode_copy,
                    next_action: "Answer the official checker with this traveler’s real documents and route before buying non-refundable travel. Save the result in the wallet.",
                    authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html",
                    authority_name: "Immigration, Refugees and Citizenship Canada",
                    section: "entry",
                    order: 10,
                    prerequisites: vec![],
                    documents: vec![DocSpec {
                        suffix: "checker-result",
                        label: "Official checker result or saved checklist",
                        status: PreparationDocumentStatus::TravelerAdded,
                    }],
                });
                specs.extend([
                    StepSpec {
                        suffix: "canada-application",
                        title: "Submit an application only if the checker requires one",
                        applicability: "This step stays conditional until the official checker identifies the required document and portal.",
                        next_action: "Follow the account checklist, upload only the requested documents, and keep the submission receipt.",
                        authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/account.html",
                        authority_name: "Immigration, Refugees and Citizenship Canada",
                        section: "entry",
                        order: 20,
                        prerequisites: vec!["canada-entry"],
                        documents: vec![DocSpec { suffix: "submission", label: "Application checklist and receipt", status: PreparationDocumentStatus::AuthorityConditional }],
                    },
                    StepSpec {
                        suffix: "canada-biometrics-letter",
                        title: "Wait for a biometrics instruction letter if requested",
                        applicability: "Biometrics are not assumed. The authority’s instruction letter controls whether, where and by when this traveler must attend.",
                        next_action: "If a letter arrives, add it to the wallet and use its deadline for the appointment task.",
                        authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/biometrics.html",
                        authority_name: "Immigration, Refugees and Citizenship Canada",
                        section: "entry",
                        order: 30,
                        prerequisites: vec!["canada-application"],
                        documents: vec![DocSpec { suffix: "biometrics-letter", label: "Biometrics instruction letter", status: PreparationDocumentStatus::AuthorityConditional }],
                    },
                    StepSpec {
                        suffix: "canada-biometrics",
                        title: "Attend an authorized biometrics location if instructed",
                        applicability: "Use only a location and deadline accepted by the authority’s letter. A consulate visit is not a universal step.",
                        next_action: "Book through the official path named in the letter and keep the appointment receipt.",
                        authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/biometrics/where-to-give.html",
                        authority_name: "Immigration, Refugees and Citizenship Canada",
                        section: "entry",
                        order: 40,
                        prerequisites: vec!["canada-biometrics-letter"],
                        documents: vec![DocSpec { suffix: "biometrics-receipt", label: "Biometrics appointment receipt", status: PreparationDocumentStatus::AuthorityConditional }],
                    },
                    StepSpec {
                        suffix: "canada-decision",
                        title: "Wait for the decision and any additional request",
                        applicability: "A submission or biometrics appointment does not mean approval. Keep authority requests separate from traveler-created notes.",
                        next_action: "Check the official account; add decision or request letters to the wallet without marking travel ready.",
                        authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-status.html",
                        authority_name: "Immigration, Refugees and Citizenship Canada",
                        section: "entry",
                        order: 50,
                        prerequisites: vec!["canada-application"],
                        documents: vec![DocSpec { suffix: "decision-letter", label: "Decision or additional-request letter", status: PreparationDocumentStatus::AuthorityConditional }],
                    },
                    StepSpec {
                        suffix: "canada-passport-return",
                        title: "Track passport submission and return only if requested",
                        applicability: "An approval letter and the physical travel document are separate. This step applies only when the authority requests the passport.",
                        next_action: "Keep the request, courier receipt and returned document status separate; do not mark ready while the passport is away.",
                        authority_url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/account.html",
                        authority_name: "Immigration, Refugees and Citizenship Canada",
                        section: "entry",
                        order: 60,
                        prerequisites: vec!["canada-decision"],
                        documents: vec![DocSpec { suffix: "passport-request", label: "Passport request and return receipt", status: PreparationDocumentStatus::AuthorityConditional }],
                    },
                ]);
                let returning_to_us = traveler
                    .return_country_iso2
                    .as_deref()
                    .map(|country| country == "US")
                    .unwrap_or(traveler.residence_country_iso2.as_deref() == Some("US"));
                let (return_title, return_copy, return_action, return_url, return_authority) =
                    if returning_to_us {
                        match traveler.residence_status {
                            ResidenceStatus::PermanentResident => (
                                "Review the return-to-U.S. permanent-resident documents",
                                "Canadian entry and return to the United States are separate decisions.",
                                "Review current permanent-resident document guidance and the carrier’s requirements.",
                                "https://www.help.cbp.gov/s/article/Article1287?language=en_US",
                                "U.S. Customs and Border Protection",
                            ),
                            ResidenceStatus::TemporaryWorker => (
                                "Review the return-to-U.S. temporary-worker documents",
                                "Visa validity, status evidence and the exact itinerary can affect return. Voyalier does not decide automatic-revalidation eligibility.",
                                "Review every official condition for the exact trip and seek qualified help when evidence is expired or unclear.",
                                "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/visa-expiration-date/auto-revalidate.html",
                                "U.S. Department of State",
                            ),
                            _ => (
                                "Review the return-to-U.S. documents",
                                "The return document depends on the traveler’s actual citizenship, status and evidence.",
                                "Use the official U.S. traveler route and confirm carrier requirements.",
                                "https://www.cbp.gov/travel/international-visitors",
                                "U.S. Customs and Border Protection",
                            ),
                        }
                    } else {
                        (
                            "Confirm onward or return-country documents",
                            "No U.S. return is assumed for this traveler. The next country’s authority controls the onward route.",
                            "Record the actual return or onward country, then use that authority’s official checker.",
                            "https://www.iatatravelcentre.com/",
                            "IATA Travel Centre",
                        )
                    };
                specs.push(StepSpec {
                    suffix: "return-route",
                    title: return_title,
                    applicability: return_copy,
                    next_action: return_action,
                    authority_url: return_url,
                    authority_name: return_authority,
                    section: "return",
                    order: 70,
                    prerequisites: vec!["canada-decision", "canada-passport-return"],
                    documents: vec![DocSpec {
                        suffix: "return-document",
                        label: "Return or onward travel documents",
                        status: PreparationDocumentStatus::TravelerAdded,
                    }],
                });
            }
            specs
                .into_iter()
                .map(|spec| preparation_step(trip, profile, traveler, spec))
                .collect::<Vec<_>>()
        })
        .collect()
}

struct DocSpec<'a> {
    suffix: &'a str,
    label: &'a str,
    status: PreparationDocumentStatus,
}

struct StepSpec<'a> {
    suffix: &'a str,
    title: &'a str,
    applicability: &'a str,
    next_action: &'a str,
    authority_url: &'a str,
    authority_name: &'a str,
    section: &'a str,
    order: u16,
    prerequisites: Vec<&'a str>,
    documents: Vec<DocSpec<'a>>,
}

fn preparation_step(
    trip: &Trip,
    profile: &ConciergeProfile,
    traveler: &TravelerProfile,
    spec: StepSpec<'_>,
) -> PreparationStep {
    let id = format!("{}-{}", traveler.id, spec.suffix);
    let state = profile
        .task_progress
        .iter()
        .find(|progress| progress.task_id == id)
        .map(|progress| {
            if matches!(
                progress.state,
                ConciergeTaskState::DoneByTraveler | ConciergeTaskState::NotApplicable
            ) && progress.context_revision.as_deref() != Some(trip.updated_at.as_str())
            {
                ConciergeTaskState::NeedsRecheck
            } else {
                progress.state
            }
        })
        .unwrap_or(ConciergeTaskState::NotStarted);
    PreparationStep {
        id,
        traveler_id: traveler.id.clone(),
        title: spec.title.to_owned(),
        applicability: spec.applicability.to_owned(),
        next_action: spec.next_action.to_owned(),
        authority_url: spec.authority_url.to_owned(),
        authority_name: spec.authority_name.to_owned(),
        source_checked_on: "2026-09-12".to_owned(),
        section: spec.section.to_owned(),
        order: spec.order,
        prerequisite_ids: spec
            .prerequisites
            .into_iter()
            .map(|suffix| format!("{}-{suffix}", traveler.id))
            .collect(),
        document_requirements: spec
            .documents
            .into_iter()
            .map(|document| {
                let requirement_id = format!("{}-{}", traveler.id, document.suffix);
                let linked_wallet_link_ids = profile
                    .wallet_links
                    .iter()
                    .filter(|link| link.preparation_requirement_ids.contains(&requirement_id))
                    .map(|link| link.id.clone())
                    .collect();
                PreparationDocumentRequirement {
                    id: requirement_id,
                    label: document.label.to_owned(),
                    status: document.status,
                    linked_wallet_link_ids,
                }
            })
            .collect(),
        state,
    }
}

fn build_area_guides(trip: &Trip) -> Vec<AreaGuide> {
    let destination = normalized(&trip.destination);
    if destination.contains("hawai") {
        return vec![
            area(
                "oahu",
                "Oʻahu",
                "City energy, beaches and the broadest transit options",
                "Busier centers and longer cross-island travel",
                "https://www.gohawaii.com/islands/oahu",
                "Hawaiʻi Tourism Authority",
            ),
            area(
                "maui",
                "Maui",
                "Beaches, road trips and varied resort bases",
                "A car may be useful and drive times shape the day",
                "https://www.gohawaii.com/islands/maui",
                "Hawaiʻi Tourism Authority",
            ),
            area(
                "hawaii-island",
                "Hawaiʻi Island",
                "Volcanic landscapes and large-scale nature",
                "Long distances make one-base plans demanding",
                "https://www.gohawaii.com/islands/hawaii-big-island",
                "Hawaiʻi Tourism Authority",
            ),
            area(
                "kauai",
                "Kauaʻi",
                "Quieter pace, coast and hiking",
                "Weather and access can change outdoor plans",
                "https://www.gohawaii.com/islands/kauai",
                "Hawaiʻi Tourism Authority",
            ),
        ];
    }
    if destination.contains("montr") || destination.contains("canada") {
        return vec![
            area(
                "old-montreal",
                "Old Montréal",
                "Historic streets and central sightseeing",
                "Popular core with tourist-oriented pricing",
                "https://www.mtl.org/en/experience/musts-old-montreal",
                "Tourisme Montréal",
            ),
            area(
                "plateau-mile-end",
                "Plateau and Mile End",
                "Food, cafés and neighborhood walks",
                "Farther from some Old Montréal sights",
                "https://www.mtl.org/en/explore/neighbourhoods/plateau-mont-royal-mile-end",
                "Tourisme Montréal",
            ),
            area(
                "downtown",
                "Downtown",
                "Metro access and a practical central base",
                "Less residential character than surrounding districts",
                "https://www.mtl.org/en/explore/neighbourhoods/downtown",
                "Tourisme Montréal",
            ),
        ];
    }
    Vec::new()
}

fn area(
    id: &str,
    name: &str,
    fit: &str,
    tradeoff: &str,
    source_url: &str,
    source_name: &str,
) -> AreaGuide {
    AreaGuide {
        id: id.to_owned(),
        name: name.to_owned(),
        fit: fit.to_owned(),
        tradeoff: tradeoff.to_owned(),
        source_url: source_url.to_owned(),
        source_name: source_name.to_owned(),
    }
}

fn build_totals(costs: &[CostItem]) -> Vec<CurrencyTotal> {
    let mut totals = BTreeMap::<String, CurrencyTotal>::new();
    for cost in costs {
        let Some(amount_minor) = cost.amount_minor else {
            continue;
        };
        let total = totals
            .entry(cost.currency.clone())
            .or_insert(CurrencyTotal {
                currency: cost.currency.clone(),
                estimates_minor: 0,
                committed_minor: 0,
                refunds_minor: 0,
            });
        match cost.state {
            CostState::Estimate => total.estimates_minor += amount_minor,
            CostState::Committed => total.committed_minor += amount_minor,
            CostState::Refund => total.refunds_minor += amount_minor,
        }
    }
    totals.into_values().collect()
}

fn clean_optional(value: Option<String>, field: &str) -> Result<Option<String>, AppError> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            validate_short(field, &value)?;
            Ok(Some(value.trim().to_owned()))
        }
        _ => Ok(None),
    }
}

fn validate_short(field: &str, value: &str) -> Result<(), AppError> {
    validate_text(field, value, MAX_CONCIERGE_TEXT)
}
fn validate_text(field: &str, value: &str, limit: usize) -> Result<(), AppError> {
    let count = value.chars().count();
    if value.trim().is_empty() || count > limit {
        return invalid(field, format!("must contain 1 to {limit} characters"));
    }
    Ok(())
}
fn validate_optional_text(field: &str, value: &str, limit: usize) -> Result<(), AppError> {
    if value.chars().count() > limit {
        return invalid(field, format!("must contain {limit} characters or fewer"));
    }
    Ok(())
}
fn validate_id(value: &str, field: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 96
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        return invalid(field, "must be a short local identifier");
    }
    Ok(())
}
fn validate_iso2(value: &Option<String>, field: &str) -> Result<(), AppError> {
    if value
        .as_ref()
        .is_some_and(|code| code.len() != 2 || !code.chars().all(|ch| ch.is_ascii_uppercase()))
    {
        return invalid(field, "must be a two-letter uppercase country code");
    }
    Ok(())
}
fn validate_currency(value: &str) -> Result<(), AppError> {
    if value.len() != 3 || !value.chars().all(|ch| ch.is_ascii_uppercase()) {
        return invalid("currency", "must be a three-letter uppercase currency code");
    }
    Ok(())
}
fn invalid<T>(field: &str, message: impl Into<String>) -> Result<T, AppError> {
    Err(AppError::with_detail(
        ErrorCode::ValidationInvalidInput,
        message,
        "field",
        field,
    ))
}
fn normalized(value: &str) -> String {
    value.to_lowercase().replace(['ʻ', '’', '\'', 'é'], "")
}

/// Acquisition policy for providers deliberately exposed by the concierge.
/// A link-only result may be opened by the traveler, but its pages must not be
/// copied into Voyalier's cache, search index, AI context, or exports.
pub fn provider_acquisition_for_url(value: &str) -> Option<ProviderAcquisition> {
    let host = Url::parse(value).ok()?.host_str()?.to_ascii_lowercase();
    let link_only = [
        "airbnb.com",
        "expedia.com",
        "yelp.com",
        "reddit.com",
        "alltrails.com",
        "google.com",
    ];
    link_only
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        .then_some(ProviderAcquisition::LinkOnly)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_hawaii_party_gets_domestic_steps_not_visa_claims() {
        let trip = Trip {
            id: "trip_hi".into(),
            title: "Hawaii".into(),
            origin: "Chicago".into(),
            destination: "Hawaii".into(),
            start_date: "2026-11-30".into(),
            end_date: "2026-12-14".into(),
            status: crate::TripStatus::Draft,
            created_at: "2026-09-12T00:00:00Z".into(),
            updated_at: "2026-09-12T00:00:00Z".into(),
        };
        let travelers = vec![
            TravelerProfile {
                id: "one".into(),
                display_name: "Traveler 1".into(),
                passport_country_iso2: Some("IN".into()),
                residence_country_iso2: Some("US".into()),
                residence_status: ResidenceStatus::TemporaryWorker,
                return_country_iso2: Some("US".into()),
                existing_destination_document: ExistingDocumentStatus::Unknown,
            },
            TravelerProfile {
                id: "two".into(),
                display_name: "Traveler 2".into(),
                passport_country_iso2: Some("IN".into()),
                residence_country_iso2: Some("US".into()),
                residence_status: ResidenceStatus::PermanentResident,
                return_country_iso2: Some("US".into()),
                existing_destination_document: ExistingDocumentStatus::Unknown,
            },
        ];
        let mut profile = ConciergeProfile::empty(&trip.id);
        profile.travelers = travelers;
        profile.preferences.has_foreign_connection = Some(false);
        let steps = build_preparation_steps(&trip, &profile);
        assert_eq!(steps.len(), 4);
        assert!(
            steps
                .iter()
                .all(|step| step.title.contains("domestic") || step.title.contains("Hawai"))
        );
    }

    #[test]
    fn a_foreign_hawaii_connection_reopens_international_and_return_review() {
        let trip = Trip {
            id: "trip_hi".into(),
            title: "Hawaii".into(),
            origin: "Chicago".into(),
            destination: "Hawaii".into(),
            start_date: "2026-11-30".into(),
            end_date: "2026-12-14".into(),
            status: crate::TripStatus::Draft,
            created_at: "2026-09-12T00:00:00Z".into(),
            updated_at: "2026-09-12T00:00:00Z".into(),
        };
        let mut profile = ConciergeProfile::empty(&trip.id);
        profile.preferences.has_foreign_connection = Some(true);
        profile.travelers.push(TravelerProfile {
            id: "worker".into(),
            display_name: "Traveler".into(),
            passport_country_iso2: Some("IN".into()),
            residence_country_iso2: Some("US".into()),
            residence_status: ResidenceStatus::TemporaryWorker,
            return_country_iso2: Some("US".into()),
            existing_destination_document: ExistingDocumentStatus::Unknown,
        });
        let steps = build_preparation_steps(&trip, &profile);
        assert!(steps[0].title.contains("international connection"));
        assert!(
            steps[0]
                .next_action
                .contains("do not rely on domestic-only")
        );
    }

    #[test]
    fn canada_land_mode_exposes_source_conflict_and_non_us_onward_route() {
        let trip = Trip {
            id: "trip_ca".into(),
            title: "Montréal".into(),
            origin: "Chicago".into(),
            destination: "Montréal".into(),
            start_date: "2027-05-01".into(),
            end_date: "2027-05-08".into(),
            status: crate::TripStatus::Draft,
            created_at: "2026-09-12T00:00:00Z".into(),
            updated_at: "2026-09-12T00:00:00Z".into(),
        };
        let mut profile = ConciergeProfile::empty(&trip.id);
        profile.preferences.travel_mode = TravelMode::Land;
        profile.travelers.push(TravelerProfile {
            id: "visitor".into(),
            display_name: "Traveler".into(),
            passport_country_iso2: Some("IN".into()),
            residence_country_iso2: Some("GB".into()),
            residence_status: ResidenceStatus::Visitor,
            return_country_iso2: Some("GB".into()),
            existing_destination_document: ExistingDocumentStatus::Unknown,
        });
        let steps = build_preparation_steps(&trip, &profile);
        assert!(steps[0].applicability.contains("source conflict"));
        assert!(
            steps
                .iter()
                .flat_map(|step| &step.document_requirements)
                .filter(|requirement| requirement.label.contains("Application checklist"))
                .all(|requirement| {
                    requirement.status == PreparationDocumentStatus::AuthorityConditional
                })
        );
        assert_eq!(
            steps.last().expect("return").title,
            "Confirm onward or return-country documents"
        );
    }

    #[test]
    fn money_totals_never_convert_currencies() {
        let totals = build_totals(&[
            CostItem {
                id: "usd".into(),
                label: "Stay".into(),
                category: "stays".into(),
                amount_minor: Some(10000),
                currency: "USD".into(),
                state: CostState::Estimate,
                tax_status: CostTaxStatus::Unknown,
                due_date: None,
            },
            CostItem {
                id: "cad".into(),
                label: "Meal".into(),
                category: "food".into(),
                amount_minor: Some(5000),
                currency: "CAD".into(),
                state: CostState::Committed,
                tax_status: CostTaxStatus::Unknown,
                due_date: None,
            },
        ]);
        assert_eq!(totals.len(), 2);
        assert_eq!(totals[0].currency, "CAD");
        assert_eq!(totals[1].currency, "USD");
    }

    #[test]
    fn money_rejects_inexact_wire_values_and_skips_unknown_amounts() {
        let mut profile = ConciergeProfile::empty("trip_money");
        profile.costs.push(CostItem {
            id: "unknown_tax".into(),
            label: "Taxes".into(),
            category: "stay".into(),
            amount_minor: None,
            currency: "USD".into(),
            state: CostState::Estimate,
            tax_status: CostTaxStatus::Unknown,
            due_date: None,
        });
        assert!(profile.clone().validate().is_ok());
        assert!(build_totals(&profile.costs).is_empty());
        profile.costs[0].amount_minor = Some(MAX_EXACT_MINOR_AMOUNT + 1);
        assert_eq!(
            profile
                .validate()
                .expect_err("unsafe integer rejected")
                .code,
            ErrorCode::ValidationInvalidInput
        );
    }

    #[test]
    fn an_explicit_onward_country_overrides_us_residence() {
        let trip = Trip {
            id: "trip_ca_onward".into(),
            title: "Montréal onward".into(),
            origin: "Chicago".into(),
            destination: "Montréal".into(),
            start_date: "2027-05-01".into(),
            end_date: "2027-05-08".into(),
            status: crate::TripStatus::Draft,
            created_at: "2026-09-12T00:00:00Z".into(),
            updated_at: "2026-09-12T00:00:00Z".into(),
        };
        let mut profile = ConciergeProfile::empty(&trip.id);
        profile.travelers.push(TravelerProfile {
            id: "onward".into(),
            display_name: "Traveler".into(),
            passport_country_iso2: Some("IN".into()),
            residence_country_iso2: Some("US".into()),
            residence_status: ResidenceStatus::TemporaryWorker,
            return_country_iso2: Some("IN".into()),
            existing_destination_document: ExistingDocumentStatus::Unknown,
        });
        let steps = build_preparation_steps(&trip, &profile);
        assert_eq!(
            steps.last().expect("onward route").title,
            "Confirm onward or return-country documents"
        );
    }

    #[test]
    fn hawaii_does_not_assume_honolulu_until_oahu_is_selected() {
        let trip = Trip {
            id: "trip_hi".into(),
            title: "Hawaii".into(),
            origin: "Chicago".into(),
            destination: "Hawaii".into(),
            start_date: "2026-11-30".into(),
            end_date: "2026-12-14".into(),
            status: crate::TripStatus::Draft,
            created_at: "2026-09-12T00:00:00Z".into(),
            updated_at: "2026-09-12T00:00:00Z".into(),
        };
        let undecided = build_provider_actions(&trip, &ConciergePreferences::default());
        assert!(
            undecided
                .iter()
                .all(|action| !action.url.contains("honolulu"))
        );
        let generic_flights = undecided
            .iter()
            .find(|action| action.id == "flights-google")
            .expect("generic flight handoff");
        assert!(generic_flights.remaining_fields.contains(&"origin".into()));
        assert!(
            generic_flights
                .remaining_fields
                .contains(&"destination".into())
        );
        let selected = ConciergePreferences {
            selected_area: Some("Oʻahu".into()),
            party_size: 4,
            adults: Some(2),
            children: Some(2),
            bedrooms: Some(2),
            beds: Some(3),
            kitchen_required: true,
            laundry_required: true,
            ..ConciergePreferences::default()
        };
        let narrowed = build_provider_actions(&trip, &selected);
        assert!(
            narrowed
                .iter()
                .any(|action| action.url.contains("chicago-to-honolulu"))
        );
        assert!(
            narrowed
                .iter()
                .any(|action| action.url.contains("Honolulu-Hotels"))
        );
        let yelp = narrowed
            .iter()
            .find(|action| action.id == "food-yelp")
            .expect("yelp handoff");
        assert_eq!(yelp.verification, ProviderVerification::LinkOnly);
        assert!(yelp.transferred_fields.is_empty());
        let trails = narrowed
            .iter()
            .find(|action| action.id == "outdoors-alltrails")
            .expect("AllTrails handoff");
        assert_eq!(
            trails.verification,
            ProviderVerification::ObservedDestinationLink
        );
        assert_eq!(trails.transferred_fields, vec!["destination"]);
        assert!(!trails.remaining_fields.contains(&"destination".into()));
        assert!(trails.search_brief.contains("2 adult(s)"));
        assert!(trails.search_brief.contains("2 bedroom(s)"));
        assert!(trails.search_brief.contains("3 bed(s)"));
        assert!(trails.search_brief.contains("kitchen"));
        assert!(trails.search_brief.contains("laundry"));
        assert_eq!(trails.acquisition, ProviderAcquisition::LinkOnly);
        assert!(!trails.cached_in_voyalier);
    }
}
