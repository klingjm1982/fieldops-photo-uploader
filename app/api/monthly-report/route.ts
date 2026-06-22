import { NextResponse } from "next/server";
import {
  refreshMonthlyServiceReport,
  setMonthlyExpectedServices,
} from "@/app/lib/monthlyServiceReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || undefined;
    const report = await refreshMonthlyServiceReport(month);
    return NextResponse.json(report);
  } catch (e: unknown) {
    console.error("Monthly report error:", e);
    return NextResponse.json(
      { error: "Monthly report error", message: errorMessage(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "setMonthlyExpectedServices") {
      const report = await setMonthlyExpectedServices({
        month: String(body.month ?? ""),
        siteId: String(body.siteId ?? "all"),
        expectedServices: Number(body.expectedServices),
        notes: String(body.notes ?? ""),
      });
      return NextResponse.json({ ok: true, ...report });
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    console.error("Monthly report action error:", e);
    return NextResponse.json(
      { error: "Monthly report action error", message: errorMessage(e) },
      { status: 500 }
    );
  }
}
