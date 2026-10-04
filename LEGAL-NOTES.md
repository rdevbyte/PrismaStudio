# Engineering notes on the sensitive-data guard and liability

**This is not legal advice.** These notes describe implementation choices and questions to discuss with qualified counsel, including counsel familiar with healthcare privacy (HIPAA), education privacy (FERPA), and the jurisdictions where the app is offered or used. See the user-facing [PRIVACY.md](PRIVACY.md) for the current data-flow description.

---

## Start with the actual data flow

The app is a static, client-side tool. In ordinary use, the browser reads and parses the selected file, then a local heuristic runs before statistical analysis. Parsing, the heuristic, and analysis run in the page or a browser worker; the app has no file-upload endpoint or server-side analysis API. The current build's Content Security Policy includes `connect-src 'none'` and the application makes no analytics or telemetry calls. The UI loads Google Sans from Google Fonts when available; those font requests can expose ordinary network/browser metadata to Google, but not spreadsheet contents or analysis results.

This is a meaningful reduction in the app operator's access to imported file contents, but it is **not** a guarantee of privacy, security, legal compliance, or physical data erasure. In particular:

- The browser has already read and parsed the file into memory before the heuristic can gate statistical analysis.
- If the app is hosted, the web host receives normal requests for the app and may process or retain connection metadata and access logs. That behavior is governed by the host, not this repository.
- The app deliberately stores the theme preference in browser `localStorage`; imported data and analysis are not deliberately persisted by the app.
- **Export report** is a local download requested by the user. It contains analysis output and up to 200 rows from the imported data, and may include in-session attestation details. The user controls the downloaded file and any later sharing.
- Browser extensions, device software, modified builds, compromised hosting, and other environmental factors are outside the app's control.

The app's local heuristic is only a confirmation gate. It can miss sensitive data and can flag ordinary data. It is not a PHI classifier, de-identification check, or security boundary. The no-PHI checkbox is an unverified statement by the user; it neither verifies the data nor establishes legal authorization.

---

## Legal questions the UI cannot answer

A checkbox does not resolve regulatory obligations. The relevant facts can include who operates the tool, who is using it, whose behalf it is used on, what data is processed, and what services or contracts exist. Ask counsel to assess the specific arrangement rather than relying on the interface text.

Questions to take to counsel include:

1. Given the actual deployment and relationships, what HIPAA roles or obligations, if any, apply? A user's attestation alone does not determine covered-entity or business-associate status.
2. Does any intended use require a Business Associate Agreement, other contract, security controls, or restrictions on processing?
3. Are student records subject to FERPA or state student-privacy laws, and what authorization, contract, or school-policy requirements apply?
4. Does the app's attestation wording accurately describe the user's authority and the intended use? It is not a waiver of third-party rights or a release from regulatory obligations.
5. What terms of use, privacy notice, insurance, entity structure, or incident-response plan are appropriate?
6. If the app ever adds uploads, accounts, server-side analysis, remote logging of user content, or other data-collection features, how must the legal, security, and privacy review change?

---

## What the current attestation does

When the heuristic flags a file, the app asks the user either to cancel and discard the in-memory dataset or to check a box stating that the file contains no protected health information and that they are authorized to analyze it. The **Analyse anyway** button remains disabled until the box is checked.

If the user proceeds, the app keeps the timestamp, file name, and matched terms in session memory and displays the attestation in the dashboard and any exported report. It does **not** record the user's identity, send the attestation to a server, or retain it after the app session. Exported reports can contain up to 200 data rows, so the user should protect the report accordingly.

This is an explicit confirmation step and a visible record in the local report. It is not a waiver, independent verification, consent from people represented in the data, or proof that the file is de-identified or compliant.

---

## On heuristic false positives and false negatives

The previous implementation matched `phi` as an arbitrary substring, so ordinary text such as **Philosophy**, **Philadelphia**, **Sophia**, **Memphis**, **Delphi**, **graphic_design**, and **trophies** could trigger it. It also only noticed a no-PHI note near the top of a file. Those specific issues were addressed:

- Clinical terms use word-boundary matching rather than loose substring matching.
- Stronger terms can trigger a confirmation on their own; softer terms need multiple signals, with education-related context considered to reduce some false positives.
- A phrase such as “synthetic” or “no PHI” found in file text is only a hint. It never bypasses the confirmation.
- The heuristic checks strong identifiers in parsed rows across the file, rather than only the first few dozen rows.

These changes only reduce known failure modes. They do not make the heuristic complete or reliable enough to classify health data, confirm anonymization, or replace an organization's privacy review. Do not use a negative scan as evidence that sensitive data is absent.

---

## Further reading in this repository

- [PRIVACY.md](PRIVACY.md) — app data flow, browser storage, exports, and hosted-copy caveats.
- [README.md](README.md) — supported files, analysis behavior, build and test commands.
- [DEPLOY.md](DEPLOY.md) — static deployment steps. A hosting provider's own policies still apply.
