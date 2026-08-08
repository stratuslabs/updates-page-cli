const { requireConfig } = require('./config');

// All API requests go to the hosted service — accounts with a custom
// changelog domain still authenticate and publish via app.updates.page.
const BASE_URL = 'https://app.updates.page';

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
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = BASE_URL;
  }

  static fromConfig() {
    const config = requireConfig();
    return new ApiClient(config.apiKey);
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
      return this.publishPost(post.id, publish === true ? null : publish);
    }

    return post;
  }

  async publishPost(id, publishedAt = null) {
    return this.request(`/api/v1/posts/${id}/publish`, {
      method: 'POST',
      body: publishedAt ? JSON.stringify({ published_at: publishedAt }) : undefined,
    });
  }

  async updatePost(id, data) {
    return this.request(`/api/v1/posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ post: data }),
    });
  }

  async unpublishPost(id) {
    return this.request(`/api/v1/posts/${id}/unpublish`, {
      method: 'POST',
    });
  }

  async deletePost(id) {
    return this.request(`/api/v1/posts/${id}`, {
      method: 'DELETE',
    });
  }

  // Categories
  async listCategories() {
    return this.request('/api/v1/categories');
  }
}

module.exports = ApiClient;
