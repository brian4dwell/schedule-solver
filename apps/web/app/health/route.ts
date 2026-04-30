import { NextResponse } from "next/server";

export function GET() {
  const response = NextResponse.json({ status: "ok" });
  return response;
}
