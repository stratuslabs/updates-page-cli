const fs = require('fs');
const path = require('path');
const { requireConfig } = require('./config');

const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Build a multipart form with one file field. Content type comes from the
// extension because the server validates it (png/jpeg/gif/webp only).
async function fileFormData(fieldName, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_TYPES[ext];
  if (!mime) {
    throw new Error(`Unsupported image type "${ext || filePath}". Use: ${Object.keys(IMAGE_MIME_TYPES).join(', ')}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const blob = await fs.openAsBlob(filePath, { type: mime });
  const form = new FormData();
  form.append(fieldName, blob, path.basename(filePath));
  return form;
}

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
      // FormData bodies set their own multipart content type (with boundary)
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

  async setCoverImage(id, filePath) {
    const form = await fileFormData('post[cover_image]', filePath);
    return this.request(`/api/v1/posts/${id}/update_cover_image`, {
      method: 'POST',
      body: form,
    });
  }

  async removeCoverImage(id) {
    return this.request(`/api/v1/posts/${id}/remove_cover_image`, {
      method: 'POST',
    });
  }

  // Categories
  async listCategories() {
    return this.request('/api/v1/categories');
  }

  async createCategory(data) {
    return this.request('/api/v1/categories', {
      method: 'POST',
      body: JSON.stringify({ category: data }),
    });
  }

  async updateCategory(id, data) {
    return this.request(`/api/v1/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ category: data }),
    });
  }

  async deleteCategory(id) {
    return this.request(`/api/v1/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // Images
  async uploadImage(filePath) {
    const form = await fileFormData('file', filePath);
    return this.request('/api/v1/uploads', {
      method: 'POST',
      body: form,
    });
  }
}

module.exports = ApiClient;
