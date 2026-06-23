import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReminderRow = {
  to?: string;
  subCompany?: string;
  address?: string;
  workOrderNumber?: string;
  month?: string;
  expectedServices?: number;
  completedServices?: number;
  missingServices?: number;
  status?: string;
};

type CleanReminder = Required<ReminderRow>;

type ReminderGroupInput = {
  to?: string;
  subCompany?: string;
  month?: string;
  properties?: ReminderRow[];
};

type CleanReminderGroup = {
  to: string;
  subCompany: string;
  month: string;
  properties: CleanReminder[];
  totalExpectedServices: number;
  totalCompletedServices: number;
  totalMissingServices: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cleanReminder(row: ReminderRow) {
  return {
    to: String(row.to ?? "").trim(),
    subCompany: String(row.subCompany ?? "").trim(),
    address: String(row.address ?? "").trim(),
    workOrderNumber: String(row.workOrderNumber ?? "").trim(),
    month: String(row.month ?? "").trim(),
    expectedServices: Number(row.expectedServices) || 0,
    completedServices: Number(row.completedServices) || 0,
    missingServices: Number(row.missingServices) || 0,
    status: String(row.status ?? "").trim(),
  };
}

function groupReminderRows(rows: CleanReminder[]) {
  const groups = new Map<string, CleanReminderGroup>();

  for (const row of rows) {
    if (!row.to || !row.address) continue;
    const subCompany = row.subCompany || "Subcontractor";
    const key = [row.to.toLowerCase(), subCompany.toLowerCase()].join("::");
    const current =
      groups.get(key) ??
      {
        to: row.to,
        subCompany,
        month: row.month,
        properties: [],
        totalExpectedServices: 0,
        totalCompletedServices: 0,
        totalMissingServices: 0,
      };

    current.properties.push(row);
    current.totalExpectedServices += row.expectedServices;
    current.totalCompletedServices += row.completedServices;
    current.totalMissingServices += row.missingServices;
    groups.set(key, current);
  }

  return Array.from(groups.values());
}

function cleanReminderGroup(group: ReminderGroupInput): CleanReminderGroup | undefined {
  const properties = Array.isArray(group.properties)
    ? group.properties.map((property) =>
        cleanReminder({
          ...property,
          to: property.to || group.to,
          subCompany: property.subCompany || group.subCompany,
          month: property.month || group.month,
        })
      )
    : [];

  return groupReminderRows(properties)[0];
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rows: CleanReminder[] = Array.isArray(body?.reminders) ? body.reminders.map(cleanReminder) : [];
    const groupsFromRows = groupReminderRows(rows);
    const rawGroups: ReminderGroupInput[] = Array.isArray(body?.reminderGroups) ? body.reminderGroups : [];
    const groupsFromPayload: CleanReminderGroup[] = rawGroups
      .map(cleanReminderGroup)
      .filter((group): group is CleanReminderGroup => Boolean(group));
    const reminderGroups = (groupsFromPayload.length > 0 ? groupsFromPayload : groupsFromRows).filter(
      (group) => group.to && group.properties.length > 0
    );

    if (reminderGroups.length === 0) {
      return NextResponse.json({ message: "No reminders with email and address were selected." }, { status: 400 });
    }

    const payload = {
      secret: process.env.PHOTO_REMINDER_SECRET || "",
      sentBy: "FIELD OPS",
      uploadLink: "https://fieldops-photo-uploader.vercel.app/",
      reminderGroups,
    };

    const scriptUrl = process.env.PHOTO_REMINDER_SCRIPT_URL;
    if (!scriptUrl) {
      return NextResponse.json(
        {
          ok: false,
          configured: false,
          message: "PHOTO_REMINDER_SCRIPT_URL is not configured yet.",
          payload,
        },
        { status: 501 }
      );
    }

    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let result: unknown = text;
    try {
      result = JSON.parse(text);
    } catch {
      // Apps Script sometimes returns text; keep it visible for debugging.
    }

    return NextResponse.json({
      ok: response.ok,
      configured: true,
      status: response.status,
      result,
    }, { status: response.ok ? 200 : 502 });
  } catch (error: unknown) {
    console.error("Photo reminder error:", error);
    return NextResponse.json(
      { error: "Photo reminder error", message: errorMessage(error) },
      { status: 500 }
    );
  }
}
