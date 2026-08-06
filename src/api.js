const { requireConfig } = require('./config');

// Rails may return {error: "..."}, {errors: ["...", ...]} or
// {errors: {field: ["msg"]}} — flatten all of them to a readable string.
function formatApiError(errorData) {
  if (typeof errorData.error === 'string') return errorData.error;
  const errors = errorData.errors || errorData.error;
  if (!errors) return null;
  if (typeof errors === 'string') return errors;
  if (Array.isArray(errors)) return errors.join(', ');
  if (typeof errors === 'object') {
    return Object.entries(errors)
      .map(([field, messages]) => `${field} ${[].concat(messages).join(', ')}`)
      .join('; ');
  }
  return null;
}

class ApiClient {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  static fromConfig() {
    const config = requireConfig();
    return new ApiClient(config.apiKey, config.baseUrl);
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(30000),
      });

      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        if (isJson) {
          const errorData = await response.json();
          errorMessage = formatApiError(errorData) || errorMessage;
        }
        throw new Error(errorMessage);
      }

      return isJson ? await response.json() : await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Request to ${this.baseUrl} timed out after 30s.`);
      }
      if (error.cause && error.cause.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to ${this.baseUrl}. Is the server running?`);
      }
      throw error;
    }
  }

  // Posts
  async listPosts(status = null) {
    let endpoint = '/api/v1/posts';
    if (status) {
      endpoint += `?status=${status}`;
    }
    return this.request(endpoint);
  }

  async getPost(id) {
    return this.request(`/api/v1/posts/${id}`);
  }

  async createPost(data, publish = false) {
    const post = await this.request('/api/v1/posts', {
      method: 'POST',
      body: JSON.stringify({ post: data }),
    });

    if (publish && post.id) {
      return this.publishPost(post.id);
    }

    return post;
  }

  async publishPost(id) {
    return this.request(`/api/v1/posts/${id}/publish`, {
      method: 'POST',
    });
  }

  // Categories
  async listCategories() {
    return this.request('/api/v1/categories');
  }
}

module.exports = ApiClient;
