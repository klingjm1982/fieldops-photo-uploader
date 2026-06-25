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
    const force = searchParams.get("refresh") === "1" || searchParams.get("force") === "1";
    const writeSheets = searchParams.get("writeSheets") === "1";
    const report = await refreshMonthlyServiceReport(month, { force, writeSheets });
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

    if (action === "refreshSheets") {
      const report = await refreshMonthlyServiceReport(String(body.month ?? "").trim() || undefined, {
        force: true,
        writeSheets: true,
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
