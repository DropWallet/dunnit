import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

export async function GET(request: NextRequest) {
  try {
    // Derive baseUrl from the request URL instead of relying on env var
    const url = new URL(request.url);
    const baseUrl = process.env.NEXTAUTH_URL || `${url.protocol}//${url.host}`;
    const returnUrl = `${baseUrl}/api/auth/steam/callback`;
    
    // Generate a nonce for security
    const nonce = randomBytes(16).toString('hex');
    
    // Store nonce in a cookie for verification
    const response = NextResponse.redirect(
      `${STEAM_OPENID_URL}?` +
      `openid.ns=http://specs.openid.net/auth/2.0&` +
      `openid.mode=checkid_setup&` +
      `openid.return_to=${encodeURIComponent(returnUrl)}&` +
      `openid.realm=${encodeURIComponent(baseUrl)}&` +
      `openid.identity=http://specs.openid.net/auth/2.0/identifier_select&` +
      `openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select`
    );
    
    // Always use secure in production (Vercel uses HTTPS)
    const isProduction = process.env.VERCEL_ENV === 'production' || 
                         process.env.NODE_ENV === 'production' ||
                         request.url.startsWith('https://');
    
    response.cookies.set('steam_openid_nonce', nonce, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 60 * 5, // 5 minutes
    });
    
    return response;
  } catch (error) {
    console.error('Steam auth error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate Steam authentication' },
      { status: 500 }
    );
  }
}
