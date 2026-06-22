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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rows: CleanReminder[] = Array.isArray(body?.reminders) ? body.reminders.map(cleanReminder) : [];
    const reminders = rows.filter((row) => row.to && row.address);

    if (reminders.length === 0) {
      return NextResponse.json({ message: "No reminders with email and address were selected." }, { status: 400 });
    }

    const payload = {
      secret: process.env.PHOTO_REMINDER_SECRET || "",
      sentBy: "FIELD OPS",
      uploadLink: "https://fieldops-photo-uploader.vercel.app/",
      reminders,
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
