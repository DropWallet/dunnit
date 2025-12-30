import { NextRequest, NextResponse } from 'next/server';
import { getSteamClient } from '@/lib/steam/client';
import { getDataAccess } from '@/lib/data/access';
import { getCountryName } from '@/lib/utils/country';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get('openid.mode');
    
    if (mode !== 'id_res') {
      return NextResponse.redirect(new URL('/?error=invalid_mode', request.url));
    }

    const claimedId = url.searchParams.get('openid.claimed_id');
    const identity = url.searchParams.get('openid.identity');
    const returnTo = url.searchParams.get('openid.return_to');
    const responseNonce = url.searchParams.get('openid.response_nonce');
    const assocHandle = url.searchParams.get('openid.assoc_handle');
    const signed = url.searchParams.get('openid.signed');
    const signature = url.searchParams.get('openid.sig');

    if (!claimedId || !identity) {
      return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
    }

    // Verify the authentication with Steam
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const verifyParams = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'check_authentication',
      'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': claimedId,
      'openid.identity': identity,
      'openid.return_to': returnTo || '',
      'openid.response_nonce': responseNonce || '',
      'openid.assoc_handle': assocHandle || '',
      'openid.signed': signed || '',
      'openid.sig': signature || '',
    });

    const verifyResponse = await fetch('https://steamcommunity.com/openid/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: verifyParams.toString(),
    });

    const verifyText = await verifyResponse.text();
    const isValid = verifyText.includes('is_valid:true');

    if (!isValid) {
      return NextResponse.redirect(new URL('/?error=invalid_signature', request.url));
    }

    // Extract Steam ID from the identity URL
    // Format: https://steamcommunity.com/openid/id/76561198000000000
    const steamId = identity.split('/').pop() || '';

    if (!steamId || !/^\d+$/.test(steamId)) {
      return NextResponse.redirect(new URL('/?error=no_steam_id', request.url));
    }

    // Fetch user data from Steam API
    const steamClient = getSteamClient();
    const playerSummary = await steamClient.getPlayerSummary(steamId);

    if (!playerSummary) {
      return NextResponse.redirect(new URL('/?error=no_profile', request.url));
    }

    // Save user to data store
    const dataAccess = getDataAccess();
    
    // Get country name from country code
    const countryName = playerSummary.loccountrycode
      ? getCountryName(playerSummary.loccountrycode)
      : undefined;
    
    // Convert timecreated (Unix timestamp) to Date if available
    const joinDate = playerSummary.timecreated
      ? new Date(playerSummary.timecreated * 1000)
      : undefined;
    
    await dataAccess.saveUser({
      steamId,
      username: playerSummary.personaname,
      avatarUrl: playerSummary.avatarfull,
      profileUrl: playerSummary.profileurl,
      countryCode: playerSummary.loccountrycode,
      countryName,
      joinDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Verify user was saved
    const savedUser = await dataAccess.getUser(steamId);
    console.log('User saved:', savedUser ? 'Yes' : 'No', steamId);

    // Create session (using cookies for now - can upgrade to proper session management later)
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    
    // Set session cookie with Steam ID
    response.cookies.set('steam_id', steamId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    console.log('Cookie set for steam_id:', steamId);
    return response;
  } catch (error) {
    console.error('Steam callback error:', error);
    return NextResponse.redirect(new URL('/?error=callback_failed', request.url));
  }
}
