import { NextResponse } from "next/server";
import { refreshMonthlyServiceReport } from "@/app/lib/monthlyServiceReport";

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
