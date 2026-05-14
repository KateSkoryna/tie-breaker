# Security Specification - Tiebreaker AI

## 1. Data Invariants
- A Decision History item must have a valid `userId` that matches the authenticated user ID.
- A User Profile must be tied to the authenticated user ID.
- Decision timestamps must be set by the server or validated as recent.
- All strings must have reasonable size limits to prevent abuse.

## 2. The "Dirty Dozen" Payloads (Target: Denied)
1. Creating a User Profile for a different UID (`userId != auth.uid`).
2. Reading another user's profile.
3. Deleting another user's profile.
4. Creating a Decision record with a massive string (e.g., 2MB) in the `decision` field.
5. Creating a Decision record for a different user's history collection.
6. Updating the `createdAt` field of a Decision record after it's been created.
7. Using a non-alphanumeric ID for a user or decision (ID Poisoning).
8. Reading the list of all users' history.
9. Modifying the `userId` field of an existing Decision.
10. Creating a record without being authenticated.
11. Injecting a "Ghost Field" (e.g., `isAdmin: true`) into a User Profile.
12. Setting a future timestamp in the `timestamp` or `createdAt` fields.

## 3. The Test Runner Plan
- Verify `isOwner()` helper works correctly.
- Verify `isValidUser()` and `isValidDecision()` helpers enforce schema and size limits.
- Verify `affectedKeys().hasOnly()` blocks unauthorized field updates.
