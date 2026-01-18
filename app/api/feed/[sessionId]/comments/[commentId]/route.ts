import { NextRequest, NextResponse } from "next/server";
import { getDataAccess } from "@/lib/data/access";
import { ApiErrors } from "@/lib/utils/api-errors";

export const dynamic = 'force-dynamic';

/**
 * PUT /api/feed/[sessionId]/comments/[commentId]
 * Update a comment
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { sessionId: string; commentId: string } }
) {
  try {
    const { sessionId, commentId } = params;
    const cookies = request.cookies;
    const userId = cookies.get("steam_id")?.value;

    if (!userId) {
      return ApiErrors.notAuthenticated();
    }

    if (!sessionId) {
      return ApiErrors.badRequest("Session ID is required");
    }

    if (!commentId) {
      return ApiErrors.badRequest("Comment ID is required");
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

    // Validate content length (max 500 characters)
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return ApiErrors.badRequest("Content cannot be empty");
    }
    if (trimmedContent.length > 500) {
      return ApiErrors.badRequest("Content cannot exceed 500 characters");
    }

    const dataAccess = getDataAccess();

    try {
      // Update comment (includes ownership check)
      const comment = await dataAccess.updateComment(commentId, userId, trimmedContent);

      return NextResponse.json({
        success: true,
        comment,
      });
    } catch (error) {
      // Handle ownership/permission errors
      if (error instanceof Error) {
        if (error.message === 'Comment not found') {
          return ApiErrors.notFound("Comment", "The comment you're trying to edit doesn't exist");
        }
        if (error.message === 'Not authorized to edit this comment') {
          return ApiErrors.forbidden("You can only edit your own comments");
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("Error updating comment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to update comment", errorMessage);
  }
}

/**
 * DELETE /api/feed/[sessionId]/comments/[commentId]
 * Delete a comment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { sessionId: string; commentId: string } }
) {
  try {
    const { sessionId, commentId } = params;
    const cookies = request.cookies;
    const userId = cookies.get("steam_id")?.value;

    if (!userId) {
      return ApiErrors.notAuthenticated();
    }

    if (!sessionId) {
      return ApiErrors.badRequest("Session ID is required");
    }

    if (!commentId) {
      return ApiErrors.badRequest("Comment ID is required");
    }

    // Validate sessionId format
    const sessionIdParts = sessionId.split('-');
    if (sessionIdParts.length < 3) {
      return ApiErrors.badRequest("Invalid session ID format");
    }

    const dataAccess = getDataAccess();

    try {
      // Delete comment (includes ownership check)
      await dataAccess.deleteComment(commentId, userId);

      return NextResponse.json({
        success: true,
      });
    } catch (error) {
      // Handle ownership/permission errors
      if (error instanceof Error) {
        if (error.message === 'Comment not found') {
          return ApiErrors.notFound("Comment", "The comment you're trying to delete doesn't exist");
        }
        if (error.message === 'Not authorized to delete this comment') {
          return ApiErrors.forbidden("You can only delete your own comments");
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("Error deleting comment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return ApiErrors.internalError("Failed to delete comment", errorMessage);
  }
}
