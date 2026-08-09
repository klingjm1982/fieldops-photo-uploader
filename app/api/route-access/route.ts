import { NextResponse } from "next/server";
import { ROUTE_ACCESS_COOKIE, verifyRouteAccessToken } from "@/app/lib/routeAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token") ?? "";
  const destination = new URL("/crew-route", requestUrl.origin);

  try {
    const payload = verifyRouteAccessToken(token);
    const response = NextResponse.redirect(destination);
    response.cookies.set(ROUTE_ACCESS_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/crew-route",
      maxAge: Math.max(1, payload.expiresAt - Math.floor(Date.now() / 1000)),
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error: unknown) {
    destination.searchParams.set(
      "error",
      error instanceof Error ? error.message : "This route link is not valid."
    );
    const response = NextResponse.redirect(destination);
    response.cookies.delete(ROUTE_ACCESS_COOKIE);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
