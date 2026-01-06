import { NextRequest, NextResponse } from "next/server";
import { getDataAccess } from "@/lib/data/access";
import { ApiErrors } from "@/lib/utils/api-errors";

export const dynamic = 'force-dynamic';

/**
 * POST /api/feed/[sessionId]/like
 * Like a feed session
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId;
    const cookies = request.cookies;
    const userId = cookies.get("steam_id")?.value;

    if (!userId) {
      return ApiErrors.notAuthenticated();
    }

    if (!sessionId) {
      return ApiErrors.badRequest("Session ID is required");
    }

    // Validate sessionId format (should be {userId}-{appId}-{timestamp})
    const sessionIdParts = sessionId.split('-');
    if (sessionIdParts.length < 3) {
      return ApiErrors.badRequest("Invalid session ID format");
    }

    const dataAccess = getDataAccess();

    // Like the session
    await dataAccess.likeSession(sessionId, userId);

    // Get updated like count
    const likeCounts = await dataAccess.getLikeCounts([sessionId]);
    const likeCount = likeCounts.get(sessionId) || 0;

    // Get updated liked by users (first 3)
    const likedByUsers = await dataAccess.getLikedByUsers(sessionId, 3);

    return NextResponse.json({
      success: true,
      liked: true,
      likeCount,
      likedByUsers,
    });
  } catch (error) {
    console.error("Error liking session:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to like session", errorMessage);
  }
}

/**
 * DELETE /api/feed/[sessionId]/like
 * Unlike a feed session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sessionId = params.sessionId;
    const cookies = request.cookies;
    const userId = cookies.get("steam_id")?.value;

    if (!userId) {
      return ApiErrors.notAuthenticated();
    }

    if (!sessionId) {
      return ApiErrors.badRequest("Session ID is required");
    }

    // Validate sessionId format
    const sessionIdParts = sessionId.split('-');
    if (sessionIdParts.length < 3) {
      return ApiErrors.badRequest("Invalid session ID format");
    }

    const dataAccess = getDataAccess();

    // Unlike the session
    await dataAccess.unlikeSession(sessionId, userId);

    // Get updated like count
    const likeCounts = await dataAccess.getLikeCounts([sessionId]);
    const likeCount = likeCounts.get(sessionId) || 0;

    // Get updated liked by users (first 3)
    const likedByUsers = await dataAccess.getLikedByUsers(sessionId, 3);

    return NextResponse.json({
      success: true,
      liked: false,
      likeCount,
      likedByUsers,
    });
  } catch (error) {
    console.error("Error unliking session:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to unlike session", errorMessage);
  }
}
