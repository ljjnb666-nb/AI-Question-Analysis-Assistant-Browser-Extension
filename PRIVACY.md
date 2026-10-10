# Privacy and data flows

This document describes what the extension and its services send and store. It is a technical description of the current implementation.

## Optional usage analytics

Optional usage analytics is **off by default**. It is sent only after you turn it on in Settings and save your choice. The extension stores the current consent version with that choice. A stored on-state from a version that had no visible consent control is not treated as consent: the first load turns analytics off and clears the old analytics log.

When enabled, analytics can send a random device ID, the current analytics consent protocol version, an event name, a timestamp, extension version, elapsed time when relevant, and small event-specific categories such as provider, route, attempt count, and normalized failure category. The analytics server accepts only telemetry carrying its current consent protocol version, as well as known event names and allowlisted fields. Clients that do not use the explicit-consent protocol, or send an unsupported version, are rejected. This protocol marker identifies a consent-aware client; it is not cryptographic proof that a person clicked the control. The extension sends analytics only when its stored opt-in is enabled. The endpoint does not receive a page hostname, question or answer content, explanations, screenshots or images, block or question identifiers, API keys, account tokens, passwords, verification codes, email addresses, or client-supplied account IDs. The random device ID is also used by account features. Analytics event records do not contain an account identity, but the same device ID can be associated with an account when account features use it; the identifier is therefore linkable across those service records. Analytics ingestion does not create or update account-device records.

The local analytics log is limited to 300 events. Turning analytics off and saving clears that log and the in-memory analytics session log. Analytics-off does not remove the device ID because account features also use it. The server's analytics privacy epoch purges historical pre-consent analytics during migration; the wire consent protocol version separately rejects telemetry from clients that do not participate in the current protocol. Analytics events on the server are retained for 90 days from server receipt and are then pruned during normal storage initialization, event writes, or analytics reads. Account records are not part of this analytics retention rule.

To change the choice, open Settings, change **Usage Analytics / 使用情况统计**, and save. Turning it off clears local analytics logs and stops optional analytics; account sign-in and AI parsing continue to make their required network requests.

Because analytics is opt-in, installation and usage metrics describe only devices that chose to send analytics. They do not represent the total number of installs or all extension use. The extension does not backfill events from before consent.

## Account service

Registration, verification, and sign-in use the configured account service independently of the analytics choice. Registration and verification send an email address, password or verification code, and device ID. The default account service uses HTTPS. Remote custom endpoints should use HTTPS. The service stores the email address, a salted password hash, a hashed authentication token, and account/device associations. Sign-out clears the extension's locally stored credentials and calls the auth service logout endpoint, which validates the bearer session and revokes the stored token server-side; the local sign-out completes even if the service is unreachable. Server-issued auth sessions expire after a server-defined period, and the server authoritatively validates and revokes them. Analytics event records are not associated with the account token or account ID, though the shared device ID can link analytics and account/device records as described above.

Turning analytics off does not disable account requests or delete an account. This release does not add account deletion or a general account retention period; account data follows the existing account-service lifecycle.

## Temporary popup registration progress

The browser extension's action popup is destroyed when it loses focus (for example, when a user switches to a mail inbox to read a verification code). To resume this flow, the popup may keep **only** the entered email address, the fact that the account backend successfully accepted a code-send request for that exact address, the backend URL, and the code-expiry/resend deadlines in `chrome.storage.session`. This is extension session memory, separate from `chrome.storage.local`, account auth credentials, and optional analytics.

- Passwords, verification-code digits, and authentication tokens are **never** written to this registration draft. Users must reenter passwords and code digits after a popup is recreated.
- The draft is only a convenience hint; it **does not grant authenticated access**. The backend remains authoritative for code validity, registration, and login.
- The restored code-input step expires at the server-provided code deadline and is discarded if the email or backend changes. Stale draft data older than 30 minutes is not restored.
- A successful sign-in/registration, explicit logout, or clearing the email removes the draft through the normal workflow. The 30-minute rule is a **logical restoration TTL, not a guaranteed physical deletion timer**: an untouched session-storage record can remain in extension session memory until a subsequent cleanup or browser session termination.
- If session storage is unavailable, the extension reports that registration progress cannot be saved; users can instead keep the registration UI open in a separate extension tab.

## AI providers

When you parse a question, the question text and, when needed, images may be sent to the AI provider and endpoint selected in Settings. The provider API key is used for those provider requests. Provider requests are separate from analytics and are not sent to the extension's analytics backend. The provider's own privacy and data policies apply to that traffic.
