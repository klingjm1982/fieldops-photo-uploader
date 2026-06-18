import { NextResponse } from "next/server";
import {
  addCorrigoWorkOrderFromEmail,
  addCorrigoWorkOrder,
  buildCorrigoQueue,
  getCorrigoSyncState,
} from "@/app/lib/corrigoSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || undefined;
    const state = await getCorrigoSyncState(month);
    return NextResponse.json({
      month: state.month,
      workOrders: state.workOrders,
      queue: state.queue,
      uploadGroupCount: state.uploadGroups.length,
      queueCandidateCount: state.queueCandidates.length,
    });
  } catch (error: unknown) {
    console.error("Corrigo sync state error:", error);
    return NextResponse.json(
      { error: "Corrigo sync state error", message: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "addWorkOrder") {
      await addCorrigoWorkOrder({
        month: String(body.month ?? "").trim(),
        siteId: String(body.siteId ?? "").trim(),
        address: String(body.address ?? "").trim(),
        workOrderNumber: String(body.workOrderNumber ?? "").trim(),
        active: body.active !== false,
        notes: String(body.notes ?? "").trim(),
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "buildQueue") {
      const result = await buildCorrigoQueue(String(body.month ?? "").trim() || undefined);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "parseEmail") {
      const result = await addCorrigoWorkOrderFromEmail({
        subject: String(body.subject ?? ""),
        body: String(body.emailBody ?? ""),
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }

    return NextResponse.json({ message: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Corrigo sync action error:", error);
    return NextResponse.json(
      { error: "Corrigo sync action error", message: errorMessage(error) },
      { status: 500 }
    );
  }
}
