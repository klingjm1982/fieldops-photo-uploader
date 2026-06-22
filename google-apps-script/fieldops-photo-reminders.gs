/**
 * FIELD OPS Photo Reminder Sender
 *
 * Install this in the FIELD OPS Gmail / Google Workspace account that should
 * send reminders. Deploy as a Web App with access limited to you/your domain
 * when possible, then set PHOTO_REMINDER_SCRIPT_URL in Vercel to the Web App URL.
 */

const FIELDOPS_REMINDER_SECRET = ""; // Optional: match PHOTO_REMINDER_SECRET in Vercel.
const FIELDOPS_UPLOAD_LINK = "https://fieldops-photo-uploader.vercel.app/";

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");

    if (FIELDOPS_REMINDER_SECRET && payload.secret !== FIELDOPS_REMINDER_SECRET) {
      return json_({ ok: false, message: "Invalid reminder secret." }, 401);
    }

    const reminders = Array.isArray(payload.reminders) ? payload.reminders : [];
    const sent = [];
    const skipped = [];

    reminders.forEach((reminder) => {
      const to = String(reminder.to || "").trim();
      const address = String(reminder.address || "").trim();
      if (!to || !address) {
        skipped.push({ to: to, address: address, reason: "Missing email or address." });
        return;
      }

      const workOrder = String(reminder.workOrderNumber || "").trim();
      const subject = `FIELD OPS photo reminder${workOrder ? ` - WO# ${workOrder}` : ""}`;
      const body = buildReminderBody_(reminder);

      GmailApp.sendEmail(to, subject, body, {
        name: "FIELD OPS",
      });

      sent.push({ to: to, address: address, workOrderNumber: workOrder });
    });

    return json_({ ok: true, sent: sent.length, skipped: skipped.length, sentRows: sent, skippedRows: skipped });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) }, 500);
  }
}

function buildReminderBody_(reminder) {
  const workOrder = String(reminder.workOrderNumber || "").trim();
  const address = String(reminder.address || "").trim();
  const expected = Number(reminder.expectedServices || 0);
  const completed = Number(reminder.completedServices || 0);
  const missing = Number(reminder.missingServices || 0);
  const uploadLink = FIELDOPS_UPLOAD_LINK;

  return [
    "Good Morning,",
    "",
    "Our records show photos have not been fully submitted for the service below.",
    "",
    workOrder ? `Work Order: ${workOrder}` : "",
    `Address: ${address}`,
    expected ? `Expected services this month: ${expected}` : "",
    `Completed photo submissions: ${completed}`,
    missing ? `Missing services/photos: ${missing}` : "",
    "",
    "As a reminder, the link below is the only way photos are to be submitted (no photos = no payment, this is Take 5's rule not ours). All photos are expected within 48 hours of service.",
    "",
    `FIELD OPS Photo Upload: ${uploadLink}`,
    "",
    "Thank you.",
    "FIELD OPS",
  ].filter((line) => line !== "").join("\n");
}

function json_(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ statusCode: statusCode || 200 }, data)))
    .setMimeType(ContentService.MimeType.JSON);
}
