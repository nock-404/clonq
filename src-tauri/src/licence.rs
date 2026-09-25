//! clonq Pro licence keys, checked offline (format: clonq-licenses/LICENSE-FORMAT.md).
//!
//! A key is `CLONQ1-<payload>.<signature>`: base64url JSON, signed with Ed25519. The public key
//! and the address of the licence service come in at build time (`CLONQ_LICENCE_PUBLIC_KEY`,
//! `CLONQ_LICENCE_SERVICE`), so the release workflow sets them and no code changes. A licence
//! unlocks Pro in every version released on or before its `updatesUntil`, for good.
//!
//! Pro never takes anything away that exists: snapshots stay readable and restorable whatever
//! the licence says. Only new Pro runs are refused, and they say why.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use chrono::NaiveDate;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "CLONQ1-";
const KEY_FILE: &str = "licence.key";
const REVOKED_FILE: &str = "licence-revoked.json";

/// The licence service's public key, raw 32 bytes in base64 or as an SPKI PEM.
const PUBLIC_KEY: Option<&str> = option_env!("CLONQ_LICENCE_PUBLIC_KEY");
/// The licence service, e.g. `https://licences.example.org`, for the revocation list.
pub const SERVICE: Option<&str> = option_env!("CLONQ_LICENCE_SERVICE");
/// The day this build was made, set by build.rs; licences are compared against it.
const RELEASED: &str = env!("CLONQ_RELEASED");

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    pub v: u32,
    pub id: String,
    pub email: String,
    pub plan: String,
    pub issued: NaiveDate,
    pub updates_until: Option<NaiveDate>,
}

/// What the settings show and what Pro features ask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Status {
    /// No key entered.
    None,
    /// Pro is on.
    Active { email: String, updates_until: Option<NaiveDate> },
    /// A valid key whose update time ended before this version was released.
    NotCovered { email: String, updates_until: Option<NaiveDate>, released: NaiveDate },
    /// Refunded, charged back or shared: on the revocation list.
    Revoked { email: String },
    /// This build has no public key, so it cannot check keys (a development build).
    Unchecked,
}

#[derive(Debug, PartialEq, Eq)]
pub enum KeyError {
    Format,
    Signature,
    Unsupported,
}

impl KeyError {
    pub fn message(&self) -> &'static str {
        match self {
            KeyError::Format => "this is not a clonq licence key",
            KeyError::Signature => "this licence key is not genuine",
            KeyError::Unsupported => "this licence key is for another product or version",
        }
    }
}

/// The public key from its build-time text: 32 raw bytes in base64, or an SPKI PEM whose
/// last 32 bytes of DER are the key.
pub fn public_key(text: &str) -> Option<VerifyingKey> {
    /// SPKI DER for Ed25519: this 12-byte header, then the 32 key bytes.
    const SPKI: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
    let body: String = text.lines().filter(|line| !line.starts_with("-----")).collect::<Vec<_>>().join("");
    let bytes = STANDARD.decode(body.trim()).ok()?;
    // Exactly a raw key or exactly a public-key SPKI; anything else (a private key pasted by
    // mistake, say) is refused instead of taking its last 32 bytes.
    let raw: [u8; 32] = match bytes.len() {
        32 => bytes.as_slice().try_into().ok()?,
        44 if bytes[..12] == SPKI => bytes[12..].try_into().ok()?,
        _ => return None,
    };
    VerifyingKey::from_bytes(&raw).ok()
}

fn built_in_key() -> Option<VerifyingKey> {
    PUBLIC_KEY.and_then(public_key)
}

/// Checks a pasted key: shape, signature, product.
pub fn read(key: &str, verifying: &VerifyingKey) -> Result<Payload, KeyError> {
    let key = key.trim();
    let rest = key.strip_prefix(PREFIX).ok_or(KeyError::Format)?;
    let (payload, signature) = rest.split_once('.').ok_or(KeyError::Format)?;
    if signature.contains('.') {
        return Err(KeyError::Format);
    }
    let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| KeyError::Format)?;
    let signature = Signature::from_slice(&signature).map_err(|_| KeyError::Format)?;
    verifying.verify_strict(payload.as_bytes(), &signature).map_err(|_| KeyError::Signature)?;
    let json = URL_SAFE_NO_PAD.decode(payload).map_err(|_| KeyError::Format)?;
    let payload: Payload = serde_json::from_slice(&json).map_err(|_| KeyError::Format)?;
    if payload.v != 1 || payload.plan != "pro" {
        return Err(KeyError::Unsupported);
    }
    Ok(payload)
}

