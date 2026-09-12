# Corrigo auto-queue sandbox

This branch is intentionally isolated from the production FIELD OPS uploader.

## Goal

Build a set-it-and-forget-it flow that can eventually run each morning without manually moving rows into `CorrigoUploadQueue`.

Target flow:

1. Read an upload row from `UploadsLog`.
2. Use the row's service date to determine the month.
3. Match the upload to the same site on `Site List W/WO's` using `siteId` first, then address as a fallback.
4. Locate the month-specific work-order column by header name, e.g. `September Work Orders` / `September WO`.
5. Resolve the work order for that site.
6. Mark the row as eligible for Corrigo processing only when a valid work order exists.
7. In a later phase, hand the resolved row to the existing Corrigo browser automation.
8. In a later phase, schedule the local runner for 8:00 AM America/Chicago.

## Safety rules during sandbox development

- Do not change `main`.
- Do not write to production Google Sheets from sandbox code.
- Do not launch the real Corrigo upload runner from sandbox code.
- Do not mark production rows complete.
- Prefer dry-run output that shows what *would* be uploaded.
- Match work-order month from the upload/service date, not the day the automation happens to run.
- Match work-order columns by header name instead of hard-coding a column such as `AF`.
- Process only rows with a resolved site, valid service date, valid work order, and photo data.
- Make the final runner idempotent so already-completed rows are not uploaded twice.

## Current sandbox code

`app/lib/corrigoAutoQueueSandbox.ts` is deliberately side-effect free. It accepts an Uploads row and an in-memory copy of `Site List W/WO's`, then returns either:

- `ready: true` with the resolved work order, or
- `ready: false` with a reason explaining why the row should not be processed.

Nothing imports this module yet, so it cannot affect production behavior.

## Next safe milestone

Add a sandbox-only preview endpoint/page that reads test data and displays:

- service date
- site ID/address
- resolved month
- resolved work order
- READY / NOT READY
- reason

The preview should remain read-only until sample rows are verified against known Corrigo work orders.
