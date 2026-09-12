import { NextResponse } from "next/server";
import {
  getServiceChannelWorkOrder,
  serviceChannelRuntimeInfo,
} from "@/app/lib/serviceChannelClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeWorkOrderSummary(workOrder: Record<string, unknown>) {
  const pick = (names: string[]) => {
    for (const name of names) {
      if (workOrder[name] !== undefined && workOrder[name] !== null) return workOrder[name];
    }
    return null;
  };

  return {
    id: pick(["Id", "id"]),
    trackingNumber: pick(["TrackingNumber", "trackingNumber"]),
    locationId: pick(["LocationId", "locationId"]),
    providerId: pick(["ProviderId", "providerId"]),
    subscriberId: pick(["SubscriberId", "subscriberId"]),
    status: pick(["Status", "status", "StatusId", "statusId"]),
  };
}

export async function GET(req: Request) {
  const runtimeInfo = serviceChannelRuntimeInfo();
  const url = new URL(req.url);
  const workOrderId = url.searchParams.get("workOrderId")?.trim();

  if (!workOrderId) {
    return NextResponse.json({
      ok: true,
      mode: "read-only",
      ...runtimeInfo,
      message:
        "ServiceChannel sandbox adapter is installed. Add ?workOrderId=... after sandbox credentials are configured to validate one work order.",
    });
  }

  if (!runtimeInfo.credentialsConfigured) {
    return NextResponse.json(
      {
        ok: false,
        mode: "read-only",
        ...runtimeInfo,
        message: "ServiceChannel credentials are not configured yet.",
      },
      { status: 503 }
    );
  }

  try {
    const workOrder = await getServiceChannelWorkOrder(workOrderId);
    return NextResponse.json({
      ok: true,
      mode: "read-only",
      ...runtimeInfo,
      requestedWorkOrderId: workOrderId,
      workOrder: safeWorkOrderSummary(workOrder),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "read-only",
        ...runtimeInfo,
        requestedWorkOrderId: workOrderId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