/// Whether a licence covers a version released on `released`.
pub fn covers(payload: &Payload, released: NaiveDate) -> bool {
    payload.updates_until.is_none_or(|until| released <= until)
}

/// The signed revocation list the service publishes.
#[derive(Debug, Deserialize, Serialize)]
pub struct Signed {
    pub list: String,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
struct Revoked {
    v: u32,
    /// When the service made the list; an older list never replaces a newer one.
    #[serde(default)]
    at: Option<String>,
    revoked: Vec<String>,
}

fn genuine_list(signed: &Signed, verifying: &VerifyingKey) -> Option<Revoked> {
    let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(&signed.signature).ok()?).ok()?;
    verifying.verify_strict(signed.list.as_bytes(), &signature).ok()?;
    let list: Revoked = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&signed.list).ok()?).ok()?;
    (list.v == 1).then_some(list)
}

/// The licence ids on a revocation list, if its signature is genuine.
pub fn revoked_ids(signed: &Signed, verifying: &VerifyingKey) -> Option<Vec<String>> {
    genuine_list(signed, verifying).map(|list| list.revoked)
}

fn made_at(list: &Revoked) -> Option<chrono::DateTime<chrono::Utc>> {
    list.at.as_deref().and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok()).map(|at| at.with_timezone(&chrono::Utc))
}

fn released() -> NaiveDate {
    // An unreadable build date must not unlock every licence: it counts as the newest version.
    NaiveDate::parse_from_str(RELEASED, "%Y-%m-%d").unwrap_or(NaiveDate::MAX)
}

/// Where the key and the last good revocation list are kept.
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: &Path) -> Self {
        Self { dir: dir.to_path_buf() }
    }

    pub fn status(&self) -> Status {
        self.status_with(built_in_key().as_ref(), released())
    }

    fn status_with(&self, verifying: Option<&VerifyingKey>, released: NaiveDate) -> Status {
        let Ok(key) = std::fs::read_to_string(self.dir.join(KEY_FILE)) else { return Status::None };
        let Some(verifying) = verifying else { return Status::Unchecked };
        let Ok(payload) = read(&key, verifying) else { return Status::None };
        let revoked = std::fs::read_to_string(self.dir.join(REVOKED_FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<Signed>(&text).ok())
            .and_then(|signed| revoked_ids(&signed, verifying))
            .unwrap_or_default();
        if revoked.contains(&payload.id) {
            return Status::Revoked { email: payload.email };
        }
        if !covers(&payload, released) {
            return Status::NotCovered { email: payload.email, updates_until: payload.updates_until, released };
        }
        Status::Active { email: payload.email, updates_until: payload.updates_until }
    }

    /// Checks and saves a pasted key; nothing is saved when it is not valid.
    pub fn enter(&self, key: &str) -> Result<Status, KeyError> {
        let verifying = built_in_key().ok_or(KeyError::Signature)?;
        read(key, &verifying)?;
        std::fs::create_dir_all(&self.dir).map_err(|_| KeyError::Format)?;
        std::fs::write(self.dir.join(KEY_FILE), key.trim()).map_err(|_| KeyError::Format)?;
        Ok(self.status())
    }

    pub fn remove(&self) {
        let _ = std::fs::remove_file(self.dir.join(KEY_FILE));
    }

    /// Keeps a fetched revocation list, but only a genuine one: a wrong or broken answer never
    /// replaces the last good list.
    pub fn keep_revocations(&self, answer: &str) -> bool {
        match built_in_key() {
            Some(verifying) => self.keep_revocations_with(answer, &verifying),
            None => false,
        }
    }

    fn keep_revocations_with(&self, answer: &str, verifying: &VerifyingKey) -> bool {
        let Ok(signed) = serde_json::from_str::<Signed>(answer) else { return false };
        let Some(list) = genuine_list(&signed, verifying) else { return false };
        // A replayed older list must not lift a newer revocation.
        let kept = std::fs::read_to_string(self.dir.join(REVOKED_FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<Signed>(&text).ok())
            .and_then(|signed| genuine_list(&signed, verifying));
        if let (Some(kept), Some(new)) = (kept.as_ref().and_then(made_at), made_at(&list))
            && new < kept
        {
            return false;
        }
        std::fs::write(self.dir.join(REVOKED_FILE), answer).is_ok()
    }

    /// Whether Pro features may start a new run now. A build without a public key can check
    /// nothing: only a development build is open then, never a release that lacks the key.
    pub fn pro(&self) -> bool {
        match self.status() {
            Status::Active { .. } => true,
            Status::Unchecked | Status::None => cfg!(debug_assertions) && PUBLIC_KEY.is_none(),
            _ => false,
        }
    }
}

/// Refuses a Pro run up front, with a sentence that says why, instead of letting it fail later.
pub fn allows(dir: &Path, config: &crate::config::Config, job_id: &str) -> crate::error::Result<()> {
    let Some(job) = config.job(job_id) else { return Ok(()) };
    if job.mode != crate::config::Mode::Versioned {
        return Ok(());
    }
    require(dir, "versioned backups are part of clonq Pro: enter a licence in Settings")
}

/// A refusal from `allows` or `allows_check` in the interface language, for notifications
/// (the app itself translates the English text through its catalog).
pub fn refusal_text(english: &str, german: bool) -> String {
    if !german {
        let mut text = english.to_string();
        if let Some(first) = text.get_mut(..1) {
            first.make_ascii_uppercase();
        }
        return format!("{text}.");
    }
    if let Some(until) = english.strip_prefix("your clonq Pro licence covers versions released until ").and_then(|rest| rest.split(';').next()) {
        return format!("Deine Lizenz für clonq Pro gilt für Versionen bis zum {until}; diese Version ist neuer. Der Job läuft erst wieder mit einer gültigen Lizenz.");
    }
    match english {
        "this clonq Pro licence has been withdrawn" => "Diese Lizenz für clonq Pro wurde zurückgezogen. Der Job läuft erst wieder mit einer gültigen Lizenz.".into(),
        "the integrity check is part of clonq Pro: enter a licence in Settings" => "Der Prüflauf gehört zu clonq Pro. Trage in den Einstellungen eine Lizenz ein.".into(),
        _ => "Versionen gehören zu clonq Pro. Trage in den Einstellungen eine Lizenz ein; bis dahin läuft dieser Job nicht.".into(),
    }
}

/// Refuses an integrity check without Pro.
pub fn allows_check(dir: &Path) -> crate::error::Result<()> {
    require(dir, "the integrity check is part of clonq Pro: enter a licence in Settings")
}

fn require(dir: &Path, missing: &str) -> crate::error::Result<()> {
    let store = Store::new(dir);
    if store.pro() {
        return Ok(());
    }
    Err(crate::error::Error::Job(match store.status() {
        Status::NotCovered { updates_until: Some(until), .. } => format!("your clonq Pro licence covers versions released until {until}; this version is newer"),
        Status::Revoked { .. } => "this clonq Pro licence has been withdrawn".into(),
        _ => missing.into(),
    }))
}

/// What an update would do to Pro, asked before it is installed (LICENSE-FORMAT.md, point 5).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCover {
    /// False only when a licence is active now and does not cover the new version.
    pub covered: bool,
    pub updates_until: Option<NaiveDate>,
    /// Where a new licence is bought, when the build knows the licence service.
    pub renew_url: Option<String>,
}

