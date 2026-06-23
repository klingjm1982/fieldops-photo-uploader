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
    const reminderGroups = Array.isArray(payload.reminderGroups)
      ? payload.reminderGroups
      : groupRemindersByRecipient_(reminders);
    const sent = [];
    const skipped = [];

    reminderGroups.forEach((group) => {
      const to = String(group.to || "").trim();
      const properties = Array.isArray(group.properties) ? group.properties : [];
      const cleanProperties = properties.filter((property) => String(property.address || "").trim());
      if (!to || cleanProperties.length === 0) {
        skipped.push({ to: to, subCompany: group.subCompany || "", reason: "Missing email or addresses." });
        return;
      }

      const subject = `FIELD OPS photo reminder - ${cleanProperties.length} location(s)`;
      const body = buildReminderBody_(Object.assign({}, group, { properties: cleanProperties }));

      GmailApp.sendEmail(to, subject, body, {
        name: "FIELD OPS",
      });

      sent.push({
        to: to,
        subCompany: String(group.subCompany || "").trim(),
        locations: cleanProperties.length,
      });
    });

    return json_({ ok: true, sent: sent.length, skipped: skipped.length, sentRows: sent, skippedRows: skipped });
  } catch (error) {
    return json_({ ok: false, message: String(error && error.message ? error.message : error) }, 500);
  }
}

function buildReminderBody_(group) {
  const properties = Array.isArray(group.properties) ? group.properties : [];
  const uploadLink = FIELDOPS_UPLOAD_LINK;
  const propertyLines = [];

  properties.forEach((property, index) => {
    const workOrder = String(property.workOrderNumber || "").trim();
    const address = String(property.address || "").trim();
    const expected = Number(property.expectedServices || 0);
    const completed = Number(property.completedServices || 0);
    const missing = Number(property.missingServices || 0);
    const status = String(property.status || "").trim();

    propertyLines.push(`${index + 1}. ${workOrder ? `WO# ${workOrder} - ` : ""}${address}`);
    if (status) propertyLines.push(`   Status: ${status}`);
    if (expected) propertyLines.push(`   Expected services this month: ${expected}`);
    propertyLines.push(`   Completed photo submissions: ${completed}`);
    if (missing) propertyLines.push(`   Missing services/photos: ${missing}`);
    propertyLines.push("");
  });

  return [
    "Good Morning,",
    "",
    "Our records show photos have not been fully submitted for the locations below.",
    "",
    propertyLines.join("\n").trim(),
    "",
    "As a reminder, the link below is the only way photos are to be submitted (no photos = no payment, this is Take 5's rule not ours). All photos are expected within 48 hours of service.",
    "",
    `FIELD OPS Photo Upload: ${uploadLink}`,
    "",
    "Thank you.",
    "FIELD OPS",
  ].filter((line) => line !== "").join("\n");
}

function groupRemindersByRecipient_(reminders) {
  const grouped = {};

  reminders.forEach((reminder) => {
    const to = String(reminder.to || "").trim();
    const subCompany = String(reminder.subCompany || "Subcontractor").trim();
    const address = String(reminder.address || "").trim();
    if (!to || !address) return;

    const key = `${to.toLowerCase()}::${subCompany.toLowerCase()}`;
    if (!grouped[key]) {
      grouped[key] = {
        to: to,
        subCompany: subCompany,
        month: String(reminder.month || "").trim(),
        properties: [],
      };
    }
    grouped[key].properties.push(reminder);
  });

  return Object.keys(grouped).map((key) => grouped[key]);
}

function json_(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ statusCode: statusCode || 200 }, data)))
    .setMimeType(ContentService.MimeType.JSON);
}
