// =============================================================================
// ApiResponse.js — RESQID (FIXED)
// =============================================================================

export class ApiResponse {
  constructor(statusCode, message, data = null, meta = null) {
    this.success = true;
    this.statusCode = statusCode;
    this.message = message;
    if (data !== null) this.data = data;
    if (meta !== null) this.meta = meta;
  }

  // Static factories — send response directly
  static ok(res, data = null, message = 'Success') {
    return new ApiResponse(200, message, data).send(res);
  }

  static created(res, data = null, message = 'Created successfully') {
    return new ApiResponse(201, message, data).send(res);
  }

  static accepted(res, data = null, message = 'Accepted') {
    return new ApiResponse(202, message, data).send(res);
  }

  static noContent(res, message = 'Deleted successfully') {
    return new ApiResponse(200, message, null).send(res);
  }

  static paginated(res, data, meta, message = 'Success') {
    return new ApiResponse(200, message, data, meta).send(res);
  }

  // Send method
  send(res) {
    if (!res || typeof res.status !== 'function') {
      throw new Error('Invalid response object passed to ApiResponse.send()');
    }
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
