import { NextResponse } from 'next/server';

/**
 * Standard error codes for API responses
 */
export enum ApiErrorCode {
  // Authentication errors (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  NOT_AUTHENTICATED = 'NOT_AUTHENTICATED',
  
  // Authorization errors (403)
  FORBIDDEN = 'FORBIDDEN',
  ACCESS_DENIED = 'ACCESS_DENIED',
  
  // Client errors (400)
  BAD_REQUEST = 'BAD_REQUEST',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  MISSING_PARAMETER = 'MISSING_PARAMETER',
  
  // Not found errors (404)
  NOT_FOUND = 'NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  
  // Server errors (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  STEAM_API_ERROR = 'STEAM_API_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

/**
 * Standard API error response structure
 */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: string;
  };
}

/**
 * Creates a standardized error response
 * 
 * @param code - Error code from ApiErrorCode enum
 * @param message - Human-readable error message
 * @param details - Optional additional details about the error
 * @param status - HTTP status code (defaults based on error code)
 * @returns NextResponse with standardized error format
 */
export function createErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: string,
  status?: number
): NextResponse<ApiErrorResponse> {
  // Determine status code based on error code if not provided
  let statusCode = status;
  if (!statusCode) {
    switch (code) {
      case ApiErrorCode.NOT_AUTHENTICATED:
      case ApiErrorCode.UNAUTHORIZED:
        statusCode = 401;
        break;
      case ApiErrorCode.FORBIDDEN:
      case ApiErrorCode.ACCESS_DENIED:
        statusCode = 403;
        break;
      case ApiErrorCode.BAD_REQUEST:
      case ApiErrorCode.INVALID_PARAMETER:
      case ApiErrorCode.MISSING_PARAMETER:
        statusCode = 400;
        break;
      case ApiErrorCode.NOT_FOUND:
      case ApiErrorCode.USER_NOT_FOUND:
      case ApiErrorCode.RESOURCE_NOT_FOUND:
        statusCode = 404;
        break;
      default:
        statusCode = 500;
    }
  }

  const errorResponse: ApiErrorResponse = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };

  return NextResponse.json(errorResponse, { status: statusCode });
}

/**
 * Helper functions for common error responses
 */
export const ApiErrors = {
  notAuthenticated: (details?: string) =>
    createErrorResponse(
      ApiErrorCode.NOT_AUTHENTICATED,
      'Authentication required',
      details
    ),

  unauthorized: (details?: string) =>
    createErrorResponse(
      ApiErrorCode.UNAUTHORIZED,
      'Unauthorized access',
      details
    ),

  forbidden: (message: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.FORBIDDEN,
      message,
      details
    ),

  badRequest: (message: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.BAD_REQUEST,
      message,
      details
    ),

  missingParameter: (parameter: string) =>
    createErrorResponse(
      ApiErrorCode.MISSING_PARAMETER,
      `Missing required parameter: ${parameter}`,
      `The '${parameter}' parameter is required but was not provided`
    ),

  invalidParameter: (parameter: string, reason?: string) =>
    createErrorResponse(
      ApiErrorCode.INVALID_PARAMETER,
      `Invalid parameter: ${parameter}`,
      reason || `The '${parameter}' parameter has an invalid value`
    ),

  notFound: (resource: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.NOT_FOUND,
      `${resource} not found`,
      details
    ),

  userNotFound: (steamId?: string) =>
    createErrorResponse(
      ApiErrorCode.USER_NOT_FOUND,
      'User not found',
      steamId ? `No user found with Steam ID: ${steamId}` : undefined
    ),

  internalError: (message: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.INTERNAL_ERROR,
      message,
      details
    ),

  steamApiError: (message: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.STEAM_API_ERROR,
      message,
      details
    ),

  databaseError: (message: string, details?: string) =>
    createErrorResponse(
      ApiErrorCode.DATABASE_ERROR,
      message,
      details
    ),
};
