# @vellar/lifecycle-service

Account inspection, blocker detection, cleanup planning, merge validation

## Architecture

lifecycle-service is a **stateless service** that does not maintain its own database. It reads account state directly from the Stellar Horizon API to perform account inspections and validation. As a result, this service has never required database migrations.

## Issue #353 Investigation

During cleanup of issue #353, lifecycle-service was audited for unused migration scripts. Investigation confirmed that:
- No migration scripts have ever existed in this service
- No drizzle schema directory is present
- The service operates statelessly against the Horizon API
- No database cleanup was needed

This service's stateless design means it will never require migration management.
