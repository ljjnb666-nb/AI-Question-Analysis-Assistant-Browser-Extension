# Privacy and data flows

This document describes what the extension and its services send and store. It is a technical description of the current implementation.

## Optional usage analytics

Optional usage analytics is **off by default**. It is sent only after you turn it on in Settings and save your choice. The extension stores the current consent version with that choice. A stored on-state from a version that had no visible consent control is not treated as consent: the first load turns analytics off and clears the old analytics log.

When enabled, analytics can send a random device ID, an event name, a timestamp, extension version, elapsed time when relevant, and small event-specific categories such as provider, route, attempt count, and normalized failure category. The analytics server accepts only known event names and allowlisted fields. It does not receive a page hostname, question or answer content, explanations, screenshots or images, block or question identifiers, API keys, account tokens, passwords, verification codes, email addresses, or client-supplied account IDs.

The local analytics log is limited to 300 events. Turning analytics off and saving clears that log and the in-memory analytics session log. Analytics-off does not remove the device ID because account features also use it. Analytics events on the server are retained for 90 days from server receipt and are then pruned during normal storage initialization, event writes, or analytics reads. Account records are not part of this analytics retention rule.

To change the choice, open Settings, change **Usage Analytics / 使用情况统计**, and save. Turning it off stops optional analytics; account sign-in and AI parsing continue to make their required network requests.

Because analytics is opt-in, installation and usage metrics describe only devices that chose to send analytics. They do not represent the total number of installs or all extension use. The extension does not backfill events from before consent.

## Account service

Registration, verification, sign-in, and sign-out use the configured account service independently of the analytics choice. Registration and verification send an email address, password or verification code, and device ID over HTTPS. The service stores the email address, a salted password hash, a hashed authentication token, and account/device associations. Analytics events are not associated with the account token or account ID.

Turning analytics off does not disable account requests or delete an account. This release does not add account deletion or a general account retention period; account data follows the existing account-service lifecycle.

## AI providers

When you parse a question, the question text and, when needed, images may be sent to the AI provider and endpoint selected in Settings. The provider API key is used for those provider requests. Provider requests are separate from analytics and are not sent to the extension's analytics backend. The provider's own privacy and data policies apply to that traffic.