/// Whether the licence also covers a version published on `published` (its release date).
pub fn covers_update(dir: &Path, published: NaiveDate) -> UpdateCover {
    cover_for(Store::new(dir).status(), published)
}

fn cover_for(status: Status, published: NaiveDate) -> UpdateCover {
    let renew_url = SERVICE.map(|service| format!("{}/buy", service.trim_end_matches('/')));
    match status {
        Status::Active { updates_until: Some(until), .. } if published > until => UpdateCover { covered: false, updates_until: Some(until), renew_url },
        _ => UpdateCover { covered: true, updates_until: None, renew_url: None },
    }
}

/// Fetches the revocation list with the system's curl; offline simply keeps the last one.
pub async fn refresh(store: &Store) {
    let Some(service) = SERVICE else { return };
    let url = format!("{}/api/revoked", service.trim_end_matches('/'));
    let Ok(output) = tokio::process::Command::new("/usr/bin/curl").args(["-fsSL", "--max-time", "20", &url]).output().await else { return };
    if output.status.success() {
        store.keep_revocations(&String::from_utf8_lossy(&output.stdout));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn pair() -> (SigningKey, VerifyingKey) {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let verifying = signing.verifying_key();
        (signing, verifying)
    }

    fn key(signing: &SigningKey, json: &str) -> String {
        let payload = URL_SAFE_NO_PAD.encode(json);
        let signature = URL_SAFE_NO_PAD.encode(signing.sign(payload.as_bytes()).to_bytes());
        format!("{PREFIX}{payload}.{signature}")
    }

    const PRO: &str = r#"{"v":1,"id":"lic_1","email":"a@b.c","plan":"pro","issued":"2026-09-24","updatesUntil":"2027-09-24"}"#;

    #[test]
    fn a_genuine_key_is_read() {
        let (signing, verifying) = pair();
        let payload = read(&format!("  {}\n", key(&signing, PRO)), &verifying).unwrap();
        assert_eq!(payload.id, "lic_1");
        assert_eq!(payload.updates_until, NaiveDate::from_ymd_opt(2027, 9, 24));
    }

    #[test]
    fn forged_or_broken_keys_are_refused() {
        let (signing, verifying) = pair();
        let good = key(&signing, PRO);
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(read(&key(&other, PRO), &verifying), Err(KeyError::Signature), "signed by someone else");
        // Changing the payload after signing breaks the signature.
        let (payload, signature) = good.strip_prefix(PREFIX).unwrap().split_once('.').unwrap();
        let tampered = URL_SAFE_NO_PAD.encode(String::from_utf8(URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap().replace("2027", "2099"));
        assert_eq!(read(&format!("{PREFIX}{tampered}.{signature}"), &verifying), Err(KeyError::Signature));
        assert_eq!(read("hello", &verifying), Err(KeyError::Format));
        assert_eq!(read(&format!("{good}.x"), &verifying), Err(KeyError::Format));
        assert_eq!(read(&key(&signing, &PRO.replace("\"pro\"", "\"team\"")), &verifying), Err(KeyError::Unsupported));
        assert_eq!(read(&key(&signing, &PRO.replace("\"v\":1", "\"v\":2")), &verifying), Err(KeyError::Unsupported));
    }

    #[test]
    fn coverage_follows_the_release_date() {
        let (signing, verifying) = pair();
        let payload = read(&key(&signing, PRO), &verifying).unwrap();
        assert!(covers(&payload, NaiveDate::from_ymd_opt(2027, 9, 24).unwrap()), "the last day counts");
        assert!(!covers(&payload, NaiveDate::from_ymd_opt(2027, 9, 25).unwrap()));
        let forever = read(&key(&signing, &PRO.replace("\"2027-09-24\"", "null")), &verifying).unwrap();
        assert!(covers(&forever, NaiveDate::from_ymd_opt(2099, 1, 1).unwrap()));
    }

    #[test]
    fn the_public_key_is_read_from_base64_or_pem() {
        let (_, verifying) = pair();
        let raw = STANDARD.encode(verifying.to_bytes());
        assert_eq!(public_key(&raw), Some(verifying));
        // SPKI DER for Ed25519 is a 12-byte header followed by the 32 key bytes.
        let mut der = vec![0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
        der.extend_from_slice(&verifying.to_bytes());
        let pem = format!("-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n", STANDARD.encode(der));
        assert_eq!(public_key(&pem), Some(verifying));
    }

    #[test]
    fn status_reaches_the_interface_in_camel_case() {
        let status = Status::Active { email: "a@b.c".into(), updates_until: NaiveDate::from_ymd_opt(2027, 9, 24) };
        assert_eq!(serde_json::to_string(&status).unwrap(), r#"{"state":"active","email":"a@b.c","updatesUntil":"2027-09-24"}"#);
    }

    #[test]
    fn status_revocation_and_coverage() {
        let (signing, verifying) = pair();
        let dir = std::env::temp_dir().join(format!("clonq-licence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::new(&dir);
        let day = |y, m, d| NaiveDate::from_ymd_opt(y, m, d).unwrap();
        assert_eq!(store.status_with(Some(&verifying), day(2026, 10, 1)), Status::None);
        std::fs::write(dir.join(KEY_FILE), key(&signing, PRO)).unwrap();
        assert!(matches!(store.status_with(Some(&verifying), day(2026, 10, 1)), Status::Active { .. }));
        assert!(matches!(store.status_with(Some(&verifying), day(2028, 1, 1)), Status::NotCovered { .. }));
        // A genuine list with this id revokes it; a forged one is ignored.
        let list = URL_SAFE_NO_PAD.encode(r#"{"v":1,"at":"2026-10-01T00:00:00Z","revoked":["lic_1"]}"#);
        let genuine = Signed { signature: URL_SAFE_NO_PAD.encode(signing.sign(list.as_bytes()).to_bytes()), list: list.clone() };
        let forged = Signed { signature: URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[9u8; 32]).sign(list.as_bytes()).to_bytes()), list };
        std::fs::write(dir.join(REVOKED_FILE), serde_json::to_string(&forged).unwrap()).unwrap();
        assert!(matches!(store.status_with(Some(&verifying), day(2026, 10, 1)), Status::Active { .. }), "a forged list must not revoke");
        std::fs::write(dir.join(REVOKED_FILE), serde_json::to_string(&genuine).unwrap()).unwrap();
        assert!(matches!(store.status_with(Some(&verifying), day(2026, 10, 1)), Status::Revoked { .. }));
        // Without a built-in public key (a development build) keys cannot be checked.
        assert_eq!(store.status_with(None, day(2026, 10, 1)), Status::Unchecked);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_update_past_the_update_time_is_announced_and_nothing_else_is() {
        let day = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap();
        let active = |until: Option<&str>| Status::Active { email: "a@b.c".into(), updates_until: until.map(day) };
        assert!(!cover_for(active(Some("2027-09-24")), day("2027-10-01")).covered);
        assert_eq!(cover_for(active(Some("2027-09-24")), day("2027-10-01")).updates_until, Some(day("2027-09-24")));
        assert!(cover_for(active(Some("2027-09-24")), day("2027-09-24")).covered, "released on the last day is covered");
        assert!(cover_for(active(None), day("2040-01-01")).covered, "updates for good");
        assert!(cover_for(Status::None, day("2040-01-01")).covered, "without Pro an update takes nothing away");
    }

    #[test]
    fn a_private_key_or_other_blob_is_not_taken_as_the_public_key() {
        let (_, verifying) = pair();
        // PKCS#8 of an Ed25519 private key is 48 bytes; its tail is the secret seed.
        let mut private = vec![0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
        private.extend_from_slice(&verifying.to_bytes());
        assert_eq!(public_key(&STANDARD.encode(&private)), None);
        assert_eq!(public_key(&STANDARD.encode([0_u8; 40])), None);
    }

    #[test]
    fn an_older_revocation_list_never_replaces_a_newer_one() {
        let (signing, verifying) = pair();
        let dir = std::env::temp_dir().join(format!("clonq-revoked-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::new(&dir);
        let answer = |at: &str, ids: &str| {
            let list = URL_SAFE_NO_PAD.encode(format!(r#"{{"v":1,"at":"{at}","revoked":[{ids}]}}"#));
            let signature = URL_SAFE_NO_PAD.encode(signing.sign(list.as_bytes()).to_bytes());
            format!(r#"{{"list":"{list}","signature":"{signature}"}}"#)
        };
        assert!(store.keep_revocations_with(&answer("2026-10-02T08:00:00Z", r#""lic_1""#), &verifying));
        assert!(!store.keep_revocations_with(&answer("2026-10-01T08:00:00Z", ""), &verifying), "an old list is replayed");
        assert!(store.keep_revocations_with(&answer("2026-10-03T08:00:00Z", r#""lic_1","lic_2""#), &verifying));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Keys and a revocation list made by the licence service's own code (clonq-licenses,
    /// src/license.ts and /api/revoked) with a throwaway key pair: the two sides agree.
    #[test]
    fn keys_and_revocations_from_the_licence_service_are_understood() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture {
            public_key: String,
            active: String,
            forever: String,
            revoked_key: String,
            revocations: String,
        }
        let fixture: Fixture = serde_json::from_str(include_str!("../tests/licence-service-interop.json")).unwrap();
        let verifying = public_key(&fixture.public_key).expect("the service's PEM public key");
        let active = read(&fixture.active, &verifying).expect("a key the service issued");
        assert_eq!((active.id.as_str(), active.email.as_str()), ("lic_interop_active", "käufer@example.org"));
        assert_eq!(active.updates_until, NaiveDate::from_ymd_opt(2027, 9, 25));
        assert!(covers(&active, NaiveDate::from_ymd_opt(2027, 9, 25).unwrap()));
        assert!(!covers(&active, NaiveDate::from_ymd_opt(2027, 9, 26).unwrap()));
        assert_eq!(read(&fixture.forever, &verifying).unwrap().updates_until, None);
        // Pasted with the whitespace a mail programme adds.
        assert!(read(&format!("  {}\n", fixture.active), &verifying).is_ok());
        let signed: Signed = serde_json::from_str(&fixture.revocations).unwrap();
        assert_eq!(revoked_ids(&signed, &verifying), Some(vec!["lic_interop_revoked".to_string()]));
        let dir = std::env::temp_dir().join(format!("clonq-interop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::new(&dir);
        assert!(store.keep_revocations_with(&fixture.revocations, &verifying));
        std::fs::write(dir.join(KEY_FILE), &fixture.revoked_key).unwrap();
        assert!(matches!(store.status_with(Some(&verifying), NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()), Status::Revoked { .. }));
        std::fs::write(dir.join(KEY_FILE), &fixture.active).unwrap();
        assert!(matches!(store.status_with(Some(&verifying), NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()), Status::Active { .. }));
        let _ = std::fs::remove_dir_all(dir);
    }
}
