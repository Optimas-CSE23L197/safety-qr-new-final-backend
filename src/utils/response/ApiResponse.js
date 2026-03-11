// =============================================================================
// ApiResponse.js — RESQID
// Standardized success response — every successful API response looks identical
// Never send raw res.json({}) — always use ApiResponse
// =============================================================================

export class ApiResponse {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {*}      [data]
   * @param {object} [meta]      - pagination, counts, extra context
   */

  constructor(statusCode, message, data = null, meta = null) {
    this.success = true;
    this.statusCode = statusCode;
    this.message = message;
    if (data !== null) this.data = data;
    if (meta !== null) this.meta = meta;
  }

  // ─── Static Factories ──────────────────────────────────────────────────────

  static ok(data = null, message = "Success") {
    return new ApiResponse(200, message, data);
  }

  static created(data = null, message = "Created successfully") {
    return new ApiResponse(201, message, data);
  }

  static accepted(data = null, message = "Request accepted") {
    return new ApiResponse(202, message, data);
  }

  static noContent(message = "Deleted successfully") {
    // 204 has no body — use 200 with no data for consistency
    return new ApiResponse(200, message, null);
  }

  static paginated(data, paginationMeta, message = "Success") {
    return new ApiResponse(200, message, data, paginationMeta);
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  /**
   * send(res)
   * Usage: return ApiResponse.ok(user).send(res)
   */
  send(res) {
    return res.status(this.statusCode).json(this.toJSON());
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      ...(this.data !== undefined && { data: this.data }),
      ...(this.meta !== undefined && { meta: this.meta }),
    };
  }
}
