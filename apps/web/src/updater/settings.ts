import { countChars, type AppError } from "@voyalier/contracts";
import { UPDATER_KEYS } from "./types";

// Rust str::trim uses Unicode White_Space; JS trim differs for NEL and BOM.
export function updaterSettingKey(raw: string): string {
  const key = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  if (!Object.values(UPDATER_KEYS).some((known) => known === key))
    throw invalid("key");
  return key;
}

/** Mock parity with core's semver parser, including its u64 numeric components. */
export function validateUpdaterSetting(key: string, value: string): void {
  key = updaterSettingKey(key);
  if (key === UPDATER_KEYS.consent) {
    if (value !== "yes" && value !== "no") throw invalid("value");
    return;
  }
  if (value === "") return;
  const version =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
      value,
    );
  if (
    countChars(value) > 128 ||
    !version ||
    version[0] !== value ||
    version.slice(1, 4).some((part) => BigInt(part) > 18446744073709551615n) ||
    version[4]?.split(".").some((part) => /^0[0-9]+$/u.test(part))
  )
    throw invalid("value");
}

function invalid(field: string): AppError {
  return {
    code: "validation/invalid_input",
    message: "invalid updater setting",
    details: { field },
  };
}
