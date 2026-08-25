import path from "node:path";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireLoopbackOrigin(origin) {
  const parsed = new URL(requireString(origin, "origin"));
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("origin must be an http://127.0.0.1 loopback URL");
  }
  if (!parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "origin must contain only a loopback host and explicit port",
    );
  }
  return parsed.origin;
}

export function buildWindowsUpdaterManifest({
  version,
  installerName,
  signature,
  origin,
  publishedAt,
}) {
  version = requireString(version, "version");
  if (!SEMVER.test(version)) throw new Error("version must be SemVer");

  installerName = requireString(installerName, "installerName");
  if (
    path.win32.basename(installerName) !== installerName ||
    path.posix.basename(installerName) !== installerName ||
    !installerName.toLowerCase().endsWith("-setup.exe")
  ) {
    throw new Error("installerName must be a bare NSIS -setup.exe filename");
  }

  signature = requireString(signature, "signature");
  if (signature.length > 16_384)
    throw new Error("signature is unexpectedly large");
  const safeOrigin = requireLoopbackOrigin(origin);
  const pubDate = new Date(publishedAt ?? Date.now());
  if (Number.isNaN(pubDate.valueOf()))
    throw new Error("publishedAt must be a date");

  const updater = {
    signature,
    url: `${safeOrigin}/${encodeURIComponent(installerName)}`,
  };
  return {
    version,
    notes: "Ephemeral Windows installed-updater acceptance fixture.",
    pub_date: pubDate.toISOString(),
    platforms: {
      // The explicit NSIS target is the release-contract key. The plain alias
      // matches tauri-action's compatibility output and older v2 target lookup.
      "windows-x86_64": updater,
      "windows-x86_64-nsis": updater,
    },
  };
}

export function allowedUpdaterPath(requestUrl, installerName) {
  installerName = requireString(installerName, "installerName");
  const url = new URL(requestUrl, "http://127.0.0.1");
  return (
    url.search === "" &&
    (url.pathname === "/latest.json" ||
      url.pathname === `/${encodeURIComponent(installerName)}`)
  );
}

export function buildWindowsDriverCapabilities({
  application,
  userDataFolder,
}) {
  application = requireString(application, "application");
  userDataFolder = requireString(userDataFolder, "userDataFolder");
  if (!path.win32.isAbsolute(application)) {
    throw new Error("application must be an absolute Windows path");
  }
  if (!path.win32.isAbsolute(userDataFolder)) {
    throw new Error("userDataFolder must be an absolute Windows path");
  }

  return {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": {
          application,
          args: [],
          webviewOptions: { userDataFolder },
        },
      },
    },
  };
}

export function validateWindowsAcceptanceReport(report) {
  if (!report || report.verdict !== "PASS") {
    throw new Error("acceptance report must have a PASS verdict");
  }
  if (report.stage !== "complete") {
    throw new Error(
      "acceptance report did not complete every installed-app stage",
    );
  }
  if (report.base?.version !== "0.10.7") {
    throw new Error("acceptance base must be the public v0.10.7 release");
  }
  if (report.candidate?.version !== "0.11.0") {
    throw new Error("acceptance candidate must be v0.11.0");
  }
  if (report.installed?.before !== "0.10.7") {
    throw new Error("installed base version was not observed");
  }
  if (report.installed?.after !== "0.11.0") {
    throw new Error(
      "installed candidate version was not observed after the swap",
    );
  }
  if (report.installed?.recovery !== "0.11.0") {
    throw new Error("reinstall recovery did not reopen the candidate");
  }
  if (report.data?.tripCountBefore !== 1 || report.data?.tripCountAfter !== 1) {
    throw new Error("traveler-owned data did not survive the updater swap");
  }
  if (report.data?.tripCountAfterRecovery !== 1) {
    throw new Error("traveler-owned data did not survive reinstall recovery");
  }
  if (!(report.data?.backupCount >= 1)) {
    throw new Error("the pre-update backup was not observed");
  }
  if (!report.network?.requests?.includes("/latest.json")) {
    throw new Error("the updater manifest was not requested");
  }
  if (
    !report.network?.requests?.some((request) => request.endsWith("-setup.exe"))
  ) {
    throw new Error("the NSIS updater artifact was not requested");
  }
  if (report.network?.nonLoopbackRequests !== 0) {
    throw new Error("the fixture server observed a non-loopback request");
  }
  if (
    !Array.isArray(report.network?.listeners) ||
    report.network.listeners.some((listener) => !listener.loopback)
  ) {
    throw new Error("the installed app exposed a non-loopback listener");
  }
  return report;
}
