import { NextRequest, NextResponse } from "next/server";
import { getDataAccess } from "@/lib/data/access";
import { ApiErrors } from "@/lib/utils/api-errors";

export const dynamic = 'force-dynamic';

/**
 * GET /api/feed/[sessionId]/comments
 * Get comments for a feed session
 */
export async function GET(
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

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Validate limit and offset
    if (limit < 1 || limit > 100) {
      return ApiErrors.badRequest("Limit must be between 1 and 100");
    }
    if (offset < 0) {
      return ApiErrors.badRequest("Offset must be >= 0");
    }

    const dataAccess = getDataAccess();

    // Get comments
    const result = await dataAccess.getComments(sessionId, limit, offset);

    return NextResponse.json({
      comments: result.comments,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.comments.length < result.total,
      },
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to fetch comments", errorMessage);
  }
}

/**
 * POST /api/feed/[sessionId]/comments
 * Create a comment on a feed session
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

    // Validate sessionId format
    const sessionIdParts = sessionId.split('-');
    if (sessionIdParts.length < 3) {
      return ApiErrors.badRequest("Invalid session ID format");
    }

    // Parse request body
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string') {
      return ApiErrors.badRequest("Content is required and must be a string");
    }

    // Validate content length (max 1000 characters)
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return ApiErrors.badRequest("Content cannot be empty");
    }
    if (trimmedContent.length > 1000) {
      return ApiErrors.badRequest("Content cannot exceed 1000 characters");
    }

    const dataAccess = getDataAccess();

    // Create comment
    const comment = await dataAccess.createComment(sessionId, userId, trimmedContent);

    return NextResponse.json({
      success: true,
      comment,
    });
  } catch (error) {
    console.error("Error creating comment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to create comment", errorMessage);
  }
}
