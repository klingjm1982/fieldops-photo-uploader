/**
 * FIELD OPS Corrigo Gmail Router
 *
 * Install this in the dedicated Gmail account that receives Corrigo emails.
 * Add a time-driven trigger for routeCorrigoWorkOrderEmails every 5-15 minutes.
 */

const FIELDOPS_CORRIGO_SYNC_URL = "https://fieldops-photo-uploader.vercel.app/api/corrigo-sync";
const FIELDOPS_SECRET = ""; // Optional: match CORRIGO_GMAIL_SECRET in Vercel if you set one.
const PROCESSED_LABEL = "FIELDOPS/Corrigo Routed";
const SEARCH_QUERY =
  'subject:"The new Scheduled work order #" "received from Driven Brands" newer_than:45d';

function routeCorrigoWorkOrderEmails() {
  const processedLabel = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(SEARCH_QUERY, 0, 25);

  threads.forEach((thread) => {
    if (threadHasLabel_(thread, PROCESSED_LABEL)) return;

    const messages = thread.getMessages();
    let routedOne = false;

    messages.forEach((message) => {
      const subject = message.getSubject();
      const body = message.getPlainBody();

      if (!isDrivenBrandsLandscapeWorkOrder_(subject, body)) return;

      const result = postToFieldOps_(subject, body);
      if (result.ok || result.status === 422) {
        routedOne = true;
      }
    });

    if (routedOne) {
      processedLabel.addToThread(thread);
    }
  });
}

function isDrivenBrandsLandscapeWorkOrder_(subject, body) {
  return (
    /^The new Scheduled work order #\d+ received from Driven Brands$/i.test(subject || "") &&
    /Site Address/i.test(body || "") &&
    /(^|\n)\s*Problem\s*(\n|:)\s*Landscape\s*(\n|$)/i.test(body || "")
  );
}

function postToFieldOps_(subject, body) {
  const payload = {
    action: "parseEmailBatch",
    emails: [{ subject: subject, emailBody: body }],
  };

  const headers = {};
  if (FIELDOPS_SECRET) headers["x-fieldops-secret"] = FIELDOPS_SECRET;

  const response = UrlFetchApp.fetch(FIELDOPS_CORRIGO_SYNC_URL, {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  let parsed = {};
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (error) {
    parsed = { ok: false, message: response.getContentText() };
  }

  return Object.assign({ status: status }, parsed);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function threadHasLabel_(thread, name) {
  return thread.getLabels().some((label) => label.getName() === name);
}
