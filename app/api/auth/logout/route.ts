import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  
  // Clear the session cookie
  response.cookies.delete('steam_id');
  
  return response;
}
