# Privacy and data handling

**Scope.** This describes the current TabulaMetrics app in this repository. It is a technical description, not a promise by a hosting provider or legal advice. A deployed copy's host may have its own privacy policy, request logs, and retention practices.

## What happens to an imported file

1. You select, drop, or paste data into the app.
2. The browser reads and parses it locally. Parsing, the sensitive-data heuristic, type inference, and analysis run in the page or a browser worker; the app has no file-upload endpoint or server-side analysis API.
3. A local clinical-term heuristic runs after parsing and before statistical analysis. If it matches, the app may ask you to cancel or attest before continuing. Parsing has already occurred in browser memory at that point. This heuristic can produce false positives and false negatives; it cannot identify all health information, verify de-identification, or certify that a file is safe.
4. Analysis state is held in JavaScript memory. **Clear session** removes the app's references to the dataset and analysis. The app does not persist the dataset in localStorage, a database, or an application server. Closing the page ordinarily ends that in-memory session; this is not a guarantee of physical erasure from device memory, browser internals, crash dumps, or operating-system swap.

The app's source uses a restrictive Content Security Policy, including `connect-src 'none'`, and makes no application API calls, analytics requests, or telemetry calls. It does load the Google Fonts stylesheet and font files solely to display Google Sans. When those resources are requested, Google may receive ordinary network/browser request metadata; the app does not include spreadsheet contents or analysis results in the font requests. If Google Fonts is unavailable or the app is offline, system sans-serif fallbacks are used. This CSP is a technical restriction for the current build, not a universal security guarantee: browser extensions, modified builds, hosting configuration, and device-level software are outside the app's control. Inspect the exact copy and deployment you use.

## Browser storage and exports

- The only value deliberately written by the app to browser `localStorage` is the selected theme, under the key `tabulametrics-theme`.
- The app does not set tracking cookies. Hosting-provider behavior is separate and governed by that provider.
- **Export report** creates a local HTML download at your request. It contains analysis output, any in-session no-PHI attestation details, and a table with up to the first 200 data rows. The app does not upload the export. Protect the downloaded report as you would the original data; the browser's download location and any later sharing are under your control.
- The attestation and imported file are held in session memory only. The attestation is not independently verified and is not proof of compliance or authorization.

## If you use a hosted copy

Your browser must request the app's HTML from its host. The host therefore receives ordinary connection information needed to serve that request (for example, the requested URL, time, IP address, and browser/network metadata) and may keep access logs under its own policies. The application does not send the spreadsheet contents or analysis results to that host in ordinary use, but this repository cannot make claims about the host's log retention or other infrastructure. Check the hosting provider's current privacy and retention terms.

When using the standalone `TabulaMetrics.html` from local storage, the analysis app can run without a network connection in a supported browser. Google Sans falls back to system sans-serif fonts offline; if connectivity is available, loading the requested font sends ordinary resource-request metadata to Google. The browser still controls how local files, downloads, memory, and extensions behave.

## Sensitive or regulated information

The sensitive-data heuristic is a user-interface guard, not a privacy control, PHI classifier, de-identification tool, or security boundary. A no-PHI attestation is a user's statement and does not make an upload lawful, establish consent, or create HIPAA/FERPA compliance. Do not process regulated or sensitive data unless you have independently confirmed the applicable authorization, contracts, technical requirements, and policies. Local computation can reduce data transmission to the app operator; it does not remove all risks or determine anyone's legal status.

For engineering and legal-context notes, see [LEGAL-NOTES.md](LEGAL-NOTES.md). For setup and hosting details, see [DEPLOY.md](DEPLOY.md).
